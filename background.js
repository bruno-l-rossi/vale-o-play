// Service worker: consulta o Rotten Tomatoes e devolve notas pro content script.
// Endpoint não oficial: https://www.rottentomatoes.com/napi/search/all?searchQuery=...

const POSITIVE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias
const NEGATIVE_TTL = 24 * 60 * 60 * 1000; // 1 dia (título não encontrado)
const MAX_CONCURRENT = 2;
const GAP_MS = 300; // pausa entre requisições pra não martelar o RT

const memCache = new Map();
const inFlight = new Map(); // título -> Promise (deduplica pedidos simultâneos)
const queue = [];
let active = 0;

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(title) {
  return "rt:" + normalize(title);
}

async function getFromStorage(key) {
  const obj = await chrome.storage.local.get(key);
  return obj[key];
}

async function setInStorage(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (e) {
    // storage cheio: limpa tudo e segue (cache é descartável)
    await chrome.storage.local.clear();
  }
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Extrai candidatos do JSON do RT lidando com mais de um formato de resposta.
function extractCandidates(data) {
  const out = [];
  const buckets = [
    ["movie", data?.movie?.items],
    ["movie", data?.movies],
    ["tv", data?.tvSeries?.items],
    ["tv", data?.tvSeries],
    ["tv", data?.tvs],
  ];
  for (const [type, items] of buckets) {
    if (!Array.isArray(items)) continue;
    for (const c of items) {
      out.push({
        type,
        name: c.name || c.title || "",
        year: toInt(c.releaseYear || c.year || c.startYear),
        critics: toInt(
          c.criticsScore?.score ?? c.tomatometerScore?.score ?? c.meterScore
        ),
        audience: toInt(c.audienceScore?.score),
        url: c.url || null,
      });
    }
  }
  return out;
}

// Pontua cada candidato do RT contra o título buscado.
// hint (vindo do TMDB) traz ano e tipo (filme/série) pra desempatar com precisão.
function pickBest(candidates, title, hint) {
  const target = normalize(title);
  const withScore = (c) => c.critics !== null || c.audience !== null;
  let pool = candidates.filter(withScore);
  if (!pool.length) pool = candidates;

  const points = (c) => {
    const name = normalize(c.name);
    let s = 0;
    if (name === target) s += 4;
    else if (name.includes(target) || target.includes(name)) s += 1;
    if (hint?.type && c.type === hint.type) s += 2;
    if (hint?.year && c.year && Math.abs(c.year - hint.year) <= 1) s += 3;
    return s;
  };

  let best = null;
  let bestScore = 0;
  for (const c of pool) {
    const s = points(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

// ---- Ponte TMDB: título em português -> título em inglês + ano + tipo ----

// Chave embutida (API Key v3, gratuita).
const TMDB_KEY = "b365168d89c44163386f93582187bfda";

async function tmdbJson(path, params) {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${qs}`);
  if (!res.ok) return null;
  return res.json();
}

// Busca o título PT no TMDB e devolve o nome em inglês, ano e tipo.
async function resolveViaTmdb(title) {
  const data = await tmdbJson("search/multi", {
    query: title,
    language: "pt-BR",
    region: "BR",
    include_adult: "false",
  });
  const results = (data?.results || []).filter(
    (r) => r.media_type === "movie" || r.media_type === "tv"
  );
  if (!results.length) return null;

  // prefere match exato no nome localizado; senão o 1º (TMDB ordena por relevância)
  const target = normalize(title);
  const best =
    results.find((r) => normalize(r.title || r.name) === target) || results[0];
  const type = best.media_type === "movie" ? "movie" : "tv";
  const date = best.release_date || best.first_air_date || "";

  // pega o título em inglês (original pode ser coreano, francês etc.)
  let enTitle = null;
  const details = await tmdbJson(`${type}/${best.id}`, { language: "en-US" });
  if (details) enTitle = details.title || details.name;
  if (!enTitle) enTitle = best.original_title || best.original_name;
  if (!enTitle) return null;

  return { enTitle, year: toInt(date.slice(0, 4)), type };
}

async function searchRt(query, hint) {
  const url =
    "https://www.rottentomatoes.com/napi/search/all?searchQuery=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("RT respondeu " + res.status);
  const data = await res.json();
  return pickBest(extractCandidates(data), query, hint);
}

async function fetchScore(title) {
  // 1º: traduz o título via TMDB (se houver chave configurada)
  let hint = null;
  try {
    hint = await resolveViaTmdb(title);
  } catch (e) {
    hint = null;
  }

  // busca no RT com o nome em inglês; sem TMDB, tenta o nome como veio
  let best = await searchRt(hint?.enTitle || title, hint);

  // fallback: tinha tradução mas o RT não achou; tenta o título original
  if (!best && hint) {
    best = await searchRt(title, null);
  }
  if (!best) return null;

  return {
    critics: best.critics,
    audience: best.audience,
    url: best.url
      ? best.url.startsWith("http")
        ? best.url
        : "https://www.rottentomatoes.com" + best.url
      : null,
  };
}

function runQueue() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      setTimeout(() => {
        active--;
        runQueue();
      }, GAP_MS);
    });
  }
}

function enqueue(fn) {
  return new Promise((resolve) => {
    queue.push(() => fn().then(resolve, () => resolve(null)));
    runQueue();
  });
}

async function getScore(title) {
  const key = cacheKey(title);

  if (memCache.has(key)) {
    const hit = memCache.get(key);
    if (Date.now() < hit.expires) return hit.value;
    memCache.delete(key);
  }

  const stored = await getFromStorage(key);
  if (stored && Date.now() < stored.expires) {
    memCache.set(key, stored);
    return stored.value;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const p = enqueue(() => fetchScore(title)).then(async (value) => {
    const ttl = value ? POSITIVE_TTL : NEGATIVE_TTL;
    const entry = { value, expires: Date.now() + ttl };
    memCache.set(key, entry);
    await setInStorage(key, entry);
    inFlight.delete(key);
    return value;
  });
  inFlight.set(key, p);
  return p;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "getScore" && msg.title) {
    getScore(msg.title)
      .then((value) => sendResponse({ ok: true, value }))
      .catch(() => sendResponse({ ok: false, value: null }));
    return true; // resposta assíncrona
  }
});

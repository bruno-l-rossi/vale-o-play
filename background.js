// Service worker: resolve o título no TMDB e busca a nota do Rotten Tomatoes (via OMDb).
//
// Mudança da v2: o endpoint interno do RT (rottentomatoes.com/napi/search/all)
// saiu do ar (responde 404). A nota do RT agora vem do OMDb, que é API oficial e
// estável. O OMDb entrega a nota dos CRÍTICOS do RT (não a da audiência, que
// nenhuma API gratuita expõe). Sem nota do RT, cai pra nota do IMDb, que vem
// na mesma resposta do OMDb (o IMDb tem base de votos maior e mais reconhecida
// que a do TMDB; o TMDB fica só de ponte pra casar o título PT com a obra certa).

const POSITIVE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias
const NEGATIVE_TTL = 24 * 60 * 60 * 1000; // 1 dia (título sem nota)
const MAX_CONCURRENT = 4;
const GAP_MS = 80; // pausa entre requisições (TMDB e OMDb aguentam bem)
const MIN_IMDB_VOTES = 500; // ignora nota IMDb de título obscuro

// Chave do TMDB (v3, gratuita) já embutida.
const TMDB_KEY = "b365168d89c44163386f93582187bfda";

// Chave do OMDb. OPCIONAL. Sem ela, a extensão funciona mostrando a nota do TMDB.
// Pra ligar a nota real do Rotten Tomatoes (🍅), pegue uma chave grátis em
// https://www.omdbapi.com/apikey.aspx (leva 1 minuto, chega por email) e cole aqui.
const OMDB_KEY = "c02a8f8d";

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

// ---- TMDB: título PT -> obra certa + IMDb id (ponte pro OMDb) ----

async function tmdbJson(path, params) {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${qs}`);
  if (!res.ok) return null;
  return res.json();
}

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

  // o IMDb id é a ponte pro OMDb (de onde saem a nota do RT e a do IMDb)
  const ext = await tmdbJson(`${type}/${best.id}/external_ids`, {});

  return {
    type,
    id: best.id,
    imdbId: ext?.imdb_id || null,
  };
}

// ---- OMDb: nota dos críticos do RT + nota do IMDb, pelo IMDb id ----
// As duas vêm na mesma resposta: o RT (quando existe, sobretudo filme) e a
// nota do IMDb (quase sempre presente, inclusive em série).

async function omdbLookup(imdbId) {
  try {
    const res = await fetch(
      `https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=${imdbId}&tomatoes=true`
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.Response === "False") return null;

    const rt = (d.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
    const imdbRating =
      d.imdbRating && d.imdbRating !== "N/A" ? parseFloat(d.imdbRating) : null;
    const imdbVotes =
      d.imdbVotes && d.imdbVotes !== "N/A"
        ? toInt(d.imdbVotes.replace(/,/g, ""))
        : 0;

    return {
      critics: rt ? toInt(rt.Value) : null, // "85%" -> 85
      imdbRating: Number.isFinite(imdbRating) ? imdbRating : null,
      imdbVotes: imdbVotes || 0,
    };
  } catch (e) {
    return null;
  }
}

async function fetchScore(title) {
  const tmdb = await resolveViaTmdb(title);
  if (!tmdb || !tmdb.imdbId) return null; // sem IMDb id não dá pra consultar o OMDb

  const omdb = await omdbLookup(tmdb.imdbId);
  if (!omdb) return null;

  // 1ª fonte: nota dos críticos do Rotten Tomatoes
  if (omdb.critics !== null) {
    return {
      critics: omdb.critics, // 0 a 100
      rating: null,
      source: "rt",
      url:
        "https://www.rottentomatoes.com/search?search=" +
        encodeURIComponent(title),
    };
  }

  // reserva: nota do IMDb (mesma resposta do OMDb), se tiver votos suficientes
  if (omdb.imdbRating !== null && omdb.imdbVotes >= MIN_IMDB_VOTES) {
    return {
      critics: null,
      rating: omdb.imdbRating, // 0 a 10
      source: "imdb",
      url: `https://www.imdb.com/title/${tmdb.imdbId}/`,
    };
  }

  return null;
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

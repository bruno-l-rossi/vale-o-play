// Service worker: descobre as notas de um título e devolve pro content script.
//
// Pipeline (v2.3): TMDB casa o título PT com a obra certa e dá o IMDb id. O OMDb
// (pelo IMDb id) dá o link da página do RT pra filme, mais a nota do IMDb de
// reserva. Aí a extensão RASPA a página do RT pra pegar os DOIS números:
// críticos (Tomatometer) e audiência (Popcornmeter). Pra série, que o OMDb não
// cobre, a URL do RT é adivinhada a partir do nome em inglês. Último recurso:
// a nota de usuários do TMDB, rotulada, quando RT e IMDb falham.
//
// PARTE FRÁGIL: a raspagem depende do HTML do RT. Se o RT mudar o layout, ou
// bloquear as requisições, o parser (parseRtScores) é o lugar pra ajustar; o
// IMDb continua entrando como rede de segurança quando o RT falha.

const POSITIVE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias
const NEGATIVE_TTL = 24 * 60 * 60 * 1000; // 1 dia (título sem nota)
const MAX_CONCURRENT = 4;
const GAP_MS = 80; // pausa entre requisições (TMDB e OMDb aguentam bem)
const MIN_IMDB_VOTES = 500; // ignora nota IMDb de título obscuro
const MIN_TMDB_VOTES = 20; // idem pro último recurso (nota de usuários do TMDB)

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

// Versão do cache. Muda quando a lógica/fonte da nota muda, pra invalidar
// automaticamente o cache antigo (ex.: entradas salvas na época sem chave OMDb).
const CACHE_VERSION = "v5";

function cacheKey(title) {
  return CACHE_VERSION + ":" + normalize(title);
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

// percentual válido (0 a 100) ou null
function clampPct(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
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

  // prefere match exato no nome localizado OU no original (homônimos e
  // remakes vinham errados quando só o 1º resultado era considerado);
  // senão o 1º (TMDB ordena por relevância)
  const target = normalize(title);
  const best =
    results.find(
      (r) =>
        normalize(r.title || r.name) === target ||
        normalize(r.original_title || r.original_name) === target
    ) || results[0];

  const type = best.media_type === "movie" ? "movie" : "tv";

  // o IMDb id é a ponte pro OMDb (de onde saem a nota do RT e a do IMDb)
  const ext = await tmdbJson(`${type}/${best.id}/external_ids`, {});

  return {
    type,
    id: best.id,
    imdbId: ext?.imdb_id || null,
    // nota de usuários do TMDB: último recurso quando RT e IMDb falham
    tmdbRating: Number.isFinite(best.vote_average) ? best.vote_average : null,
    tmdbVotes: toInt(best.vote_count) || 0,
  };
}

// ---- OMDb: link da página do RT (filme) + título em inglês + nota do IMDb ----

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
      enTitle: d.Title && d.Title !== "N/A" ? d.Title : null,
      year: toInt((d.Year || "").slice(0, 4)),
      // link direto da página do RT (vem pra filme; série costuma ser "N/A")
      tomatoUrl: d.tomatoURL && d.tomatoURL !== "N/A" ? d.tomatoURL : null,
      // nota dos críticos que o OMDb já traz (filme), usada como reserva do RT
      critics: rt ? clampPct(rt.Value) : null,
      imdbRating: Number.isFinite(imdbRating) ? imdbRating : null,
      imdbVotes: imdbVotes || 0,
    };
  } catch (e) {
    return null;
  }
}

// ---- Raspagem da página do RT: pega Tomatometer (críticos) e Popcornmeter (audiência) ----

// Monta URLs candidatas do RT a partir do nome em inglês (pra série, que não
// vem com link pronto do OMDb). Acerta a maioria dos títulos populares.
function rtSlugCandidates(enTitle, type, year) {
  if (!enTitle) return [];
  const slug = enTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return [];
  const path = type === "movie" ? "m" : "tv";
  const out = [`https://www.rottentomatoes.com/${path}/${slug}`];
  if (year) out.push(`https://www.rottentomatoes.com/${path}/${slug}_${year}`);
  return out;
}

// Lê os dois números do JSON embutido na página do RT (script media-hero-json).
// Cada objeto tem a porcentagem no campo "score": "criticsScore":{...,"score":"68",...}
// e "audienceScore":{...,"score":"89",...}. O [^}] mantém a busca dentro do
// próprio objeto, pra não pegar a nota de outro título da página. É o ponto
// frágil: se o RT trocar esses nomes de campo, é aqui que se ajusta.
function parseRtScores(html) {
  const grab = (key) => {
    const m = html.match(
      new RegExp('"' + key + '"\\s*:\\s*\\{[^}]*?"score"\\s*:\\s*"?(\\d{1,3})"?', "i")
    );
    return m ? clampPct(m[1]) : null;
  };
  return {
    critics: grab("criticsScore"),
    audience: grab("audienceScore"),
  };
}

async function fetchRtPage(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) return null; // 404 = slug errado, segue pro próximo candidato
    const html = await res.text();
    const s = parseRtScores(html);
    return s.critics !== null || s.audience !== null ? s : null;
  } catch (e) {
    return null;
  }
}

// Nota de usuários do TMDB, rotulada: só entra quando RT e IMDb falham.
function tmdbFallback(tmdb) {
  if (!tmdb || !tmdb.tmdbRating || tmdb.tmdbVotes < MIN_TMDB_VOTES) return null;
  return {
    critics: null,
    audience: null,
    rating: tmdb.tmdbRating, // 0 a 10
    source: "tmdb",
    url: `https://www.themoviedb.org/${tmdb.type}/${tmdb.id}`,
  };
}

async function fetchScore(title) {
  const tmdb = await resolveViaTmdb(title);
  if (!tmdb) return null;
  if (!tmdb.imdbId) return tmdbFallback(tmdb); // sem IMDb id, OMDb não ajuda

  const omdb = await omdbLookup(tmdb.imdbId);
  if (!omdb) return tmdbFallback(tmdb);

  // 1ª fonte: RASPA a página do RT pra ter críticos + audiência.
  // Filme traz o link pronto (tomatoUrl); série a gente adivinha pelo nome.
  const rtUrls = omdb.tomatoUrl
    ? [omdb.tomatoUrl]
    : rtSlugCandidates(omdb.enTitle, tmdb.type, omdb.year);

  for (const u of rtUrls) {
    const rt = await fetchRtPage(u);
    if (rt) {
      return { critics: rt.critics, audience: rt.audience, rating: null, source: "rt", url: u };
    }
  }

  // reserva do RT: a nota dos críticos que o OMDb já trazia (sem audiência)
  if (omdb.critics !== null) {
    return {
      critics: omdb.critics,
      audience: null,
      rating: null,
      source: "rt",
      url:
        omdb.tomatoUrl ||
        "https://www.rottentomatoes.com/search?search=" +
          encodeURIComponent(title),
    };
  }

  // plano B: nota do IMDb, se tiver votos suficientes
  if (omdb.imdbRating !== null && omdb.imdbVotes >= MIN_IMDB_VOTES) {
    return {
      critics: null,
      audience: null,
      rating: omdb.imdbRating, // 0 a 10
      source: "imdb",
      url: `https://www.imdb.com/title/${tmdb.imdbId}/`,
    };
  }

  // último recurso: nota de usuários do TMDB
  return tmdbFallback(tmdb);
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
  if (msg?.type === "clearCache") {
    // botão do popup: apaga o cache de notas (memória + disco).
    // As preferências ficam no storage.sync, então não são afetadas.
    memCache.clear();
    chrome.storage.local
      .clear()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

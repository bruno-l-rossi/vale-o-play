// Vale o Play? — service worker (v3)
//
// Recebe { title, year?, mediaType? } do content script (Netflix ou Disney+)
// e devolve as notas. Pipeline, do mais confiável pro último recurso:
//
//   1. TMDB (pt-BR): casa o nome exibido no streaming com a obra certa. Cada
//      candidato ganha pontos por nome exato, ano e tipo (filme/série), e só
//      passa de um mínimo de confiança — nada de "pega o 1º resultado".
//      Se o pt-BR não casar, tenta de novo com os nomes em inglês.
//   2. TMDB (en-US + external_ids): nome em inglês, ano e IMDb id numa chamada.
//   3. Rotten Tomatoes: busca no próprio RT pelo nome em inglês, escolhe o
//      resultado do tipo e ano certos e lê a página do título. As duas notas
//      (críticos e audiência) saem do JSON "media-scorecard-json" da página.
//   4. Reserva: OMDb (Tomatometer + nota do IMDb). Só é chamado quando o RT
//      falha, pra poupar a cota diária da chave grátis.
//   5. Último recurso: nota de usuários do TMDB.
//
// PARTE FRÁGIL: a leitura do RT depende do HTML do site. Se o RT mudar,
// os lugares pra ajustar são parseRtSearch e parseRtScores.

"use strict";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Muda quando a lógica/fonte da nota muda: invalida o cache antigo sozinho.
const CACHE_VERSION = "v6";
const CACHE_PREFIX = CACHE_VERSION + ":";
const CLEARED_KEY = "vop:clearedAt"; // avisa as abas quando o cache é limpo

const POSITIVE_TTL = 7 * DAY; // achou nota
const FALLBACK_TTL = 1 * DAY; // achou só reserva com erro temporário no RT
const NEGATIVE_TTL = 1 * DAY; // título sem nota em lugar nenhum
const TRANSIENT_TTL = 15 * MINUTE; // falha de rede/limite: tenta de novo logo

const MAX_CONCURRENT = 4; // títulos resolvidos em paralelo
const FETCH_TIMEOUT_MS = 12000;
const MIN_IMDB_VOTES = 500; // ignora nota IMDb de título obscuro
const MIN_TMDB_VOTES = 20; // idem pro último recurso
const MATCH_THRESHOLD = 70; // pontuação mínima pra aceitar o casamento no TMDB

// Chave do TMDB (v3, gratuita).
const TMDB_KEY = "b365168d89c44163386f93582187bfda";
// Chave do OMDb (plano FREE, 1000 req/dia). Só usada como reserva.
// Pra trocar: https://www.omdbapi.com/apikey.aspx
const OMDB_KEY = "c02a8f8d";

const TMDB_API = "https://api.themoviedb.org/3/";
const RT_BASE = "https://www.rottentomatoes.com";

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ARTICLE_RE = /^(the|a|an|o|os|as|el|la|los|las|le|les|il|der|die|das) /;

function sameTitle(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.replace(ARTICLE_RE, "") === nb.replace(ARTICLE_RE, "");
}

// Similaridade de Dice por bigramas (0 a 1): tolera pontuação e pequenas
// diferenças de grafia sem aceitar nomes que só começam igual.
function dice(a, b) {
  const x = normalize(a).replace(/ /g, "");
  const y = normalize(b).replace(/ /g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g);
    if (n) {
      hits++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

function yearOf(dateStr) {
  const m = /^(\d{4})/.exec(dateStr || "");
  return m ? Number(m[1]) : null;
}

function toInt(v) {
  const n = parseInt(String(v ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// percentual válido (0 a 100) ou null
function clampPct(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Rede: timeout + registro de falha temporária (pra não cachear erro por 1 dia)
// ---------------------------------------------------------------------------

async function request(url, ctx, kind) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      credentials: "omit",
      headers: { Accept: kind === "text" ? "text/html" : "application/json" },
    });
    if (!res.ok) {
      if (res.status === 429 || res.status === 403 || res.status >= 500) ctx.transient = true;
      return null;
    }
    return kind === "text" ? await res.text() : await res.json();
  } catch (e) {
    ctx.transient = true; // offline, timeout, bloqueio
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const getJson = (url, ctx) => request(url, ctx, "json");
const getText = (url, ctx) => request(url, ctx, "text");

// ---------------------------------------------------------------------------
// 1-2. TMDB: nome exibido -> obra certa -> nome em inglês, ano e IMDb id
// ---------------------------------------------------------------------------

function tmdb(path, params, ctx) {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  return getJson(`${TMDB_API}${path}?${qs}`, ctx);
}

// Pontua um resultado do TMDB contra o que o streaming mostrou.
function scoreCandidate(r, q) {
  const names = [r.title, r.name, r.original_title, r.original_name, ...(r._altNames || [])].filter(Boolean);
  if (!names.length) return -Infinity;

  let s;
  if (names.some((n) => sameTitle(n, q.title))) {
    s = 100;
  } else {
    // nome parecido só vale se for MUITO parecido (pontuação, um "s" a mais);
    // "Marvel" x "Ms. Marvel" (0,83) fica de fora
    const sim = Math.max(...names.map((n) => dice(n, q.title)));
    if (sim < 0.88) return -Infinity;
    s = 60 + (sim - 0.88) * 250; // 0,88 -> 60 ... 1,0 -> 90
  }

  const y = yearOf(r.release_date || r.first_air_date);
  if (q.year && y) {
    const d = Math.abs(y - q.year);
    s += d === 0 ? 25 : d === 1 ? 12 : -30;
  }
  if (q.mediaType) s += r.media_type === q.mediaType ? 10 : -30;

  // desempate: o que tem mais votos e está em alta (catálogo de streaming);
  // cadastro quase sem voto costuma ser homônimo obscuro
  const votes = r.vote_count || 0;
  s += Math.min(15, Math.log10(votes + 1) * 3);
  s += Math.min(8, Math.log10((r.popularity || 0) + 1) * 4);
  if (votes < 10) s -= 10;
  return s;
}

function pickTmdb(results, q) {
  let best = null;
  let bestScore = -Infinity;
  for (const r of results) {
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    const s = scoreCandidate(r, q);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

async function tmdbMatch(q, ctx) {
  const base = { query: q.title, include_adult: "false", page: "1" };
  const pt = await tmdb("search/multi", { ...base, language: "pt-BR" }, ctx);
  const results = pt?.results || [];
  const hit = pickTmdb(results, q);
  if (hit && (hit.vote_count || 0) >= 50) return hit;

  // Sem casamento firme: junta os nomes em inglês. Netflix e Disney+ às vezes
  // exibem o nome em inglês de obra que no TMDB tem título em português e
  // original em coreano, japonês etc.
  const en = await tmdb("search/multi", { ...base, language: "en-US" }, ctx);
  const byId = new Map(results.map((r) => [`${r.media_type}:${r.id}`, { ...r }]));
  for (const r of en?.results || []) {
    const k = `${r.media_type}:${r.id}`;
    const cur = byId.get(k);
    if (cur) cur._altNames = [r.title || r.name].filter(Boolean);
    else byId.set(k, r);
  }
  return pickTmdb([...byId.values()], q);
}

async function tmdbInfo(hit, ctx) {
  const type = hit.media_type === "movie" ? "movie" : "tv";
  const d = await tmdb(
    `${type}/${hit.id}`,
    { language: "en-US", append_to_response: "external_ids" },
    ctx
  );
  const year =
    yearOf(d?.release_date || d?.first_air_date) ||
    yearOf(hit.release_date || hit.first_air_date);
  return {
    type,
    id: hit.id,
    enTitle: d?.title || d?.name || null,
    originalTitle: d?.original_title || d?.original_name || hit.original_title || hit.original_name || null,
    originalLanguage: d?.original_language || hit.original_language || null,
    year,
    imdbId: d?.imdb_id || d?.external_ids?.imdb_id || null,
    tmdbRating: Number.isFinite(d?.vote_average) ? d.vote_average : hit.vote_average ?? null,
    tmdbVotes: toInt(d?.vote_count ?? hit.vote_count) || 0,
  };
}

// ---------------------------------------------------------------------------
// 3. Rotten Tomatoes: busca -> página do título -> críticos + audiência
// ---------------------------------------------------------------------------

function parseAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    // o RT alterna entre "release-year" e "releaseyear": normaliza os dois
    out[m[1].toLowerCase().replace(/-/g, "")] = m[2];
  }
  return out;
}

// Lê a página de busca do RT (/search?search=...). Cada seção
// <search-page-result type="movie|tvSeries"> tem linhas
// <search-page-media-row releaseyear/startyear/tomatometerscore ...> com o
// link e o nome do título.
function parseRtSearch(html) {
  const out = [];
  const sections = (html || "").split(/<search-page-result\b/i).slice(1);
  for (const sec of sections) {
    const head = sec.slice(0, sec.indexOf(">"));
    const type = (parseAttrs(head).type || "").toLowerCase();
    const kind = type === "movie" ? "movie" : type === "tvseries" ? "tv" : null;
    if (!kind) continue;
    const rows = sec.split(/<search-page-media-row\b/i).slice(1);
    for (const row of rows) {
      const tagEnd = row.indexOf(">");
      if (tagEnd < 0) continue;
      const attrs = parseAttrs(row.slice(0, tagEnd));
      const close = row.search(/<\/search-page-media-row>/i);
      const body = row.slice(tagEnd + 1, close < 0 ? undefined : close);
      const href = /href="((?:https?:\/\/www\.rottentomatoes\.com)?\/(?:m|tv)\/[^"?#]+)"/i.exec(body);
      if (!href) continue;
      const name = /data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
      const alt = /<img[^>]*\balt="([^"]*)"/i.exec(body);
      const title = decodeEntities((name ? name[1] : alt ? alt[1] : "").replace(/<[^>]+>/g, "")).trim();
      const url = href[1].startsWith("http") ? href[1] : RT_BASE + href[1];
      out.push({
        kind,
        url: url.replace(/\/+$/, ""),
        title,
        year: toInt(attrs.releaseyear) || toInt(attrs.startyear),
        critics: clampPct(attrs.tomatometerscore),
      });
    }
  }
  return out;
}

const yearClose = (a, b) => !!a && !!b && Math.abs(a - b) <= 1;

// "Arcane" casa com "Arcane: League of Legends" (mesmo ano): o RT às vezes
// guarda o nome com subtítulo.
function prefixTitle(short, long) {
  const head = (long || "").split(/\s*[:–—]\s*|\s+-\s+/)[0];
  return head !== long && sameTitle(short, head);
}

// Escolhe o resultado do RT com o mesmo nome, tipo e ano (±1) da obra do TMDB.
function pickRt(results, info) {
  const kind = info.type === "movie" ? "movie" : "tv";
  const names = [info.enTitle, info.originalTitle].filter(Boolean);
  const ofKind = results.filter((r) => r.kind === kind);
  const exact = ofKind.filter((r) => names.some((n) => sameTitle(n, r.title)));
  const byYear = (list) =>
    list
      .filter((r) => yearClose(r.year, info.year))
      .sort((a, b) => Math.abs(a.year - info.year) - Math.abs(b.year - info.year))[0] || null;

  if (exact.length) {
    if (!info.year) return exact[0];
    // todos têm ano e nenhum bate: é outra obra (remake, homônimo)
    return byYear(exact) || exact.find((r) => !r.year) || null;
  }
  // nome com subtítulo: só com ano conferido
  if (!info.year) return null;
  return byYear(ofKind.filter((r) => names.some((n) => prefixTitle(n, r.title))));
}

function extractJsonScript(html, re) {
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// Ano do título na página do RT (cabeçalho: ["R", "1972", "2h 57m"] ou
// ["TV-14", "2021 - Present", "2 Seasons"]). Serve pra conferir URL adivinhada.
function parseRtYear(html) {
  const hero = extractJsonScript(html, /<script\b[^>]*\bid="media-hero-json"[^>]*>([\s\S]*?)<\/script>/i);
  const props = hero?.content?.metadataProps;
  if (Array.isArray(props)) {
    for (const p of props) {
      const m = /\b(19\d{2}|20\d{2})\b/.exec(String(p));
      if (m) return Number(m[1]);
    }
  }
  return null;
}

// Lê as duas notas da página de um título no RT.
function parseRtScores(html) {
  if (!html) return null;
  const year = parseRtYear(html);

  // 1º: o JSON do placar, que é o que o próprio RT usa pra desenhar a página
  const card =
    extractJsonScript(html, /<script\b[^>]*\bid="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/i) ||
    extractJsonScript(html, /<script\b[^>]*\bdata-json="mediaScorecard"[^>]*>([\s\S]*?)<\/script>/i);
  if (card) {
    // o placar existe: ele é a verdade, mesmo sem nota (título sem avaliações)
    const critics = clampPct(card.criticsScore?.score);
    const audience = card.hideAudienceScore ? null : clampPct(card.audienceScore?.score);
    return critics !== null || audience !== null
      ? { critics, audience, certified: !!card.criticsScore?.certified, year }
      : null;
  }

  // 2º: busca solta pelos campos (formato antigo), restrita ao próprio objeto
  const grab = (key) => {
    const m = new RegExp('"' + key + '"\\s*:\\s*\\{[^{}]*?"score"\\s*:\\s*"?(\\d{1,3})"?', "i").exec(html);
    return m ? clampPct(m[1]) : null;
  };
  const critics = grab("criticsScore");
  const audience = grab("audienceScore");
  if (critics !== null || audience !== null) return { critics, audience, certified: false, year };

  // 3º: JSON-LD (só Tomatometer)
  const ld = /"aggregateRating"\s*:\s*\{[^{}]*?"ratingValue"\s*:\s*"?(\d{1,3})"?/i.exec(html);
  if (ld && clampPct(ld[1]) !== null) return { critics: clampPct(ld[1]), audience: null, certified: false, year };
  return null;
}

// URLs candidatas pelo nome em inglês: só usadas se a busca do RT falhar.
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
  const out = [`${RT_BASE}/${path}/${slug}`];
  if (year) out.push(`${RT_BASE}/${path}/${slug}_${year}`);
  return out;
}

async function rtLookup(info, ctx) {
  const queries = [...new Set([info.enTitle, info.originalLanguage === "en" ? info.originalTitle : null].filter(Boolean))];

  for (const q of queries) {
    const html = await getText(`${RT_BASE}/search?search=${encodeURIComponent(q)}`, ctx);
    if (!html) continue;
    const hit = pickRt(parseRtSearch(html), info);
    if (!hit) continue;
    const page = parseRtScores(await getText(hit.url, ctx));
    if (page) return { url: hit.url, ...page };
    // página falhou, mas a busca já trazia o Tomatometer
    if (hit.critics !== null) return { url: hit.url, critics: hit.critics, audience: null, certified: false };
    return null;
  }

  // a busca não achou: tenta a URL pelo nome (o RT redireciona apelidos, ex.:
  // /tv/arcane -> /tv/arcane_league_of_legends), mas só aceita se o ano bater
  for (const url of rtSlugCandidates(info.enTitle, info.type, info.year)) {
    const page = parseRtScores(await getText(url, ctx));
    if (page && (!info.year || yearClose(page.year, info.year))) return { url, ...page };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. OMDb (reserva): Tomatometer + nota do IMDb pelo IMDb id
// ---------------------------------------------------------------------------

async function omdbLookup(imdbId, ctx) {
  const d = await getJson(
    `https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=${encodeURIComponent(imdbId)}&tomatoes=true`,
    ctx
  );
  if (!d || d.Response === "False") {
    if (d && /limit/i.test(d.Error || "")) ctx.transient = true; // cota do dia estourou
    return null;
  }
  const rt = (d.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
  const imdbRating = d.imdbRating && d.imdbRating !== "N/A" ? parseFloat(d.imdbRating) : null;
  return {
    critics: rt ? clampPct(rt.Value) : null,
    tomatoUrl: d.tomatoURL && d.tomatoURL !== "N/A" ? d.tomatoURL : null,
    imdbRating: Number.isFinite(imdbRating) ? imdbRating : null,
    imdbVotes: d.imdbVotes && d.imdbVotes !== "N/A" ? toInt(d.imdbVotes) || 0 : 0,
  };
}

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------

function matchLabel(info) {
  const name = info.enTitle || info.originalTitle;
  return name ? `${name}${info.year ? ` (${info.year})` : ""}` : null;
}

async function fetchScore(q, ctx) {
  const hit = await tmdbMatch(q, ctx);
  if (!hit) return null;
  const info = await tmdbInfo(hit, ctx);
  const match = matchLabel(info);

  const rt = await rtLookup(info, ctx);
  if (rt && (rt.critics !== null || rt.audience !== null)) {
    return {
      source: "rt",
      critics: rt.critics,
      audience: rt.audience,
      certified: rt.certified,
      rating: null,
      url: rt.url,
      match,
    };
  }

  const omdb = info.imdbId ? await omdbLookup(info.imdbId, ctx) : null;
  if (omdb && omdb.critics !== null) {
    return {
      source: "rt",
      critics: omdb.critics,
      audience: null,
      certified: false,
      rating: null,
      url: omdb.tomatoUrl || `${RT_BASE}/search?search=${encodeURIComponent(info.enTitle || q.title)}`,
      match,
    };
  }
  if (omdb && omdb.imdbRating !== null && omdb.imdbVotes >= MIN_IMDB_VOTES) {
    return {
      source: "imdb",
      critics: null,
      audience: null,
      rating: omdb.imdbRating,
      url: `https://www.imdb.com/title/${info.imdbId}/`,
      match,
    };
  }
  if (info.tmdbRating && info.tmdbVotes >= MIN_TMDB_VOTES) {
    return {
      source: "tmdb",
      critics: null,
      audience: null,
      rating: info.tmdbRating,
      url: `https://www.themoviedb.org/${info.type}/${info.id}`,
      match,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fila (com prioridade pro que o usuário abriu), cache e deduplicação
// ---------------------------------------------------------------------------

const memCache = new Map(); // chave -> { value, expires }
const inFlight = new Map(); // chave -> Promise
const queue = [];
let active = 0;

function runQueue() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      active--;
      runQueue();
    });
  }
}

function enqueue(fn, priority) {
  return new Promise((resolve) => {
    const job = () => fn().then(resolve, () => resolve(undefined));
    if (priority === "high") queue.unshift(job);
    else queue.push(job);
    runQueue();
  });
}

function cacheKey(q) {
  return `${CACHE_PREFIX}${normalize(q.title)}|${q.mediaType || ""}|${q.year || ""}`;
}

async function readStored(key) {
  try {
    const obj = await chrome.storage.local.get(key);
    return obj[key];
  } catch (e) {
    return undefined;
  }
}

async function writeStored(key, entry) {
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (e) {
    // sem espaço: tira o vencido e tenta de novo; se não der, segue sem disco
    await pruneCache();
    try {
      await chrome.storage.local.set({ [key]: entry });
    } catch (e2) {
      /* cache é descartável */
    }
  }
}

async function getScore(q) {
  const key = cacheKey(q);
  const now = Date.now();

  const mem = memCache.get(key);
  if (mem && now < mem.expires) return mem.value;

  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    const stored = await readStored(key);
    if (stored && Date.now() < stored.expires) {
      memCache.set(key, stored);
      return stored.value;
    }
    const ctx = { transient: false };
    const value = await enqueue(() => fetchScore(q, ctx), q.priority);
    if (value === undefined) return null; // exceção inesperada: não cacheia
    let ttl;
    if (value) ttl = value.source === "rt" || !ctx.transient ? POSITIVE_TTL : FALLBACK_TTL;
    else ttl = ctx.transient ? TRANSIENT_TTL : NEGATIVE_TTL;
    const entry = { value, expires: Date.now() + ttl };
    memCache.set(key, entry);
    writeStored(key, entry);
    return value;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

// Apaga entradas vencidas e de versões antigas do cache.
async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const stale = Object.keys(all).filter(
      (k) => k !== CLEARED_KEY && (!k.startsWith(CACHE_PREFIX) || !(all[k] && all[k].expires > now))
    );
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (e) {
    /* nada a fazer */
  }
}

async function clearCache() {
  memCache.clear();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [CLEARED_KEY]: Date.now() });
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => pruneCache());
chrome.runtime.onStartup.addListener(() => pruneCache());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "getScore" && typeof msg.title === "string" && msg.title.trim()) {
    const q = {
      title: msg.title.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').trim().slice(0, 200),
      year: Number.isInteger(msg.year) ? msg.year : null,
      mediaType: msg.mediaType === "movie" || msg.mediaType === "tv" ? msg.mediaType : null,
      priority: msg.priority === "high" ? "high" : "normal",
    };
    getScore(q)
      .then((value) => sendResponse({ ok: true, value: value || null }))
      .catch(() => sendResponse({ ok: false, value: null }));
    return true; // resposta assíncrona
  }
  if (msg?.type === "clearCache") {
    clearCache()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

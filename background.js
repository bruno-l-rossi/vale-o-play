// Vale o Play? — service worker (v4.0)
//
// Recebe { title, year?, mediaType?, site?, nfId?, dpId? } do content script
// (Netflix ou Disney+) e devolve as notas. Pipeline, do mais confiável pro
// último recurso:
//
//   M. Mapa gravado: título já resolvido antes -> endereço do RT guardado por
//      90 dias; só renova a nota (índice do RT ou página). Cache de nota
//      compartilhado entre Netflix e Disney+ (score:<endereço>).
//   O. Correção manual (overrides.json no pacote + correções do popup/cartão).
//   0. Netflix: id do card (/browse?jbv=ID) -> Wikidata P1874 -> P1258.
//      Disney+: entity-UUID -> Wikidata P13902 (ids antigos: P7595/P7596).
//      Mapas estáticos opcionais em data/ (scripts/gerar-mapas.js) tiram o
//      Wikidata do caminho quente.
//   1. TMDB (pt-BR): casa o nome exibido com a obra certa (pontuação, limiar,
//      tipo vindo da página pública da Netflix, variantes do nome, desempate
//      pelo catálogo do serviço no Brasil).
//   2. TMDB (en-US): nome em inglês, ano, IMDb id, nomes alternativos.
//   3. Rotten Tomatoes: Wikidata (por IMDb/TMDB id, aceita tipo diferente
//      quando o vínculo é por IMDb) + índice de busca do RT (Algolia) + página.
//      Série longa sem nota de críticos: média das temporadas. Se nada
//      achou: busca HTML do próprio RT.
//   4. Reserva (provisória se o RT falhou): OMDb (Tomatometer ou IMDb).
//   5. Último recurso: nota de usuários do TMDB.
//
// Resiliência: limite de pedidos por host, disjuntor do RT (3x 403/429 pausam
// 2 min), reserva provisória (10 min) em vez de 1 dia quando o RT falhou,
// aviso às abas quando uma nota muda (vop:updatedAt).
//
// Diagnóstico: cada resultado guarda `via` (de onde veio) e `miss` (por que
// não veio do RT). O popup mostra os contadores e exporta os títulos sem RT.
//
// PARTES FRÁGEIS: a chave pública do índice (renovada sozinha lendo a home do
// RT, ver algoliaCreds) e a leitura do HTML do RT (parseRtScores e
// parseRtSeasons).

"use strict";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Muda quando a lógica/fonte da nota muda: invalida o cache antigo sozinho.
const CACHE_VERSION = "v10";
const CACHE_PREFIX = CACHE_VERSION + ":";
const CLEARED_KEY = "vop:clearedAt"; // avisa as abas quando o cache é limpo

const PROVISIONAL_TTL = 10 * MINUTE; // reserva (IMDb/TMDB) enquanto o RT falhou
const MAP_TTL = 90 * DAY; // endereço do RT de um título já resolvido
const RT_BREAKER_MS = 2 * MINUTE; // pausa nas leituras do RT após 3x 403/429
const HOST_LIMITS = { "www.rottentomatoes.com": 4, "api.themoviedb.org": 6 };
const OVERRIDES_FILE = "overrides.json";
const NF_MAP_FILE = "data/nf-map.json";
const DP_MAP_FILE = "data/dp-map.json";
const PROTECTED_PREFIX = "vop:"; // chaves que a limpeza de cache não apaga
const NEGATIVE_TTL = 1 * DAY; // título sem nota em lugar nenhum
const TRANSIENT_TTL = 15 * MINUTE; // falha de rede/limite: tenta de novo logo
const STALE_GRACE = 30 * DAY; // nota vencida ainda serve enquanto atualiza

const MAX_CONCURRENT = 8; // títulos resolvidos em paralelo pelo nome (TMDB)
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
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const WIKIDATA_TIMEOUT_MS = 6000;

// Índice de busca do RT (Algolia). São as credenciais públicas, só de busca,
// que o próprio site publica na home (RottenTomatoes.thirdParty.algoliaSearch).
// Se o RT trocar, a extensão relê a home e guarda as novas (algoliaCreds).
const ALGOLIA_DEFAULT = { aId: "79FRDP12PN", sId: "175588f6e5f8319b27702e4cc4013561" };
const ALGOLIA_CREDS_KEY = "vop:algolia";
const ALGOLIA_FIELDS = "title,titles,aka,type,releaseYear,vanity,rottenTomatoes";

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

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

// Chave "frouxa" do nome: sem acento, pontuação, espaço e artigo inicial;
// "&" vira "and" e número até 12 vira palavra ("Fantastic 4" = "Fantastic Four").
function looseKey(s) {
  return normalize((s || "").replace(/&/g, " and "))
    .replace(ARTICLE_RE, "")
    .replace(/\b(\d{1,2})\b/g, (m, d) => NUMBER_WORDS[Number(d)] || m)
    .replace(/ /g, "");
}

function sameTitle(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.replace(ARTICLE_RE, "") === nb.replace(ARTICLE_RE, "")) return true;
  const la = looseKey(a);
  return la.length >= 2 && la === looseKey(b);
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

// opts: { method, body, headers, timeout, soft, onStatus }
//  soft: falha desta fonte não marca o título como "erro temporário" (a fonte
//        é complementar e outra cobre; ex.: Wikidata).
const hostLimiters = {};
const rtBreaker = { fails: 0, openUntil: 0 };
const RT_HOST = "www.rottentomatoes.com";

function makeLimiter(max) {
  let active = 0;
  const waiting = [];
  const next = () => {
    while (active < max && waiting.length) {
      const job = waiting.shift();
      active++;
      job().finally(() => {
        active--;
        next();
      });
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push(() => fn().then(resolve, reject));
      next();
    });
}

function hostOf(url) {
  const m = /^https?:\/\/([^/]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() : "";
}

async function request(url, ctx, kind, opts = {}) {
  const host = hostOf(url);
  const isRt = host === RT_HOST;
  if (isRt && Date.now() < rtBreaker.openUntil) {
    if (!opts.soft) ctx.transient = true; // disjuntor aberto: nem tenta
    return null;
  }
  const max = HOST_LIMITS[host];
  const go = () => rawRequest(url, ctx, kind, opts, isRt);
  if (!max) return go();
  const lim = hostLimiters[host] || (hostLimiters[host] = makeLimiter(max));
  return lim(go);
}

async function rawRequest(url, ctx, kind, opts, isRt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      body: opts.body,
      signal: ctrl.signal,
      credentials: "omit",
      headers: { Accept: kind === "text" ? "text/html" : "application/json", ...(opts.headers || {}) },
    });
    if (isRt) {
      if (res.status === 403 || res.status === 429) {
        if (++rtBreaker.fails >= 3) {
          rtBreaker.openUntil = Date.now() + RT_BREAKER_MS;
          rtBreaker.fails = 0;
        }
      } else {
        rtBreaker.fails = 0;
      }
    }
    if (!res.ok) {
      if (opts.onStatus) opts.onStatus(res.status);
      if (!opts.soft && (res.status === 429 || res.status === 403 || res.status >= 500)) ctx.transient = true;
      return null;
    }
    return kind === "text" ? await res.text() : await res.json();
  } catch (e) {
    if (!opts.soft) ctx.transient = true; // offline, timeout, bloqueio
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const getJson = (url, ctx, opts) => request(url, ctx, "json", opts);
const getText = (url, ctx, opts) => request(url, ctx, "text", opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (q.exact) return -Infinity; // variante do nome: só nome idêntico vale
    const sim = Math.max(...names.map((n) => dice(n, q.title)));
    if (sim < 0.88) return -Infinity;
    s = 60 + (sim - 0.88) * 250; // 0,88 -> 60 ... 1,0 -> 90
  }

  const y = yearOf(r.release_date || r.first_air_date);
  if (q.year && y) {
    const d = Math.abs(y - q.year);
    s += d === 0 ? 25 : d === 1 ? 12 : -30;
  }
  if (q.mediaType) {
    if (r.media_type === q.mediaType) s += 10;
    else if (q.typeHard) return -Infinity; // tipo confirmado pela página da Netflix
    else s -= 30;
  }

  // desempate: o que tem mais votos e está em alta (catálogo de streaming);
  // cadastro quase sem voto costuma ser homônimo obscuro
  const votes = r.vote_count || 0;
  s += Math.min(15, Math.log10(votes + 1) * 3);
  s += Math.min(8, Math.log10((r.popularity || 0) + 1) * 4);
  if (votes < 10) s -= 10;
  return s;
}

// Candidatos acima do mínimo de confiança, do melhor pro pior.
function rankTmdb(results, q, threshold = MATCH_THRESHOLD) {
  return results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({ r, s: scoreCandidate(r, q) }))
    .filter((x) => x.s >= threshold)
    .sort((a, b) => b.s - a.s);
}

function pickTmdb(results, q) {
  return rankTmdb(results, q)[0]?.r || null;
}

// Ids de provedor do TMDB (JustWatch) de cada serviço no Brasil.
const SITE_PROVIDERS = { netflix: [8, 1796], disney: [337] };
const TIE_MARGIN = 25; // candidatos a menos disso do 1º contam como empate

// Homônimos ("Animal Kingdom" filme x série, "Doctor Who" 2005 x 2024): o
// card não traz ano nem tipo, então desempata pelo que está de fato no
// catálogo do serviço no Brasil. Só consulta quando há empate.

// A obra está no catálogo do serviço no Brasil? (TMDB / JustWatch)
async function onService(r, q, ctx) {
  const providers = SITE_PROVIDERS[q.site];
  if (!providers) return false;
  const j = await getJson(`${TMDB_API}${r.media_type}/${r.id}/watch/providers?api_key=${TMDB_KEY}`, ctx, { soft: true });
  const br = j?.results?.BR || {};
  const list = [...(br.flatrate || []), ...(br.ads || []), ...(br.free || [])];
  return list.some((p) => providers.includes(p.provider_id));
}

async function disambiguate(ranked, q, ctx) {
  const best = ranked[0];
  if (!best) return null;
  const providers = SITE_PROVIDERS[q.site];
  const ties = ranked.filter((x) => best.s - x.s <= TIE_MARGIN).slice(0, 3);
  if (!providers || ties.length < 2) return best.r;
  const avail = await Promise.all(ties.map(({ r }) => onService(r, q, ctx)));
  const inCatalog = ties.filter((_, i) => avail[i]);
  // nenhum ou todos no catálogo: a consulta não ajuda, fica a pontuação
  return inCatalog.length ? inCatalog[0].r : best.r;
}

async function tmdbMatchOnce(q, ctx) {
  const base = { query: q.title, include_adult: "false", page: "1" };
  const pt = await tmdb("search/multi", { ...base, language: "pt-BR" }, ctx);
  const results = pt?.results || [];
  const ranked = rankTmdb(results, q);
  if (ranked[0] && (ranked[0].r.vote_count || 0) >= 50) return disambiguate(ranked, q, ctx);

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
  return disambiguate(rankTmdb([...byId.values()], q), q, ctx);
}

// Tipo confirmado pela página da Netflix: tenta só esse tipo; se não achar,
// relaxa.
async function tmdbMatch(q, ctx) {
  const hit = await tmdbMatchOnce(q, ctx);
  if (hit || !q.typeHard) return hit;
  return tmdbMatchOnce({ ...q, typeHard: false }, ctx);
}

// Variantes do nome exibido: o card às vezes traz "(Dublado)", "Temporada 2",
// "Marvel Studios' X", "O Filme"... Variantes seguras (limpeza) valem com nome
// idêntico no TMDB; a parte antes dos ":" só vale se a obra estiver mesmo no
// catálogo do serviço (evita "Homem-Aranha: X" virar outro filme).
function nameVariants(title) {
  const out = [];
  const seen = new Set([normalize(title)]);
  const add = (text, safe) => {
    const t = (text || "").replace(/\s+/g, " ").replace(/^[\s:–—-]+|[\s:–—-]+$/g, "");
    const n = normalize(t);
    if (t.length < 2 || !n || seen.has(n)) return;
    seen.add(n);
    out.push({ t, safe });
  };
  let t = String(title || "");
  t = t.replace(/\s*\([^)]*\)\s*$/, "");
  add(t, true);
  t = t.replace(/\s*[:\-–—]?\s*(temporada|season|parte|part|volume|vol\.?)\s*\d+.*$/i, "");
  add(t, true);
  t = t
    .replace(/\s*[:\-–—]\s*(o filme|a s[eé]rie|the movie|the series|edi[cç][aã]o [^:]*|vers[aã]o [^:]*|director'?s cut|extended [^:]*)$/i, "")
    .replace(/\s+(o filme|a s[eé]rie)$/i, "");
  add(t, true);
  t = t.replace(
    /^(marvel studios'?\s+|marvel'?s\s+|disney'?s\s+|pixar'?s\s+|disney\s*(?:[\/&]|e)\s*pixar\s+|disney[\s-]?pixar\s+|walt disney'?s\s+|star wars\s*[:\-–—]\s*)/i,
    ""
  );
  add(t, true);
  const head = t.split(/\s*:\s*|\s+[-–—]\s+/)[0];
  if (head && head !== t) add(head, false);
  return out.slice(0, 5);
}

async function tmdbMatchVariants(q, ctx) {
  for (const v of nameVariants(q.title).slice(0, 3)) {
    const vq = { ...q, title: v.t, exact: true };
    const res = await tmdb("search/multi", { query: v.t, include_adult: "false", page: "1", language: "pt-BR" }, ctx);
    const ranked = rankTmdb(res?.results || [], vq, MATCH_THRESHOLD + 10).filter((x) => (x.r.vote_count || 0) >= 20);
    if (!ranked.length) continue;
    const best = ranked[0].r;
    if (!v.safe && !(await onService(best, q, ctx))) continue;
    ctx.variant = v.t;
    return disambiguate(ranked, vq, ctx);
  }
  return null;
}

async function tmdbInfo(hit, ctx) {
  const type = hit.media_type === "movie" ? "movie" : "tv";
  const d = await tmdb(
    `${type}/${hit.id}`,
    { language: "en-US", append_to_response: "external_ids,alternative_titles" },
    ctx
  );
  const year =
    yearOf(d?.release_date || d?.first_air_date) ||
    yearOf(hit.release_date || hit.first_air_date);
  // nomes alternativos dos países de língua inglesa (o RT é americano):
  // filme vem em alternative_titles.titles, série em alternative_titles.results
  const altList = d?.alternative_titles?.titles || d?.alternative_titles?.results || [];
  const alt = [
    ...new Set(
      altList.filter((t) => ["US", "GB", "CA", "AU"].includes(t.iso_3166_1)).map((t) => t.title).filter(Boolean)
    ),
  ].slice(0, 4);
  return {
    type,
    id: hit.id,
    enTitle: d?.title || d?.name || null,
    originalTitle: d?.original_title || d?.original_name || hit.original_title || hit.original_name || null,
    originalLanguage: d?.original_language || hit.original_language || null,
    alt,
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

// Série longa costuma ficar sem nota de críticos da série inteira no RT
// (Simpsons, NCIS, Family Guy...), mas tem nota por temporada. A página da
// série lista as temporadas em <tile-season href="/tv/x/s01"> com a nota em
// slot="critics-score". A média simples das temporadas com nota é o mesmo
// critério do "Avg. Tomatometer" do RT (conferido em 8 séries: diferença de
// no máximo 1 ponto, por arredondamento). Partes/especiais ("s37.2") ficam
// de fora. Retorna { critics, rated, total } ou null.
function parseRtSeasons(html, path) {
  if (!html || !path) return null;
  const seasons = [];
  for (const m of html.matchAll(/<tile-season\b[^>]*\bhref="\/([^"]+)"[\s\S]*?<\/tile-season>/gi)) {
    const href = m[1].replace(/\/+$/, "").toLowerCase();
    if (!href.startsWith(path.toLowerCase() + "/") || !/\/s\d+$/.test(href)) continue;
    const sc = /slot="critics-score"[^>]*>\s*(\d{1,3})\s*%/i.exec(m[0]);
    seasons.push(sc ? clampPct(sc[1]) : null);
  }
  const rated = seasons.filter((v) => v !== null);
  if (!rated.length) return null;
  return {
    critics: Math.round(rated.reduce((a, v) => a + v, 0) / rated.length),
    rated: rated.length,
    total: seasons.length,
  };
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

// Plano C: busca HTML do RT (/search) + URL pelo nome. Só entra quando o
// índice de busca está fora do ar.
async function rtLegacyLookup(info, ctx, opts = {}) {
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

  if (opts.guess === false) return null;
  // a busca não achou: tenta a URL pelo nome (o RT redireciona apelidos, ex.:
  // /tv/arcane -> /tv/arcane_league_of_legends), mas só aceita se o ano bater
  for (const url of rtSlugCandidates(info.enTitle, info.type, info.year)) {
    const page = parseRtScores(await getText(url, ctx));
    if (page && (!info.year || yearClose(page.year, info.year))) return { url, ...page };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lotes: junta pedidos que chegam quase ao mesmo tempo numa requisição só
// ---------------------------------------------------------------------------

// Uma página da Netflix pede a nota de 20 a 40 cards de uma vez. Em vez de
// uma consulta por card, os pedidos que chegam numa janela curta viram uma
// consulta só (Wikidata aceita uma lista de ids; o índice do RT aceita várias
// buscas num POST). run(keys) devolve um Map chave -> resultado; quem não
// estiver no Map recebe null; se run falhar, todos recebem undefined (erro).
// wait curto: os pedidos dos cards visíveis chegam praticamente juntos, e
// cada milissegundo de espera atrasa o badge.
function makeBatcher(run, { wait = 15, max = 40 } = {}) {
  let pending = new Map(); // chave -> [resolve...]
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const batch = pending;
    pending = new Map();
    if (!batch.size) return;
    run([...batch.keys()]).then(
      (out) => batch.forEach((rs, k) => rs.forEach((r) => r(out && out.has(k) ? out.get(k) : out ? null : undefined))),
      () => batch.forEach((rs) => rs.forEach((r) => r(undefined)))
    );
  };
  return (key) =>
    new Promise((resolve) => {
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push(resolve);
      if (pending.size >= max) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    });
}

// ---------------------------------------------------------------------------
// 3a. Wikidata: id -> endereço exato da página no RT
// ---------------------------------------------------------------------------

// Propriedades do Wikidata: P345 = IMDb id, P4947 = TMDB filme,
// P4983 = TMDB série, P1874 = Netflix id, P1258 = Rotten Tomatoes id
// ("m/the_godfather"), P577 = data de lançamento.
// P13902 = Disney+ browse ID ("entity-<uuid>", o mesmo do /browse/entity-...);
// P7595/P7596 = Disney+ movie/series ID (formato antigo, 12 caracteres).
const WD_PROPS = { imdb: "P345", tmdbm: "P4947", tmdbt: "P4983", nf: "P1874", dpe: "P13902", dpm: "P7595", dps: "P7596" };
let wdTransientAt = 0; // última falha temporária do Wikidata (rede, 429, 5xx)
let idxTransientAt = 0; // idem pro índice do RT
const recently = (t) => Date.now() - t < 20000;
const WIKIDATA_HEADERS = {
  Accept: "application/sparql-results+json",
  "Api-User-Agent": "ValeOPlay/3.2 (github.com/bruno-l-rossi/vale-o-play)",
};

const isRtPath = (p) => /^(m|tv)\/[^/\s]+$/.test(p);

async function sparql(query) {
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const opts = { soft: true, timeout: WIKIDATA_TIMEOUT_MS, headers: WIKIDATA_HEADERS };
  const ctx = { transient: false };
  let status = 0;
  let j = await getJson(url, ctx, { ...opts, onStatus: (s) => (status = s) });
  if (!j && status === 429) {
    await sleep(1500); // limite de ritmo do Wikidata: uma nova tentativa
    j = await getJson(url, ctx, opts);
  }
  if (!j) {
    if (status === 0 || status === 429 || status >= 500) wdTransientAt = Date.now();
    throw new Error("wikidata indisponível");
  }
  return j?.results?.bindings || [];
}

// Chaves "imdb:tt0068646", "tmdbm:238", "tmdbt:1399", "nf:80057281".
// Devolve chave -> { paths: [...], label, year, imdb }.
async function wikidataLookup(keys) {
  const values = keys
    .map((k) => {
      const [kind, val] = k.split(":");
      const raw = kind === "dpe" ? `entity-${val}` : val;
      return WD_PROPS[kind] && /^[\w-]+$/.test(val) ? `(wdt:${WD_PROPS[kind]} "${raw}" "${k}")` : null;
    })
    .filter(Boolean);
  if (!values.length) return new Map();
  const rows = await sparql(`SELECT ?key ?rt ?label ?imdb (MIN(YEAR(?d)) AS ?year) WHERE {
  VALUES (?p ?v ?key) { ${values.join(" ")} }
  ?i ?p ?v .
  OPTIONAL { ?i wdt:P1258 ?rt }
  OPTIONAL { ?i wdt:P345 ?imdb }
  OPTIONAL { ?i rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?i wdt:P577 ?d }
} GROUP BY ?key ?rt ?label ?imdb`);
  const out = new Map();
  for (const b of rows) {
    const key = b.key?.value;
    if (!key) continue;
    const cur = out.get(key) || { paths: [], label: null, year: null, imdb: null };
    const rt = String(b.rt?.value || "").trim().toLowerCase();
    if (rt && isRtPath(rt) && !cur.paths.includes(rt)) cur.paths.push(rt);
    cur.label = cur.label || b.label?.value || null;
    cur.imdb = cur.imdb || b.imdb?.value || null;
    const y = toInt(b.year?.value);
    if (y && (!cur.year || y < cur.year)) cur.year = y;
    out.set(key, cur);
  }
  return out;
}

const wikidataBatch = makeBatcher(wikidataLookup, { wait: 15, max: 25 });

// IMDb id / TMDB id -> endereços do RT do tipo certo (ignora temporada).
// Pode vir mais de um: o RT às vezes tem página duplicada da mesma obra
// ("tv/x_men" com nota e "tv/x_men_1992" vazia), e o Wikidata guarda as duas.
async function wikidataRtPaths(info, ctx = {}) {
  const keys = [];
  if (/^tt\d+$/.test(info.imdbId || "")) keys.push(`imdb:${info.imdbId}`);
  if (Number.isInteger(info.id)) keys.push(`${info.type === "movie" ? "tmdbm" : "tmdbt"}:${info.id}`);
  if (!keys.length) return [];
  const prefix = info.type === "movie" ? "m/" : "tv/";
  const found = await Promise.all(keys.map((k) => wikidataBatch(k)));
  if (found.some((f) => f === undefined) && recently(wdTransientAt)) ctx.wdTransient = true;
  // mesmo tipo primeiro. Endereço de outro tipo (minissérie que o RT guarda
  // como filme, stand-up, documentário) só vale quando o vínculo é pelo IMDb
  // id, que identifica a obra sem ambiguidade.
  const same = [];
  const other = [];
  found.forEach((f, i) => {
    for (const p of f?.paths || []) {
      if (p.startsWith(prefix)) {
        if (!same.includes(p)) same.push(p);
      } else if (keys[i].startsWith("imdb:") && !other.includes(p)) {
        other.push(p);
      }
    }
  });
  return [...same, ...other.filter((p) => !same.includes(p))];
}

// ---------------------------------------------------------------------------
// 3b. Índice de busca do RT (Algolia), com lote entre títulos
// ---------------------------------------------------------------------------

let algoliaMem = null;

async function algoliaCreds(refresh) {
  if (!refresh) {
    if (algoliaMem) return algoliaMem;
    try {
      const stored = (await chrome.storage.local.get(ALGOLIA_CREDS_KEY))[ALGOLIA_CREDS_KEY];
      if (stored?.aId && stored?.sId) return (algoliaMem = stored);
    } catch (e) {
      /* usa o padrão */
    }
    return (algoliaMem = ALGOLIA_DEFAULT);
  }
  // chave recusada: relê as credenciais públicas que a home do RT publica
  const html = await getText(`${RT_BASE}/`, { transient: false });
  const m = /"algoliaSearch"\s*:\s*\{\s*"aId"\s*:\s*"([A-Z0-9]+)"\s*,\s*"sId"\s*:\s*"([A-Za-z0-9]+)"/i.exec(html || "");
  if (!m) return null;
  algoliaMem = { aId: m[1], sId: m[2] };
  try {
    await chrome.storage.local.set({ [ALGOLIA_CREDS_KEY]: algoliaMem });
  } catch (e) {
    /* só memória */
  }
  return algoliaMem;
}

// Executa várias buscas num POST. Devolve a lista de resultados (uma lista
// de hits por busca), ou null se o índice estiver fora.
async function algoliaRaw(queries) {
  const run = async (creds) => {
    let status = 0;
    const body = JSON.stringify({
      requests: queries.map((q) => ({
        indexName: "content_rt",
        params: new URLSearchParams({
          query: q.query,
          hitsPerPage: String(q.hits || 10),
          ...(q.filters ? { filters: q.filters } : {}),
          attributesToRetrieve: ALGOLIA_FIELDS,
          attributesToHighlight: "",
        }).toString(),
      })),
    });
    const j = await getJson(`https://${creds.aId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, { transient: false }, {
      method: "POST",
      body,
      soft: true,
      headers: { "x-algolia-application-id": creds.aId, "x-algolia-api-key": creds.sId, "content-type": "application/json" },
      onStatus: (s) => (status = s),
    });
    return { j, status };
  };
  let { j, status } = await run(await algoliaCreds(false));
  if (!j && (status === 401 || status === 403)) {
    const fresh = await algoliaCreds(true);
    if (fresh) ({ j, status } = await run(fresh));
  }
  if (!j && (status === 0 || status === 429 || status >= 500)) idxTransientAt = Date.now();
  if (!j || !Array.isArray(j.results)) return null;
  return j.results.map((r) => r.hits || []);
}

// Lote: cada pedido é uma busca (serializada como chave); vários títulos
// dividem o mesmo POST.
const algoliaBatch = makeBatcher(
  async (keys) => {
    const lists = await algoliaRaw(keys.map((k) => JSON.parse(k)));
    if (!lists) throw new Error("índice indisponível");
    return new Map(keys.map((k, i) => [k, lists[i] || []]));
  },
  { wait: 15, max: 48 }
);

// Várias buscas de um título. Devolve os hits sem repetição, ou null se o
// índice estiver indisponível (aí entra o plano C).
async function algoliaSearch(queries, ctx) {
  const lists = await Promise.all(queries.map((q) => algoliaBatch(JSON.stringify(q))));
  if (lists.some((l) => l === undefined)) {
    if (ctx && recently(idxTransientAt)) ctx.transient = true; // índice caiu de verdade: não conclui "sem RT"
    return null;
  }
  const seen = new Set();
  const hits = [];
  for (const list of lists) {
    for (const h of list || []) {
      // filme e série podem ter o mesmo vanity (m/x e tv/x): a chave é o par
      const key = `${h.type}/${h.vanity}`;
      if (!h.vanity || seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
  }
  return hits;
}

const isLatin = (s) => !!s && !/[^\u0000-ɏḀ-ỿ -⁯]/.test(s);
const hitPath = (h) => `${h.type === "movie" ? "m" : "tv"}/${h.vanity}`;

// Monta as buscas: nome em inglês, original (se em alfabeto latino), nomes
// alternativos dos EUA/RU e, pra filme, o nome em português (o RT guarda
// nomes estrangeiros em "aka": "O Poderoso Chefão" está lá).
function algoliaQueries(info, shownTitle) {
  const type = info.type === "movie" ? "movie" : "tv";
  const names = [
    info.enTitle,
    isLatin(info.originalTitle) ? info.originalTitle : null,
    ...(info.alt || []).slice(0, 2),
    type === "movie" || info.year ? shownTitle : null,
  ].filter(Boolean);
  const uniq = [];
  for (const n of names) if (!uniq.some((u) => normalize(u) === normalize(n))) uniq.push(n);
  const years = info.year ? ` AND releaseYear:${info.year - 1} TO ${info.year + 1}` : "";
  const qs = uniq.slice(0, 4).map((query) => ({ query, filters: `type:${type}${years}` }));
  // uma busca sem filtro: pega ano divergente e filme cadastrado como série
  if (uniq[0]) qs.push({ query: uniq[0], hits: 10 });
  return qs;
}

// Escolhe o resultado do índice. Nome principal ou apelido exato, tipo e ano.
function pickAlgolia(hits, info, shownTitle) {
  const type = info.type === "movie" ? "movie" : "tv";
  const names = [info.enTitle, info.originalTitle, ...(info.alt || [])].filter(Boolean);
  const local = shownTitle && (type === "movie" || info.year) ? [shownTitle] : [];
  let best = null;
  let bestScore = 0;
  for (const h of hits) {
    const main = [h.title, ...(h.titles || [])].filter(Boolean);
    const aka = h.aka || [];
    let s;
    if (names.some((n) => main.some((x) => sameTitle(n, x)))) s = 100;
    else if (names.some((n) => aka.some((x) => sameTitle(n, x)))) s = 90;
    else if (local.some((n) => [...main, ...aka].some((x) => sameTitle(n, x)))) s = 85;
    // RT com subtítulo ("Arcane" -> "Arcane: League of Legends"): só com o
    // nome PRINCIPAL e ano exato (apelido curto tipo "Monster" não vale)
    else if (names.some((n) => prefixTitle(n, h.title))) s = 60;
    else continue;

    const y = h.releaseYear;
    if (info.year && y) {
      const d = Math.abs(y - info.year);
      if (d > 1 || (s === 60 && d !== 0)) continue; // outra obra (remake, homônimo)
      s += d === 0 ? 20 : 8;
    } else if (info.year) {
      s -= 5;
    }
    if (h.type !== type) {
      // filme cadastrado como série (ou o contrário): só nome exato + mesmo ano
      if (s < 120) continue;
      s -= 15;
    }
    if (s > bestScore) {
      best = h;
      bestScore = s;
    }
  }
  return best;
}

function hitScores(h) {
  const rt = h?.rottenTomatoes || {};
  return {
    critics: clampPct(rt.criticsScore),
    audience: clampPct(rt.audienceScore),
    certified: !!rt.certifiedFresh,
  };
}

// ---------------------------------------------------------------------------
// 3c. Notas de um endereço do RT
// ---------------------------------------------------------------------------

// Com o endereço e (se houver) o resultado do índice: se o índice já trouxe
// as duas notas, nem abre a página. Depois olha o cache de nota (compartilhado
// entre Netflix e Disney+). Senão a página é a palavra final; série sem nota de
// críticos da série inteira usa a média das temporadas.
// Devolve { url, critics, audience, certified, criticsSeasons?, pageOk } ou null.
async function rtScoresForPath(path, hit, ctx) {
  const url = `${RT_BASE}/${path}`;
  const fromIndex = hitScores(hit);
  if (fromIndex.critics !== null && fromIndex.audience !== null) {
    const out = { url, ...fromIndex, pageOk: true };
    storeScore(path, out, hit && hit.releaseYear);
    return out;
  }
  const cached = await readScore(path, ctx);
  if (cached && hasScore(cached)) return { url, ...cached, pageOk: true };
  const html = await getText(url, ctx);
  const page = parseRtScores(html);
  const out = page
    ? { url, critics: page.critics, audience: page.audience, certified: page.certified }
    : { url, ...fromIndex };
  out.pageOk = !!html || !!hit;
  if (out.critics === null && path.startsWith("tv/")) {
    const s = parseRtSeasons(html, path);
    if (s) {
      out.critics = s.critics;
      out.certified = false;
      out.criticsSeasons = { rated: s.rated, total: s.total };
    }
  }
  if (hasScore(out)) storeScore(path, out, (page && page.year) || (hit && hit.releaseYear) || ctx.year);
  return out;
}

// Ordena endereços candidatos: primeiro os que o índice conhece com nota.
function orderPaths(paths, hits) {
  const rank = (p) => {
    const h = (hits || []).find((x) => hitPath(x) === p);
    const sc = hitScores(h);
    return h ? (sc.critics !== null || sc.audience !== null ? 0 : 1) : 2;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b));
}

// Tenta os endereços em ordem até um ter nota (no máximo 3 páginas).
// Devolve o primeiro com nota, ou o primeiro que existe (sem nota), ou null.
async function firstScored(paths, hits, ctx, tried) {
  let fallback = null;
  for (const p of orderPaths(paths, hits).slice(0, 3)) {
    if (tried.has(p)) continue;
    tried.add(p);
    const hit = (hits || []).find((h) => hitPath(h) === p) || null;
    const r = await rtScoresForPath(p, hit, ctx);
    if (hasScore(r)) return r;
    if (r.pageOk && !fallback) fallback = r;
  }
  return fallback;
}

// Junta Wikidata + índice. Retorna { url, critics, audience, certified,
// criticsSeasons?, via } ou null. Quando as duas fontes não acham página com
// nota, a busca HTML do próprio RT é a última tentativa antes das reservas.
async function rtFind(info, shownTitle, ctx) {
  const [wdPaths, hits] = await Promise.all([
    wikidataRtPaths(info, ctx).catch(() => []),
    algoliaSearch(algoliaQueries(info, shownTitle), ctx),
  ]);
  const tried = new Set();

  const fromWd = wdPaths.length ? await firstScored(wdPaths, hits, ctx, tried) : null;
  if (hasScore(fromWd)) return { ...fromWd, via: "wikidata" };

  // Wikidata sem endereço, endereço desatualizado ou página sem nota:
  // o índice decide (se achar outra página da mesma obra com nota)
  let fromIdx = null;
  if (hits) {
    const hit = pickAlgolia(hits, info, shownTitle);
    if (hit && !tried.has(hitPath(hit))) {
      fromIdx = await rtScoresForPath(hitPath(hit), hit, ctx);
      if (hasScore(fromIdx)) return { ...fromIdx, via: "rt-index" };
    }
  }

  if (!fromWd && !fromIdx) {
    const old = await rtLegacyLookup(info, ctx, { guess: !hits }); // plano C: busca HTML do RT
    if (hasScore(old)) return { ...old, via: "rt-search" };
  }
  if (fromWd || fromIdx) ctx.rtNoScore = true; // a obra está no RT, sem nenhuma avaliação
  if (ctx.wdTransient && !hasScore(fromIdx)) ctx.transient = true; // Wikidata caiu: não dá pra afirmar que o RT não tem
  return null;
}

// TMDB não achou a obra: tenta o nome exibido (e variantes seguras) direto no
// índice do RT, que guarda nomes em português nos apelidos. Só aceita
// casamento exato e único.
async function rtByShownTitle(q, ctx = {}) {
  const types = q.mediaType ? [q.mediaType] : ["movie", "tv"];
  const titles = [q.title, ...nameVariants(q.title).filter((v) => v.safe).map((v) => v.t).slice(0, 2)];
  const hits = await algoliaSearch(
    titles.map((t) => ({ query: t, filters: types.length === 1 ? `type:${types[0]}` : undefined, hits: 10 })),
    ctx
  );
  if (!hits) return null;
  const found = hits.filter(
    (h) =>
      types.includes(h.type) &&
      [h.title, ...(h.titles || []), ...(h.aka || [])].some((x) => titles.some((t) => sameTitle(t, x))) &&
      (!q.year || !h.releaseYear || yearClose(h.releaseYear, q.year))
  );
  if (found.length !== 1) {
    if (found.length > 1) ctx.ambiguous = true; // ambíguo: melhor sem nota que nota errada
    return null;
  }
  const h = found[0];
  return { hit: h, url: `${RT_BASE}/${hitPath(h)}`, ...hitScores(h) };
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

function matchLabel(name, year) {
  return name ? `${name}${year ? ` (${year})` : ""}` : null;
}

const hasScore = (r) => !!r && (r.critics !== null || r.audience !== null);

function rtResult(rt, match, year) {
  return {
    source: "rt",
    critics: rt.critics,
    audience: rt.audience,
    certified: !!rt.certified,
    ...(rt.criticsSeasons ? { criticsSeasons: rt.criticsSeasons } : {}),
    rating: null,
    url: rt.url,
    match,
    year: year || null,
  };
}

// ---------------------------------------------------------------------------
// Arquivos do pacote: overrides.json e mapas estáticos (data/*.json)
// ---------------------------------------------------------------------------

const staticFiles = {};
function loadStatic(name) {
  if (!staticFiles[name]) {
    staticFiles[name] = (async () => {
      try {
        const res = await fetch(chrome.runtime.getURL(name));
        return res && res.ok ? await res.json() : null;
      } catch (e) {
        return null; // arquivo opcional ausente
      }
    })();
  }
  return staticFiles[name];
}

// ---------------------------------------------------------------------------
// Correções manuais (overrides.json do pacote + as feitas no cartão da nota)
// ---------------------------------------------------------------------------

const OVR_KEY = "vop:ovr";
let ovrMem = null;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

async function userOverrides() {
  if (!ovrMem) ovrMem = (await readStored(OVR_KEY)) || {};
  return ovrMem;
}

// chaves do mais específico (id do serviço) ao mais genérico (nome)
function overrideKeys(q) {
  const t = normalize(q.title);
  return [q.sid, `t:${q.site || ""}:${t}`, `t:${t}`].filter(Boolean);
}

async function findOverride(q) {
  const keys = overrideKeys(q);
  const user = await userOverrides();
  for (const k of keys) if (has(user, k) && (user[k] === null || isRtPath(user[k]))) return { key: k, path: user[k], src: "user" };
  const file = await loadStatic(OVERRIDES_FILE);
  if (file) for (const k of keys) if (has(file, k) && (file[k] === null || isRtPath(file[k]))) return { key: k, path: file[k], src: "file" };
  return null;
}

async function overrideScore(ov) {
  if (ov.path === null) return { value: null, meta: { miss: "override_none", via: "override" } };
  const ctx = { transient: false };
  const { rt } = await scoreByPaths([ov.path], null, ctx);
  if (!hasScore(rt)) {
    return { value: null, meta: { miss: ctx.transient ? "transient" : "rt_no_score", provisional: ctx.transient, via: "override" } };
  }
  return { value: { ...rtResult(rt, `${ov.path} (manual)`, null), via: "override" }, meta: { via: "override" } };
}

async function setOverride(q, path) {
  const user = await userOverrides();
  user[q.sid || `t:${q.site || ""}:${normalize(q.title)}`] = path;
  await chrome.storage.local.set({ [OVR_KEY]: user });
  notifyUpdated();
}

async function clearOverride(q) {
  const user = await userOverrides();
  for (const k of overrideKeys(q)) delete user[k];
  await chrome.storage.local.set({ [OVR_KEY]: user });
  notifyUpdated();
}

// ---------------------------------------------------------------------------
// Caches auxiliares: nota por endereço do RT e mapa título -> endereço
// ---------------------------------------------------------------------------

const memCache = new Map(); // chave -> { value, expires, stale, ... }

const scoreKey = (path) => `${CACHE_PREFIX}score:${path}`;

function rtTtlByYear(year) {
  const age = new Date().getFullYear() - (year || 0);
  if (!year || age <= 1) return 2 * DAY; // lançamento: a nota ainda muda
  if (age <= 5) return 7 * DAY;
  return 30 * DAY;
}

async function readScore(path, ctx) {
  if (ctx && ctx.fresh) return null;
  const k = scoreKey(path);
  let e = memCache.get(k);
  if (!e) {
    e = await readStored(k);
    if (e) memCache.set(k, e);
  }
  return e && Date.now() < e.expires ? e.value : null;
}

function storeScore(path, r, year) {
  const k = scoreKey(path);
  const now = Date.now();
  const ttl = rtTtlByYear(year);
  const entry = {
    value: {
      critics: r.critics,
      audience: r.audience,
      certified: !!r.certified,
      ...(r.criticsSeasons ? { criticsSeasons: r.criticsSeasons } : {}),
    },
    expires: now + ttl,
    stale: now + ttl,
  };
  memCache.set(k, entry);
  writeStored(k, entry);
}

const mapKeyOf = (key) => key + "#map";

async function readMap(key) {
  const mk = mapKeyOf(key);
  let e = memCache.get(mk);
  if (!e) {
    e = await readStored(mk);
    if (e) memCache.set(mk, e);
  }
  return e && Date.now() < e.expires ? e : null;
}

function writeMap(key, value) {
  if (!value || value.source !== "rt" || value.via === "omdb-rt" || value.via === "override") return;
  const m = /^https:\/\/www\.rottentomatoes\.com\/((?:m|tv)\/[^/?#]+)$/.exec(value.url || "");
  if (!m) return;
  const now = Date.now();
  const e = {
    path: m[1],
    match: value.match || null,
    year: value.year || null,
    label: String(value.match || "").replace(/\s*\(\d{4}\)$/, "") || null,
    via: value.via || null,
    expires: now + MAP_TTL,
    stale: now + MAP_TTL,
  };
  memCache.set(mapKeyOf(key), e);
  writeStored(mapKeyOf(key), e);
}

// ---------------------------------------------------------------------------
// Resolução pelos ids do serviço (Netflix e Disney+) e pelo mapa
// ---------------------------------------------------------------------------

// Linha dos mapas estáticos: [endereço(s) separados por "|", nome em inglês, ano]
function rowFromMap(r) {
  return { paths: String(r[0] || "").split("|").filter(isRtPath), label: r[1] || null, year: r[2] || null, imdb: null };
}

function mergeRows(rows) {
  const ok = rows.filter(Boolean);
  if (!ok.length) return rows.some((r) => r === undefined) ? undefined : null;
  const out = { paths: [], label: null, year: null, imdb: null };
  for (const r of ok) {
    for (const p of r.paths) if (!out.paths.includes(p)) out.paths.push(p);
    out.label = out.label || r.label;
    if (r.year && (!out.year || r.year < out.year)) out.year = r.year;
  }
  return out;
}

const isDpUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id || "");

// { paths, label, year } do serviço pro título, ou null/undefined
async function idRow(q) {
  if (q.nfId) {
    const map = await loadStatic(NF_MAP_FILE);
    if (map && map[q.nfId]) return rowFromMap(map[q.nfId]);
    return wikidataBatch(`nf:${q.nfId}`);
  }
  if (q.dpId) {
    const uuid = isDpUuid(q.dpId);
    const map = await loadStatic(DP_MAP_FILE);
    for (const k of uuid ? [`e:${q.dpId}`] : [`m:${q.dpId}`, `s:${q.dpId}`]) if (map && map[k]) return rowFromMap(map[k]);
    const keys = uuid ? [`dpe:${q.dpId}`] : [`dpm:${q.dpId}`, `dps:${q.dpId}`];
    return mergeRows(await Promise.all(keys.map((k) => wikidataBatch(k))));
  }
  return null;
}

// Notas dos endereços candidatos, com o índice do RT ajudando (1 POST em lote)
async function scoreByPaths(paths, label, ctx) {
  if (paths.length === 1) {
    const c = await readScore(paths[0], ctx);
    if (c && hasScore(c)) return { rt: { url: `${RT_BASE}/${paths[0]}`, ...c, pageOk: true }, hit: null };
  }
  let hits = null;
  if (label) {
    const types = [...new Set(paths.map((p) => (p.startsWith("m/") ? "movie" : "tv")))];
    hits = await algoliaSearch([{ query: label, filters: types.length === 1 ? `type:${types[0]}` : undefined, hits: 10 }], ctx);
  }
  const rt = await firstScored(paths, hits, ctx, new Set());
  const hit = rt ? (hits || []).find((h) => `${RT_BASE}/${hitPath(h)}` === rt.url) || null : null;
  return { rt, hit };
}

// Caminho rápido: o card traz o id do título e o Wikidata (ou o mapa do
// pacote) liga esse id direto à página do RT. Sem TMDB, sem casamento por
// nome, sem homônimo errado. Devolve o resultado, ou null pra seguir.
async function fetchById(q, ctx) {
  const wd = await idRow(q);
  if (!wd || !wd.paths.length) return null;
  const { rt, hit } = await scoreByPaths(wd.paths, wd.label, ctx);
  if (!hasScore(rt)) {
    if (rt) ctx.rtNoScore = true;
    return null;
  }
  ctx.via = q.nfId ? "netflix-id" : "disney-id";
  const year = (hit && hit.releaseYear) || wd.year;
  return rtResult(rt, matchLabel((hit && hit.title) || wd.label, year), year);
}

async function fetchByMap(m, ctx) {
  const { rt } = await scoreByPaths([m.path], m.label, ctx);
  if (!hasScore(rt)) return null; // página mudou de lugar: refaz o caminho completo
  ctx.via = m.via;
  ctx.year = m.year;
  return rtResult(rt, m.match, m.year);
}

// ---------------------------------------------------------------------------
// Netflix: tipo (filme/série) pela página pública do título
// ---------------------------------------------------------------------------

// O card da Netflix não traz tipo nem ano. A página pública /title/ID traz o
// tipo em JSON-LD (Movie/TVSeries). O ano dela é o da chegada na Netflix, não
// o da obra, então só o tipo é usado.
async function netflixType(id, ctx) {
  const key = `${CACHE_PREFIX}nftype:${id}`;
  let e = memCache.get(key);
  if (!e) {
    e = await readStored(key);
    if (e) memCache.set(key, e);
  }
  if (e && Date.now() < e.expires) return e.value;
  const html = await getText(`https://www.netflix.com/title/${id}`, ctx, { soft: true, timeout: 8000 });
  if (html == null) return null; // sem rede: não grava
  let type = null;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const t = String((Array.isArray(j) ? j[0] : j)["@type"] || "");
      if (/movie/i.test(t)) type = "movie";
      else if (/series|season/i.test(t)) type = "tv";
      if (type) break;
    } catch (err) {
      /* próximo bloco */
    }
  }
  const now = Date.now();
  const entry = { value: type, expires: now + 180 * DAY, stale: now + 180 * DAY };
  memCache.set(key, entry);
  writeStored(key, entry);
  return type;
}

async function withNetflixType(q, ctx) {
  if (q.site !== "netflix" || !q.nfId || q.mediaType) return q;
  const t = await netflixType(q.nfId, ctx);
  return t ? { ...q, mediaType: t, typeHard: true } : q;
}

// ---------------------------------------------------------------------------
// Pipeline por nome: TMDB -> Wikidata/índice do RT -> OMDb -> TMDB
// ---------------------------------------------------------------------------

async function fetchByTitle(q, ctx) {
  q = await withNetflixType(q, ctx);
  let hit = await tmdbMatch(q, ctx);
  if (!hit) hit = await tmdbMatchVariants(q, ctx);
  if (!hit) {
    // obra fora do TMDB (ou nome que ele não reconhece): tenta direto no RT
    const direct = await rtByShownTitle(q, ctx);
    if (!hasScore(direct)) {
      ctx.miss = ctx.transient ? "transient" : ctx.ambiguous ? "ambiguous" : "no_tmdb_match";
      return null;
    }
    const h = direct.hit;
    ctx.via = "rt-shown";
    ctx.year = h.releaseYear || null;
    return rtResult(direct, matchLabel(h.title, h.releaseYear), h.releaseYear);
  }
  const info = await tmdbInfo(hit, ctx);
  ctx.info = info;
  ctx.year = info.year;
  const match = matchLabel(info.enTitle || info.originalTitle, info.year);

  const rt = await rtFind(info, q.title, ctx);
  ctx.via = (rt && rt.via) || null;
  if (hasScore(rt)) return rtResult(rt, match, info.year);

  // daqui pra baixo o RT não deu nota: registra o motivo
  ctx.miss = ctx.transient ? "transient" : ctx.rtNoScore ? "rt_no_score" : "rt_absent";
  const omdb = info.imdbId ? await omdbLookup(info.imdbId, ctx) : null;
  if (omdb && omdb.critics !== null) {
    ctx.via = "omdb-rt";
    return {
      source: "rt",
      critics: omdb.critics,
      audience: null,
      certified: false,
      rating: null,
      url: omdb.tomatoUrl || `${RT_BASE}/search?search=${encodeURIComponent(info.enTitle || q.title)}`,
      match,
      year: info.year,
    };
  }
  if (omdb && omdb.imdbRating !== null && omdb.imdbVotes >= MIN_IMDB_VOTES) {
    ctx.via = "imdb";
    return {
      source: "imdb",
      critics: null,
      audience: null,
      rating: omdb.imdbRating,
      url: `https://www.imdb.com/title/${info.imdbId}/`,
      match,
      year: info.year,
    };
  }
  if (info.tmdbRating && info.tmdbVotes >= MIN_TMDB_VOTES) {
    ctx.via = "tmdb";
    return {
      source: "tmdb",
      critics: null,
      audience: null,
      rating: info.tmdbRating,
      url: `https://www.themoviedb.org/${info.type}/${info.id}`,
      match,
      year: info.year,
    };
  }
  return null;
}

// Ordem: mapa gravado (só renova a nota) -> ids do serviço (rápido, em lote)
// -> nome (TMDB, passa pela fila com limite de paralelismo).
async function fetchScore(q, ctx) {
  if (!ctx.force && !ctx.fresh) {
    const m = await readMap(ctx.key);
    if (m) {
      try {
        const v = await fetchByMap(m, ctx);
        if (v) return v;
      } catch (e) {
        /* refaz pelo caminho completo */
      }
    }
  }
  if (q.nfId || q.dpId) {
    try {
      const fast = await fetchById(q, ctx);
      if (fast) return fast;
    } catch (e) {
      /* segue pelo nome */
    }
  }
  return enqueue(() => fetchByTitle(q, ctx), q.priority);
}

// ---------------------------------------------------------------------------
// Fila, cache e deduplicação
// ---------------------------------------------------------------------------

const inFlight = new Map(); // chave -> Promise<entry>
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
  return new Promise((resolve, reject) => {
    const job = () => fn().then(resolve, reject);
    if (priority === "high") queue.unshift(job);
    else queue.push(job);
    runQueue();
  });
}

// Netflix e Disney+: a chave é o id do título (o mesmo card em qualquer
// idioma, e remakes homônimos não se misturam). Sem id: nome + tipo + ano + site.
function cacheKey(q) {
  if (q.sid) return `${CACHE_PREFIX}${q.sid}`;
  return `${CACHE_PREFIX}${normalize(q.title)}|${q.mediaType || ""}|${q.year || ""}|${q.site || ""}`;
}

// Validade pela idade do título e pela origem da nota.
//  - RT: lançamento 2 dias, até 5 anos 7 dias, clássico 30.
//  - Reserva (IMDb/TMDB): lançamento 12 h (o RT costuma ganhar nota logo),
//    até 5 anos 3 dias, mais velho 14 dias. Se o RT falhou: provisória, 10 min.
//  - Sem nota: falha temporária 15 min; título recente ou RT sem avaliação
//    12 h; resto 1 dia.
function ttlFor(value, transient, extra = {}) {
  const age = extra.year ? new Date().getFullYear() - extra.year : null;
  const recent = age !== null && age <= 1;
  if (!value) {
    if (transient) return TRANSIENT_TTL;
    if (recent || (extra.miss === "rt_no_score" && age === null)) return 12 * 60 * MINUTE;
    return NEGATIVE_TTL;
  }
  if (value.source === "rt") return rtTtlByYear(value.year);
  if (transient) return PROVISIONAL_TTL;
  const vage = value.year ? new Date().getFullYear() - value.year : null;
  if (vage === null || vage <= 1) return 12 * 60 * MINUTE;
  if (vage <= 5) return 3 * DAY;
  return 14 * DAY;
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

// ---------------------------------------------------------------------------
// Aviso às abas: uma nota mudou (vop:updatedAt), o content refaz os badges
// ---------------------------------------------------------------------------

const UPDATED_KEY = "vop:updatedAt";
let notifyTimer = null;

function notifyUpdated() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    try {
      Promise.resolve(chrome.storage.local.set({ [UPDATED_KEY]: Date.now() })).catch(() => {});
    } catch (e) {
      /* sem aviso */
    }
  }, 800);
}

const sig = (v) => (v ? [v.source, v.critics, v.audience, v.rating, v.url].join("|") : "null");

// ---------------------------------------------------------------------------
// Estatísticas locais (nada sai da máquina): popup e exportação dos sem RT
// ---------------------------------------------------------------------------

const STATS_KEY = "vop:stats";
const MISSES_KEY = "vop:misses";
let statsChain = Promise.resolve();

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bumpStats(q, entry) {
  statsChain = statsChain.then(async () => {
    try {
      const v = entry.value;
      const src = v ? v.source : "none";
      const both = !!v && v.source === "rt" && typeof v.critics === "number" && typeof v.audience === "number";
      const st = (await readStored(STATS_KEY)) || { days: {} };
      const today = dayKey();
      const day = st.days[today] || (st.days[today] = { n: 0, both: 0, site: {}, src: {}, via: {}, miss: {} });
      const inc = (o, k) => {
        o[k] = (o[k] || 0) + 1;
      };
      day.n++;
      if (both) day.both++;
      inc(day.site, q.site || "?");
      inc(day.src, src);
      inc(day.via, entry.via || "nome");
      if (entry.miss) inc(day.miss, entry.miss);
      for (const k of Object.keys(st.days).sort().slice(0, -14)) delete st.days[k];
      await chrome.storage.local.set({ [STATS_KEY]: st });

      const list = (await readStored(MISSES_KEY)) || [];
      const id = q.sid || `${q.site || ""}:${normalize(q.title)}`;
      const i = list.findIndex((m) => m.id === id);
      if (i >= 0) list.splice(i, 1);
      if (src !== "rt") {
        list.push({
          id,
          title: q.title,
          site: q.site || null,
          src,
          miss: entry.miss || null,
          match: (v && v.match) || null,
          url: (v && v.url) || null,
          provisional: !!entry.provisional,
          at: Date.now(),
        });
        while (list.length > 300) list.shift();
      }
      if (i >= 0 || src !== "rt") await chrome.storage.local.set({ [MISSES_KEY]: list });
    } catch (e) {
      /* estatística é opcional */
    }
  });
}

// conta o título uma vez por dia (a 1ª vez que aparece)
function track(q, key, entry) {
  const day = dayKey();
  if (entry.seenDay === day) return;
  entry.seenDay = day;
  bumpStats(q, entry);
  writeStored(key, entry);
}

// ---------------------------------------------------------------------------
// Busca de verdade, com deduplicação; grava no cache
// ---------------------------------------------------------------------------

function refresh(q, key, opts = {}) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    const ctx = { transient: false, key, force: !!opts.force, fresh: !!opts.fresh };
    let value;
    try {
      value = await fetchScore(q, ctx);
    } catch (e) {
      return undefined; // exceção inesperada: não cacheia
    }
    const now = Date.now();
    const provisional = ctx.transient && (!value || value.source !== "rt");
    if (value) value = { ...value, via: ctx.via || null };
    const ttl = ttlFor(value, ctx.transient, { miss: ctx.miss, year: ctx.year });
    const isRt = !!value && value.source === "rt";
    const entry = {
      value,
      expires: now + ttl,
      stale: now + ttl + STALE_GRACE,
      via: ctx.via || null,
      miss: isRt ? null : ctx.miss || (ctx.transient ? "transient" : "rt_absent"),
      provisional,
      hints: { year: q.year || null, type: q.mediaType || null },
      variant: ctx.variant || null,
      seenDay: dayKey(),
    };
    const prev = memCache.get(key);
    memCache.set(key, entry);
    writeStored(key, entry);
    if (isRt && !provisional) writeMap(key, value);
    if (prev && sig(prev.value) !== sig(value)) notifyUpdated(); // nota vencida mudou, ou o detalhe corrigiu o card
    if (!prev || prev.seenDay !== entry.seenDay) bumpStats(q, entry); // 1x por título por dia
    return entry;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const pack = (entry) => ({
  value: entry.value ?? null,
  meta: { miss: entry.miss || null, provisional: !!entry.provisional, via: entry.via || null },
});

// No detalhe (que traz ano e tipo) um card resolvido só pelo nome pode estar
// com a obra errada (remake homônimo): refaz uma vez com as dicas novas.
function needsHintRefresh(entry, q) {
  if (!q.sid) return false;
  if (entry.via === "netflix-id" || entry.via === "disney-id" || entry.via === "override") return false;
  const h = entry.hints || {};
  return !!((q.year && !h.year) || (q.mediaType && !h.type));
}

// Cache com "mostra a antiga e atualiza por trás": nota vencida (mas não
// velha demais) volta na hora e a busca nova roda em segundo plano; quando a
// nota muda, as abas abertas são avisadas.
// opts: retry (o content pede de novo: ignora entrada provisória), fresh
// (benchmark: ignora todos os caches).
async function getScore(q, opts = {}) {
  const ov = await findOverride(q);
  if (ov) return overrideScore(ov);
  const key = cacheKey(q);
  const now = Date.now();
  let entry = null;
  if (!opts.fresh) {
    entry = memCache.get(key);
    if (!entry) {
      entry = await readStored(key);
      if (entry) memCache.set(key, entry);
    }
  }
  const hintRefresh = !!entry && needsHintRefresh(entry, q);
  const usable = !!entry && !opts.fresh && !hintRefresh && !(opts.retry && entry.provisional);
  if (usable && now < entry.expires) {
    track(q, key, entry);
    return pack(entry);
  }
  if (usable && entry.value && now < (entry.stale || 0)) {
    refresh(q, key);
    track(q, key, entry);
    return pack(entry);
  }
  const e = await refresh(q, key, { force: hintRefresh || !!opts.fresh, fresh: !!opts.fresh });
  return e ? pack(e) : { value: null, meta: { miss: "error" } };
}

// Apaga entradas velhas demais e de versões antigas do cache. Chaves "vop:"
// (estatísticas, correções, credenciais do índice) nunca são apagadas.
async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const stale = Object.keys(all).filter((k) => {
      if (k.startsWith(PROTECTED_PREFIX)) return false;
      if (!k.startsWith(CACHE_PREFIX)) return true;
      const e = all[k];
      return !(e && Math.max(e.expires || 0, e.stale || 0) > now);
    });
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (e) {
    /* nada a fazer */
  }
}

async function clearCache() {
  memCache.clear();
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => !k.startsWith(PROTECTED_PREFIX));
  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ [CLEARED_KEY]: Date.now() });
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => pruneCache());
chrome.runtime.onStartup.addListener(() => pruneCache());

function queryFromMsg(msg) {
  const nfId = msg.site === "netflix" && /^\d{5,10}$/.test(String(msg.nfId || "")) ? String(msg.nfId) : null;
  const dpId = msg.site === "disney" && /^[0-9a-zA-Z-]{8,40}$/.test(String(msg.dpId || "")) ? String(msg.dpId) : null;
  return {
    title: String(msg.title).replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').trim().slice(0, 200),
    year: Number.isInteger(msg.year) ? msg.year : null,
    mediaType: msg.mediaType === "movie" || msg.mediaType === "tv" ? msg.mediaType : null,
    priority: msg.priority === "high" ? "high" : "normal",
    site: msg.site === "netflix" || msg.site === "disney" ? msg.site : null,
    nfId,
    dpId,
    sid: nfId ? `nf:${nfId}` : dpId ? `dp:${dpId}` : null,
  };
}

const okFlag = (sendResponse) => ({
  yes: () => sendResponse({ ok: true }),
  no: () => sendResponse({ ok: false }),
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "getScore" && typeof msg.title === "string" && msg.title.trim()) {
    getScore(queryFromMsg(msg), { retry: !!msg.retry, fresh: !!msg.fresh })
      .then((r) =>
        sendResponse({
          ok: true,
          value: r.value || null,
          miss: r.meta.miss || null,
          provisional: !!r.meta.provisional,
          via: r.meta.via || null,
        })
      )
      .catch(() => sendResponse({ ok: false, value: null }));
    return true; // resposta assíncrona
  }
  if (msg?.type === "clearCache") {
    const r = okFlag(sendResponse);
    clearCache().then(r.yes, r.no);
    return true;
  }
  if (msg?.type === "getStats") {
    Promise.all([readStored(STATS_KEY), readStored(MISSES_KEY)])
      .then(([stats, misses]) => sendResponse({ ok: true, stats: stats || { days: {} }, misses: misses || [] }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "clearStats") {
    const r = okFlag(sendResponse);
    chrome.storage.local.remove([STATS_KEY, MISSES_KEY]).then(r.yes, r.no);
    return true;
  }
  if (msg?.type === "setOverride" && typeof msg.title === "string" && isRtPath(String(msg.path || ""))) {
    const r = okFlag(sendResponse);
    setOverride(queryFromMsg(msg), String(msg.path)).then(r.yes, r.no);
    return true;
  }
  if (msg?.type === "clearOverride" && typeof msg.title === "string") {
    const r = okFlag(sendResponse);
    clearOverride(queryFromMsg(msg)).then(r.yes, r.no);
    return true;
  }
  return false;
});

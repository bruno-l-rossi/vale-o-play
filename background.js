// Vale o Play? — service worker (v3.2)
//
// Recebe { title, year?, mediaType?, site?, nfId? } do content script (Netflix
// ou Disney+) e devolve as notas. Pipeline, do mais confiável pro último recurso:
//
//   0. Netflix: o card traz o id do título (/browse?jbv=ID) e o Wikidata liga
//      esse id direto à página do RT (P1874 -> P1258). Sem TMDB e sem
//      casamento por nome. Se o Wikidata não conhecer o id, segue pelo nome.
//   1. TMDB (pt-BR): casa o nome exibido no streaming com a obra certa. Cada
//      candidato ganha pontos por nome exato, ano e tipo (filme/série), e só
//      passa de um mínimo de confiança — nada de "pega o 1º resultado".
//      Se o pt-BR não casar, tenta de novo com os nomes em inglês. Homônimos
//      empatados são desempatados pelo catálogo do serviço no Brasil.
//   2. TMDB (en-US + external_ids + alternative_titles): nome em inglês, ano,
//      IMDb id e nomes alternativos dos EUA/Reino Unido numa chamada só.
//   3. Rotten Tomatoes, em paralelo:
//      a. Wikidata: pelo IMDb id (ou TMDB id) devolve o endereço EXATO da
//         página no RT (ex.: Round 6 -> tv/squid_game). Casamento sem chute.
//      b. Índice de busca do próprio RT (Algolia, a mesma busca do topo do
//         site): devolve nome, apelidos (inclusive em português), tipo, ano,
//         endereço e as DUAS notas, sem precisar abrir a página.
//      A página do título só é lida quando o índice não trouxe alguma nota.
//      Série longa sem nota de críticos da série: média das temporadas.
//      Se o índice cair, a busca HTML antiga do RT entra como plano C.
//   4. Reserva: OMDb (Tomatometer + nota do IMDb), só quando o RT não tem nota.
//   5. Último recurso: nota de usuários do TMDB.
//
// Medição (21/out/2026, 458 títulos dos catálogos Netflix/Disney+ BR pelo
// nome do card): 92,6% com nota do RT (v3.0: 89,5%), 83,4% com as duas notas
// (v3.0: 71,4%). Os que ficam fora não têm nota nenhuma no RT.
//
// Desempenho: pedidos de vários cards que chegam juntos viram uma consulta só
// ao Wikidata e um POST só ao índice do RT (makeBatcher). Cache com validade
// pela idade do título (lançamento 2 dias, até 5 anos 7 dias, clássico 30) e
// "mostra a antiga e atualiza por trás" quando vence.
//
// PARTES FRÁGEIS: a chave pública do índice (renovada sozinha lendo a home do
// RT, ver algoliaCreds) e a leitura do HTML do RT (parseRtScores e
// parseRtSeasons).

"use strict";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Muda quando a lógica/fonte da nota muda: invalida o cache antigo sozinho.
const CACHE_VERSION = "v9";
const CACHE_PREFIX = CACHE_VERSION + ":";
const CLEARED_KEY = "vop:clearedAt"; // avisa as abas quando o cache é limpo

const FALLBACK_TTL = 1 * DAY; // achou só reserva com erro temporário no RT
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
async function request(url, ctx, kind, opts = {}) {
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

// Candidatos acima do mínimo de confiança, do melhor pro pior.
function rankTmdb(results, q) {
  return results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({ r, s: scoreCandidate(r, q) }))
    .filter((x) => x.s >= MATCH_THRESHOLD)
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
async function disambiguate(ranked, q, ctx) {
  const best = ranked[0];
  if (!best) return null;
  const providers = SITE_PROVIDERS[q.site];
  const ties = ranked.filter((x) => best.s - x.s <= TIE_MARGIN).slice(0, 3);
  if (!providers || ties.length < 2) return best.r;
  const avail = await Promise.all(
    ties.map(async ({ r }) => {
      const j = await getJson(
        `${TMDB_API}${r.media_type}/${r.id}/watch/providers?api_key=${TMDB_KEY}`,
        ctx,
        { soft: true }
      );
      const br = j?.results?.BR || {};
      const list = [...(br.flatrate || []), ...(br.ads || []), ...(br.free || [])];
      return list.some((p) => providers.includes(p.provider_id));
    })
  );
  const onService = ties.filter((_, i) => avail[i]);
  // nenhum ou todos no catálogo: a consulta não ajuda, fica a pontuação
  return onService.length ? onService[0].r : best.r;
}

async function tmdbMatch(q, ctx) {
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
async function rtLegacyLookup(info, ctx) {
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
const WD_PROPS = { imdb: "P345", tmdbm: "P4947", tmdbt: "P4983", nf: "P1874" };
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
  if (!j) throw new Error("wikidata indisponível");
  return j?.results?.bindings || [];
}

// Chaves "imdb:tt0068646", "tmdbm:238", "tmdbt:1399", "nf:80057281".
// Devolve chave -> { paths: [...], label, year, imdb }.
async function wikidataLookup(keys) {
  const values = keys
    .map((k) => {
      const [kind, val] = k.split(":");
      return WD_PROPS[kind] ? `(wdt:${WD_PROPS[kind]} "${val}" "${k}")` : null;
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
async function wikidataRtPaths(info) {
  const keys = [];
  if (/^tt\d+$/.test(info.imdbId || "")) keys.push(`imdb:${info.imdbId}`);
  if (Number.isInteger(info.id)) keys.push(`${info.type === "movie" ? "tmdbm" : "tmdbt"}:${info.id}`);
  if (!keys.length) return [];
  const prefix = info.type === "movie" ? "m/" : "tv/";
  const found = await Promise.all(keys.map((k) => wikidataBatch(k)));
  const out = [];
  for (const f of found) for (const p of f?.paths || []) if (p.startsWith(prefix) && !out.includes(p)) out.push(p);
  return out;
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
    if (fresh) ({ j } = await run(fresh));
  }
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
async function algoliaSearch(queries) {
  const lists = await Promise.all(queries.map((q) => algoliaBatch(JSON.stringify(q))));
  if (lists.some((l) => l === undefined)) return null;
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
    type === "movie" ? shownTitle : null,
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
  const local = type === "movie" && shownTitle ? [shownTitle] : [];
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
// as duas notas, nem abre a página. Senão a página é a palavra final; série
// sem nota de críticos da série inteira usa a média das temporadas.
// Devolve { url, critics, audience, certified, criticsSeasons?, html } ou null
// (html só pra quem precisa saber se a página existe).
async function rtScoresForPath(path, hit, ctx) {
  const url = `${RT_BASE}/${path}`;
  const fromIndex = hitScores(hit);
  if (fromIndex.critics !== null && fromIndex.audience !== null) return { url, ...fromIndex, pageOk: true };
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
// criticsSeasons?, via } (notas podem vir nulas: está no RT sem avaliação) ou null.
async function rtFind(info, shownTitle, ctx) {
  const [wdPaths, hits] = await Promise.all([
    wikidataRtPaths(info).catch(() => []),
    algoliaSearch(algoliaQueries(info, shownTitle)),
  ]);
  const tried = new Set();

  const fromWd = wdPaths.length ? await firstScored(wdPaths, hits, ctx, tried) : null;
  if (hasScore(fromWd)) return { ...fromWd, via: "wikidata" };

  if (hits) {
    // Wikidata sem endereço, endereço desatualizado ou página sem nota:
    // o índice decide (se achar outra página da mesma obra com nota)
    const hit = pickAlgolia(hits, info, shownTitle);
    if (hit && !tried.has(hitPath(hit))) {
      const r = await rtScoresForPath(hitPath(hit), hit, ctx);
      if (hasScore(r) || !fromWd) return { ...r, via: "rt-index" };
    }
    return fromWd ? { ...fromWd, via: "wikidata" } : null;
  }
  if (fromWd) return { ...fromWd, via: "wikidata" };
  const old = await rtLegacyLookup(info, ctx); // índice fora: plano C
  return old ? { ...old, via: "rt-search" } : null;
}

// TMDB não achou a obra: tenta o nome exibido direto no índice do RT, que
// guarda nomes em português nos apelidos. Só aceita casamento exato e único.
async function rtByShownTitle(q) {
  const types = q.mediaType ? [q.mediaType] : ["movie", "tv"];
  const hits = await algoliaSearch([
    { query: q.title, filters: types.length === 1 ? `type:${types[0]}` : undefined, hits: 10 },
  ]);
  if (!hits) return null;
  const found = hits.filter(
    (h) =>
      types.includes(h.type) &&
      [h.title, ...(h.titles || []), ...(h.aka || [])].some((x) => sameTitle(q.title, x)) &&
      (!q.year || !h.releaseYear || yearClose(h.releaseYear, q.year))
  );
  if (found.length !== 1) return null; // ambíguo: melhor sem nota que nota errada
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

// Caminho rápido da Netflix: o card traz o id do título (/browse?jbv=ID) e o
// Wikidata liga esse id direto à página do RT (P1874 -> P1258). Sem TMDB, sem
// casamento por nome, sem homônimo errado. Devolve o resultado, ou null pra
// seguir pelo caminho por nome.
async function fetchByNetflixId(q, ctx) {
  const wd = await wikidataBatch(`nf:${q.nfId}`);
  if (!wd || !wd.paths.length) return null;
  let hits = null;
  if (wd.label) {
    const types = [...new Set(wd.paths.map((p) => (p.startsWith("m/") ? "movie" : "tv")))];
    hits = await algoliaSearch([
      { query: wd.label, filters: types.length === 1 ? `type:${types[0]}` : undefined, hits: 10 },
    ]);
  }
  const rt = await firstScored(wd.paths, hits, ctx, new Set());
  if (!hasScore(rt)) return null;
  const hit = (hits || []).find((h) => `${RT_BASE}/${hitPath(h)}` === rt.url);
  ctx.via = "netflix-id";
  const year = hit?.releaseYear || wd.year;
  return rtResult(rt, matchLabel(hit?.title || wd.label, year), year);
}

// Caminho por nome: TMDB -> Wikidata/índice do RT -> OMDb -> TMDB.
async function fetchByTitle(q, ctx) {
  const hit = await tmdbMatch(q, ctx);
  if (!hit) {
    // obra fora do TMDB (ou nome que ele não reconhece): tenta direto no RT
    const direct = await rtByShownTitle(q);
    if (!hasScore(direct)) return null;
    const h = direct.hit;
    return rtResult(direct, matchLabel(h.title, h.releaseYear), h.releaseYear);
  }
  const info = await tmdbInfo(hit, ctx);
  ctx.info = info;
  const match = matchLabel(info.enTitle || info.originalTitle, info.year);

  const rt = await rtFind(info, q.title, ctx);
  ctx.via = rt?.via || null;
  if (hasScore(rt)) return rtResult(rt, match, info.year);

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
      year: info.year,
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
      year: info.year,
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
      year: info.year,
    };
  }
  return null;
}

// O caminho da Netflix roda fora da fila (é barato e vai em lote); o caminho
// por nome, que bate no TMDB, passa pela fila com limite de paralelismo.
async function fetchScore(q, ctx) {
  if (q.nfId) {
    try {
      const fast = await fetchByNetflixId(q, ctx);
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

const memCache = new Map(); // chave -> { value, expires, stale }
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
  return new Promise((resolve, reject) => {
    const job = () => fn().then(resolve, reject);
    if (priority === "high") queue.unshift(job);
    else queue.push(job);
    runQueue();
  });
}

// Netflix: a chave é o id do título (o mesmo card em qualquer idioma, sem
// ambiguidade). Demais: nome + tipo + ano + site.
function cacheKey(q) {
  if (q.nfId) return `${CACHE_PREFIX}nf:${q.nfId}`;
  return `${CACHE_PREFIX}${normalize(q.title)}|${q.mediaType || ""}|${q.year || ""}|${q.site || ""}`;
}

// Validade pela idade do título: nota de lançamento muda rápido, nota de
// clássico quase nunca.
function ttlFor(value, transient) {
  if (!value) return transient ? TRANSIENT_TTL : NEGATIVE_TTL;
  if (value.source !== "rt") return transient ? FALLBACK_TTL : 3 * DAY;
  const age = new Date().getFullYear() - (value.year || 0);
  if (!value.year || age <= 1) return 2 * DAY;
  if (age <= 5) return 7 * DAY;
  return 30 * DAY;
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

// Busca de verdade, com deduplicação; grava no cache.
function refresh(q, key) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    const ctx = { transient: false };
    let value;
    try {
      value = await fetchScore(q, ctx);
    } catch (e) {
      return undefined; // exceção inesperada: não cacheia
    }
    const now = Date.now();
    const ttl = ttlFor(value, ctx.transient);
    const entry = { value, expires: now + ttl, stale: now + ttl + STALE_GRACE };
    memCache.set(key, entry);
    writeStored(key, entry);
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Cache com "mostra a antiga e atualiza por trás": nota vencida (mas não
// velha demais) volta na hora e a busca nova roda em segundo plano; a
// próxima visita já vê a atualizada.
async function getScore(q) {
  const key = cacheKey(q);
  const now = Date.now();
  let entry = memCache.get(key);
  if (!entry) {
    entry = await readStored(key);
    if (entry) memCache.set(key, entry);
  }
  if (entry && now < entry.expires) return entry.value;
  if (entry && entry.value && now < (entry.stale || 0)) {
    refresh(q, key);
    return entry.value;
  }
  const v = await refresh(q, key);
  return v === undefined ? null : v;
}

// Apaga entradas velhas demais e de versões antigas do cache.
async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const stale = Object.keys(all).filter((k) => {
      if (k === CLEARED_KEY || k === ALGOLIA_CREDS_KEY) return false;
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
      site: msg.site === "netflix" || msg.site === "disney" ? msg.site : null,
      nfId: msg.site === "netflix" && /^\d{5,10}$/.test(String(msg.nfId || "")) ? String(msg.nfId) : null,
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

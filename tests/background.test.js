// Testes do service worker: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("./load-background");

// ---- Fixtures no formato real do RT (capturado em out/2026) ----

const rtSearch = (rows) => `
<html><body>
<search-page-result data-qa="search-result" skeleton="panel" type="movie">
  <ul slot="list">${rows.filter((r) => r.kind === "movie").map(row).join("")}</ul>
</search-page-result>
<search-page-result data-qa="search-result" skeleton="panel" type="tvSeries">
  <ul slot="list">${rows.filter((r) => r.kind === "tv").map(row).join("")}</ul>
</search-page-result>
<search-page-result data-qa="search-result" skeleton="panel" type="celebrity"></search-page-result>
</body></html>`;

// o RT alterna "release-year" e "releaseyear" entre páginas: testa os dois
function row(r, i) {
  const y = r.kind === "movie" ? "release" : "start";
  const attr = i % 2 ? `${y}year="${r.year}" tomatometerscore="${r.score ?? ""}"` : `${y}-year="${r.year}" tomatometer-score="${r.score ?? ""}"`;
  return `<search-page-media-row skeleton="panel" cast="" data-qa="data-row" ${attr}>
    <a href="https://www.rottentomatoes.com/${r.kind === "movie" ? "m" : "tv"}/${r.slug}" class="unset" data-qa="thumbnail-link" slot="thumbnail"><img alt="${r.title}" src="x.jpg"></a>
    <a href="https://www.rottentomatoes.com/${r.kind === "movie" ? "m" : "tv"}/${r.slug}" class="unset" data-qa="info-name" slot="title"> ${r.title} </a>
  </search-page-media-row>`;
}

const rtPage = ({ critics, audience, hideAudience, props }) => `
<html><head></head><body>
<script id="media-hero-json" data-json="mediaHero" type="application/json">
  {"averageColorHsl":"23, 30%, 15%","content":{"metadataProps":${JSON.stringify(props || ["R", "1972", "2h 57m"])},"title":"X"}}
</script>
<script id="media-scorecard-json" data-json="mediaScorecard" type="application/json">
  {"audienceScore":{"score":${audience == null ? "null" : `"${audience}"`},"title":"Popcornmeter"},
   "criticsScore":{"certified":true,"score":${critics == null ? "null" : `"${critics}"`},"title":"Tomatometer"},
   "hideAudienceScore":${hideAudience ? "true" : "false"}}
</script>
<script type="application/json" data-json="other">{"criticsScore":{"score":"11"},"audienceScore":{"score":"12"}}</script>
</body></html>`;

const tmdbSearch = (results) => ({ json: { results } });

// ---- Parsers ----

test("parseRtSearch lê seções, anos (com e sem hífen), nome e nota", () => {
  const bg = loadBackground();
  const html = rtSearch([
    { kind: "movie", title: "The Godfather", slug: "the_godfather", year: 1972, score: 97 },
    { kind: "movie", title: "The Godfather Part II", slug: "the_godfather_part_ii", year: 1974, score: 96 },
    { kind: "tv", title: "The Office", slug: "the_office", year: 2005, score: 81 },
    { kind: "tv", title: "It&#39;s Okay", slug: "its_okay", year: 2020, score: "" },
  ]);
  const out = bg.ctx.parseRtSearch(html);
  assert.equal(out.length, 4);
  assert.deepEqual(
    { ...out[0] },
    { kind: "movie", url: "https://www.rottentomatoes.com/m/the_godfather", title: "The Godfather", year: 1972, critics: 97 }
  );
  assert.equal(out[1].year, 1974);
  assert.equal(out[2].kind, "tv");
  assert.equal(out[3].title, "It's Okay");
  assert.equal(out[3].critics, null);
});

test("parseRtScores usa o JSON do placar (e não outro objeto da página)", () => {
  const bg = loadBackground();
  const s = bg.ctx.parseRtScores(rtPage({ critics: 97, audience: 98 }));
  assert.equal(s.critics, 97);
  assert.equal(s.audience, 98);
  assert.equal(s.certified, true);
  assert.equal(s.year, 1972);
});

test("parseRtScores: audiência ausente/escondida não puxa nota de outro título", () => {
  const bg = loadBackground();
  const s1 = bg.ctx.parseRtScores(rtPage({ critics: 90, audience: null }));
  assert.equal(s1.critics, 90);
  assert.equal(s1.audience, null);
  const s2 = bg.ctx.parseRtScores(rtPage({ critics: 90, audience: 80, hideAudience: true }));
  assert.equal(s2.audience, null);
  assert.equal(bg.ctx.parseRtScores(rtPage({ critics: null, audience: null })), null);
});

test("parseRtScores: ano de série vem do cabeçalho", () => {
  const bg = loadBackground();
  const s = bg.ctx.parseRtScores(rtPage({ critics: 100, audience: 90, props: ["TV-14", "2021 - Present", "2 Seasons"] }));
  assert.equal(s.year, 2021);
});

// ---- Casamento ----

test("pickRt exige tipo e ano; aceita subtítulo só com ano conferido", () => {
  const bg = loadBackground();
  const results = [
    { kind: "movie", title: "Rebecca", url: "u1940", year: 1940 },
    { kind: "movie", title: "Rebecca", url: "u2020", year: 2020 },
    { kind: "tv", title: "Arcane: League of Legends", url: "arcane", year: 2021 },
    { kind: "tv", title: "Dark", url: "dark", year: 2017 },
  ];
  const pick = (info) => bg.ctx.pickRt(results, info)?.url ?? null;
  assert.equal(pick({ type: "movie", enTitle: "Rebecca", year: 2020 }), "u2020");
  assert.equal(pick({ type: "movie", enTitle: "Rebecca", year: 1940 }), "u1940");
  assert.equal(pick({ type: "movie", enTitle: "Rebecca", year: 1997 }), null); // nenhum ano bate
  assert.equal(pick({ type: "tv", enTitle: "Arcane", year: 2021 }), "arcane");
  assert.equal(pick({ type: "tv", enTitle: "Arcane", year: 2010 }), null);
  assert.equal(pick({ type: "movie", enTitle: "Dark", year: 2017 }), null); // tipo errado
});

test("pickTmdb: nome exato ganha; parecido demais não passa (Marvel x Ms. Marvel)", () => {
  const bg = loadBackground();
  const r = (o) => ({ media_type: "tv", vote_count: 500, popularity: 20, ...o });
  const pick = (list, q) => bg.ctx.pickTmdb(list, q)?.id ?? null;
  assert.equal(pick([r({ id: 1, name: "Ms. Marvel", original_name: "Ms. Marvel" })], { title: "Marvel" }), null);
  assert.equal(pick([r({ id: 2, name: "Round 6", original_name: "오징어 게임" })], { title: "Round 6" }), 2);
  // homônimo obscuro (3 votos) perde pro título real (1524 votos) com nome em inglês
  const list = [
    r({ id: 10, name: "It's Okay to Not Be Okay", original_name: "It's Okay to Not Be Okay", vote_count: 3, popularity: 7.6 }),
    r({ id: 11, name: "Tudo Bem Não Ser Normal", original_name: "사이코지만 괜찮아", _altNames: ["It's Okay to Not Be Okay"], vote_count: 1524, popularity: 15.5 }),
  ];
  assert.equal(pick(list, { title: "It's Okay to Not Be Okay" }), 11);
  // ano e tipo informados desempatam
  const twins = [
    { id: 20, media_type: "movie", title: "Rebecca", release_date: "1940-04-12", vote_count: 1900, popularity: 6 },
    { id: 21, media_type: "movie", title: "Rebecca", release_date: "2020-10-16", vote_count: 1500, popularity: 5 },
  ];
  assert.equal(pick(twins, { title: "Rebecca", year: 2020 }), 21);
  assert.equal(pick(twins, { title: "Rebecca", mediaType: "tv" }), 20 /* nenhum é série: fica o de mais voto */);
});

// ---- Pipeline completo com rede falsa ----

function godfatherRoutes(extra = {}) {
  return {
    "search/multi": tmdbSearch([
      { id: 238, media_type: "movie", title: "O Poderoso Chefão", original_title: "The Godfather", release_date: "1972-03-14", vote_count: 23000, popularity: 30, vote_average: 8.7 },
    ]),
    "3/movie/238": { json: { title: "The Godfather", original_title: "The Godfather", original_language: "en", release_date: "1972-03-14", imdb_id: "tt0068646", vote_average: 8.7, vote_count: 23000 } },
    "rottentomatoes.com/search": { text: rtSearch([{ kind: "movie", title: "The Godfather", slug: "the_godfather", year: 1972, score: 97 }]) },
    "rottentomatoes.com/m/the_godfather": { text: rtPage({ critics: 97, audience: 98 }) },
    ...extra,
  };
}

// Nas rotas acima não há Wikidata nem índice do RT (respondem 404): é o
// cenário "índice fora do ar", em que a busca HTML antiga entra como plano C.
test("plano C: índice e Wikidata fora -> busca HTML do RT -> página, sem gastar OMDb", async () => {
  const bg = loadBackground({ routes: { ...godfatherRoutes(), omdbapi: { json: { Response: "False" } } } });
  const res = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(res.ok, true);
  assert.equal(res.value.source, "rt");
  assert.equal(res.value.critics, 97);
  assert.equal(res.value.audience, 98);
  assert.equal(res.value.url, "https://www.rottentomatoes.com/m/the_godfather");
  assert.equal(res.value.match, "The Godfather (1972)");
  assert.equal(bg.calls.filter((u) => u.includes("omdbapi")).length, 0);
  // TMDB (2) + Wikidata + índice + busca HTML + página
  assert.equal(bg.calls.length, 6);
});

test("pipeline: cache em memória/disco e deduplicação de pedidos simultâneos", async () => {
  const bg = loadBackground({ routes: godfatherRoutes() });
  const [a, b] = await Promise.all([
    bg.send({ type: "getScore", title: "O Poderoso Chefão" }),
    bg.send({ type: "getScore", title: "o poderoso chefao" }),
  ]);
  assert.deepEqual(a, b);
  const n = bg.calls.length;
  await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(bg.calls.length, n, "segunda chamada não vai pra rede");
  const keys = Object.keys(bg.store).filter((k) => k.startsWith("v9:"));
  assert.equal(keys.length, 1);
  assert.ok(bg.store[keys[0]].expires > Date.now() + 6 * 24 * 3600 * 1000);
});

test("pipeline: RT fora do ar -> OMDb (IMDb) e cache curto", async () => {
  const routes = godfatherRoutes({
    "rottentomatoes.com": { status: 503 },
    omdbapi: { json: { Response: "True", imdbRating: "9.2", imdbVotes: "2,262,742", Ratings: [] } },
  });
  delete routes["rottentomatoes.com/search"];
  delete routes["rottentomatoes.com/m/the_godfather"];
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(res.value.source, "imdb");
  assert.equal(res.value.rating, 9.2);
  const entry = Object.values(bg.store).find((e) => e && e.expires);
  assert.ok(entry.expires < Date.now() + 2 * 24 * 3600 * 1000, "reserva com RT instável expira em 1 dia");
});

test("pipeline: OMDb traz Tomatometer quando o RT não tem a página", async () => {
  const routes = godfatherRoutes({
    "rottentomatoes.com/search": { text: rtSearch([]) },
    omdbapi: { json: { Response: "True", imdbRating: "9.2", imdbVotes: "100", Ratings: [{ Source: "Rotten Tomatoes", Value: "97%" }], tomatoURL: "https://www.rottentomatoes.com/m/godfather/" } },
  });
  delete routes["rottentomatoes.com/m/the_godfather"];
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(res.value.source, "rt");
  assert.equal(res.value.critics, 97);
  assert.equal(res.value.audience, null);
});

test("pipeline: URL adivinhada só vale se o ano da página bater", async () => {
  const base = {
    "search/multi": tmdbSearch([{ id: 94605, media_type: "tv", name: "Arcane", original_name: "Arcane", first_air_date: "2021-11-06", vote_count: 5000, popularity: 50 }]),
    "3/tv/94605": { json: { name: "Arcane", original_name: "Arcane", original_language: "en", first_air_date: "2021-11-06", external_ids: { imdb_id: "tt11126994" }, vote_average: 8.8, vote_count: 5000 } },
    "rottentomatoes.com/search": { text: rtSearch([]) },
    omdbapi: { json: { Response: "True", imdbRating: "9.0", imdbVotes: "400,000", Ratings: [] } },
  };
  const good = loadBackground({ routes: { ...base, "rottentomatoes.com/tv/arcane": { text: rtPage({ critics: 100, audience: 96, props: ["TV-14", "2021 - Present"] }) } } });
  const r1 = await good.send({ type: "getScore", title: "Arcane" });
  assert.equal(r1.value.source, "rt");
  assert.equal(r1.value.critics, 100);

  const wrong = loadBackground({ routes: { ...base, "rottentomatoes.com/tv/arcane": { text: rtPage({ critics: 50, audience: 50, props: ["TV-PG", "1998"] }) } } });
  const r2 = await wrong.send({ type: "getScore", title: "Arcane" });
  assert.equal(r2.value.source, "imdb", "página de outra obra (1998) é descartada");
});

test("pipeline: sem casamento no TMDB -> null com cache negativo; erro de rede -> cache curto", async () => {
  const none = loadBackground({ routes: { "search/multi": tmdbSearch([]) } });
  const r1 = await none.send({ type: "getScore", title: "Pixar" });
  assert.equal(r1.value, null);
  const e1 = Object.values(none.store)[0];
  assert.ok(e1.expires > Date.now() + 20 * 3600 * 1000);

  const offline = loadBackground({ routes: { themoviedb: new Error("offline") } });
  const r2 = await offline.send({ type: "getScore", title: "Pixar" });
  assert.equal(r2.value, null);
  const e2 = Object.values(offline.store)[0];
  assert.ok(e2.expires < Date.now() + 20 * 60 * 1000, "falha de rede expira em 15 min");
});

test("mensagens: título vazio é ignorado; aspas tipográficas viram retas; limpar cache avisa as abas", async () => {
  const seen = [];
  const bg = loadBackground({ routes: { "search/multi": tmdbSearch([]) }, onFetch: (u) => seen.push(u) });
  assert.equal(await bg.send({ type: "getScore", title: "   " }), undefined);
  await bg.send({ type: "getScore", title: "It’s Okay" });
  assert.ok(seen[0].includes("query=It%27s+Okay"));
  bg.store["v5:velho"] = { value: 1, expires: Date.now() + 1e9 };
  const res = await bg.send({ type: "clearCache" });
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(bg.store), ["vop:clearedAt"]);
});

test("pruneCache tira versão antiga e vencido, mantém o válido", async () => {
  const bg = loadBackground();
  Object.assign(bg.store, {
    "v6:x": { value: 1, expires: Date.now() + 1e9 },
    "v9:vencido": { value: 1, expires: Date.now() - 1 },
    "v9:ok": { value: 1, expires: Date.now() + 1e9 },
    "vop:clearedAt": 1,
    "vop:algolia": { aId: "X", sId: "y" },
  });
  await bg.run("pruneCache()");
  assert.deepEqual(Object.keys(bg.store).sort(), ["v9:ok", "vop:algolia", "vop:clearedAt"]);
});

// ---------------------------------------------------------------------------
// v3.1: Wikidata + índice de busca do RT (Algolia)
// ---------------------------------------------------------------------------

// Resposta do índice no formato real (campos que a extensão pede).
const hit = (o) => ({
  title: o.title,
  titles: o.titles || [o.title],
  aka: o.aka || [],
  type: o.type || "movie",
  releaseYear: o.year,
  vanity: o.vanity,
  rottenTomatoes:
    o.critics === undefined && o.audience === undefined
      ? undefined
      : { ...(o.critics != null ? { criticsScore: o.critics } : {}), ...(o.audience != null ? { audienceScore: o.audience } : {}), certifiedFresh: !!o.cf },
});
const algolia = (...hits) => ({ json: { results: [{ hits }] } });
const wikidata = (...paths) => ({ json: { results: { bindings: paths.map((p) => ({ rt: { type: "literal", value: p } })) } } });

const tmdbMovie = (id, o) => ({
  [`3/movie/${id}`]: { json: { title: o.en, original_title: o.orig || o.en, original_language: o.lang || "en", release_date: `${o.year}-01-01`, imdb_id: o.imdb, vote_average: 8, vote_count: 5000, alternative_titles: { titles: o.alt || [] } } },
});
const tmdbTv = (id, o) => ({
  [`3/tv/${id}`]: { json: { name: o.en, original_name: o.orig || o.en, original_language: o.lang || "en", first_air_date: `${o.year}-01-01`, external_ids: { imdb_id: o.imdb }, vote_average: 8, vote_count: 5000, alternative_titles: { results: o.alt || [] } } },
});

function squidRoutes(extra = {}) {
  return {
    "search/multi": tmdbSearch([{ id: 93405, media_type: "tv", name: "Round 6", original_name: "오징어 게임", first_air_date: "2021-09-17", vote_count: 15000, popularity: 80 }]),
    ...tmdbTv(93405, { en: "Squid Game", orig: "오징어 게임", lang: "ko", year: 2021, imdb: "tt10919420" }),
    "query.wikidata.org": wikidata("tv/squid_game"),
    "algolia.net": algolia(
      hit({ title: "Squid Game: The Challenge", type: "tv", year: 2023, vanity: "squid_game_the_challenge", critics: 70, audience: 20 }),
      hit({ title: "Squid Game", type: "tv", year: 2021, vanity: "squid_game", critics: 86, audience: 67 })
    ),
    ...extra,
  };
}

test("Wikidata aponta a página e o índice já traz as duas notas: sem abrir página, sem OMDb", async () => {
  const bg = loadBackground({ routes: squidRoutes() });
  const res = await bg.send({ type: "getScore", title: "Round 6" });
  assert.equal(res.value.source, "rt");
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/squid_game");
  assert.equal(res.value.critics, 86);
  assert.equal(res.value.audience, 67);
  assert.equal(res.value.match, "Squid Game (2021)");
  assert.ok(!bg.calls.some((u) => u.includes("rottentomatoes.com")), "nenhuma página do RT aberta");
  assert.ok(!bg.calls.some((u) => u.includes("omdbapi")));
  assert.equal(bg.calls.length, 4); // TMDB (2) + Wikidata + índice
});

test("índice sem uma das notas: a página do RT completa (caso real: Pantera Negra)", async () => {
  const bg = loadBackground({
    routes: {
      "search/multi": tmdbSearch([{ id: 284054, media_type: "movie", title: "Pantera Negra", original_title: "Black Panther", release_date: "2018-02-13", vote_count: 22000, popularity: 30 }]),
      ...tmdbMovie(284054, { en: "Black Panther", year: 2018, imdb: "tt1825683" }),
      "query.wikidata.org": wikidata("m/black_panther_2018"),
      "algolia.net": algolia(hit({ title: "Black Panther", year: 2018, vanity: "black_panther_2018", critics: 96 })),
      "rottentomatoes.com/m/black_panther_2018": { text: rtPage({ critics: 96, audience: 79, props: ["PG-13", "2018"] }) },
    },
  });
  const res = await bg.send({ type: "getScore", title: "Pantera Negra" });
  assert.equal(res.value.critics, 96);
  assert.equal(res.value.audience, 79);
});

test("sem Wikidata: o índice decide por nome, tipo e ano (remake não rouba)", async () => {
  const routes = {
    "search/multi": tmdbSearch([{ id: 1, media_type: "movie", title: "Rebecca: A Mulher Inesquecível", original_title: "Rebecca", release_date: "2020-10-16", vote_count: 1500, popularity: 10 }]),
    ...tmdbMovie(1, { en: "Rebecca", year: 2020, imdb: "tt2235695" }),
    "algolia.net": algolia(
      hit({ title: "Rebecca", year: 1940, vanity: "1017293-rebecca", critics: 98, audience: 92 }),
      hit({ title: "Rebecca", year: 2020, vanity: "rebecca_2020", critics: 44, audience: 41 }),
      hit({ title: "Rebecca", type: "tv", year: 2020, vanity: "rebecca", critics: 10, audience: 10 })
    ),
  };
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "Rebecca: A Mulher Inesquecível" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/m/rebecca_2020");
  assert.equal(res.value.critics, 44);
});

test("nome alternativo dos EUA (TMDB) acha o título que o RT chama diferente: Detective Conan = Case Closed", async () => {
  const routes = {
    "search/multi": tmdbSearch([{ id: 30983, media_type: "tv", name: "Detetive Conan", original_name: "名探偵コナン", first_air_date: "1996-01-08", vote_count: 900, popularity: 60 }]),
    ...tmdbTv(30983, { en: "Detective Conan", orig: "名探偵コナン", lang: "ja", year: 1996, imdb: "tt0131179", alt: [{ iso_3166_1: "US", title: "Case Closed" }, { iso_3166_1: "FR", title: "Détective Conan" }] }),
    "algolia.net": (url, init) => {
      const body = JSON.parse(init.body);
      const queries = body.requests.map((r) => new URLSearchParams(r.params).get("query"));
      assert.ok(queries.includes("Case Closed"), "busca também pelo nome dos EUA");
      assert.ok(!queries.includes("名探偵コナン"), "original em japonês não vai pra busca");
      return algolia(hit({ title: "Case Closed", type: "tv", year: 1996, vanity: "case_closed_1996", audience: 88 }));
    },
    "rottentomatoes.com/tv/case_closed_1996": { text: rtPage({ critics: null, audience: 88, props: ["TV-14", "1996"] }) },
  };
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "Detetive Conan" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/case_closed_1996");
  assert.equal(res.value.audience, 88);
});

test("pickAlgolia: apelido curto não casa (Monster x Monster of Florence); número por extenso casa", () => {
  const bg = loadBackground();
  const pick = (hits, info) => bg.ctx.pickAlgolia(hits, info, null)?.vanity ?? null;
  const florence = hit({ title: "The Monster of Florence", titles: ["The Monster of Florence", "The Monster", "Monster"], type: "tv", year: 2025, vanity: "the_monster_of_florence" });
  assert.equal(pick([florence], { type: "tv", enTitle: "Monster: The Lizzie Borden Story", year: 2026 }), null);
  const ff = hit({ title: "The Fantastic Four: First Steps", year: 2025, vanity: "the_fantastic_four_first_steps" });
  assert.equal(pick([ff], { type: "movie", enTitle: "The Fantastic 4: First Steps", year: 2025 }), "the_fantastic_four_first_steps");
  // subtítulo do RT só com nome principal + ano exato
  const arcane = hit({ title: "Arcane: League of Legends", type: "tv", year: 2021, vanity: "arcane_league_of_legends" });
  assert.equal(pick([arcane], { type: "tv", enTitle: "Arcane", year: 2021 }), "arcane_league_of_legends");
  assert.equal(pick([arcane], { type: "tv", enTitle: "Arcane", year: 2022 }), null);
  // filme cadastrado como série no RT: só com nome exato e mesmo ano
  const shark = hit({ title: "Hammerhead Sharks Up Close With Bertie Gregory", type: "tv", year: 2026, vanity: "hammerhead" });
  assert.equal(pick([shark], { type: "movie", enTitle: "Hammerhead Sharks Up Close with Bertie Gregory", year: 2026 }), "hammerhead");
  assert.equal(pick([shark], { type: "movie", enTitle: "Hammerhead Sharks Up Close with Bertie Gregory", year: 2025 }), null);
  // apelido em português (aka) vale pra filme
  const gf = hit({ title: "The Godfather", aka: ["Der Pate", "O Poderoso Chefão"], year: 1972, vanity: "the_godfather" });
  assert.equal(bg.ctx.pickAlgolia([gf], { type: "movie", enTitle: "Mario Puzo's Mob Saga", year: 1972 }, "O Poderoso Chefão")?.vanity, "the_godfather");
  assert.equal(bg.ctx.pickAlgolia([gf], { type: "movie", enTitle: "Mario Puzo's Mob Saga", year: 1972 }, null), null);
});

test("Wikidata no limite de ritmo (429): tenta de novo uma vez e não marca erro temporário", async () => {
  let n = 0;
  const bg = loadBackground({
    routes: squidRoutes({ "query.wikidata.org": () => (++n === 1 ? { status: 429 } : wikidata("tv/squid_game")) }),
  });
  const res = await bg.send({ type: "getScore", title: "Round 6" });
  assert.equal(n, 2);
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/squid_game");
  const entry = Object.entries(bg.store).find(([k]) => k.startsWith("v9:"))[1];
  assert.ok(entry.expires > Date.now() + 6 * 24 * 3600 * 1000, "cache cheio de 7 dias");
});

test("Wikidata fora do ar: o índice sozinho resolve", async () => {
  const bg = loadBackground({ routes: squidRoutes({ "query.wikidata.org": new Error("offline") }) });
  const res = await bg.send({ type: "getScore", title: "Round 6" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/squid_game");
  assert.equal(res.value.critics, 86);
});

test("chave do índice recusada: relê a chave pública na home do RT e guarda", async () => {
  const seenKeys = [];
  const bg = loadBackground({
    routes: squidRoutes({
      "algolia.net": (url, init) => {
        const key = init.headers["x-algolia-api-key"];
        seenKeys.push(key);
        if (key !== "novachave123") return { status: 403 };
        return algolia(hit({ title: "Squid Game", type: "tv", year: 2021, vanity: "squid_game", critics: 86, audience: 67 }));
      },
      "rottentomatoes.com/": { text: `root.RottenTomatoes.thirdParty = {"algoliaSearch":{"aId":"79FRDP12PN","sId":"novachave123"}};` },
    }),
  });
  const res = await bg.send({ type: "getScore", title: "Round 6" });
  assert.equal(res.value.critics, 86);
  assert.deepEqual(seenKeys, ["175588f6e5f8319b27702e4cc4013561", "novachave123"]);
  assert.equal(bg.store["vop:algolia"].sId, "novachave123");
});

test("TMDB não acha: o nome exibido casa direto com o apelido no índice (só se for único)", async () => {
  const one = loadBackground({
    routes: {
      "search/multi": tmdbSearch([]),
      "algolia.net": algolia(hit({ title: "City of God", aka: ["Cidade de Deus"], year: 2002, vanity: "city_of_god", critics: 91, audience: 97 })),
    },
  });
  const r1 = await one.send({ type: "getScore", title: "Cidade de Deus" });
  assert.equal(r1.value.url, "https://www.rottentomatoes.com/m/city_of_god");
  assert.equal(r1.value.match, "City of God (2002)");

  const two = loadBackground({
    routes: {
      "search/multi": tmdbSearch([]),
      "algolia.net": algolia(
        hit({ title: "Rebecca", year: 1940, vanity: "a", critics: 98, audience: 92 }),
        hit({ title: "Rebecca", year: 2020, vanity: "b", critics: 44, audience: 41 })
      ),
    },
  });
  const r2 = await two.send({ type: "getScore", title: "Rebecca" });
  assert.equal(r2.value, null, "ambíguo: sem nota é melhor que nota errada");
});

test("título no RT mas sem nota nenhuma: segue pras reservas (IMDb)", async () => {
  const bg = loadBackground({
    routes: squidRoutes({
      "algolia.net": algolia(hit({ title: "Squid Game", type: "tv", year: 2021, vanity: "squid_game" })),
      "rottentomatoes.com/tv/squid_game": { text: rtPage({ critics: null, audience: null }) },
      omdbapi: { json: { Response: "True", imdbRating: "8.0", imdbVotes: "600,000", Ratings: [] } },
    }),
  });
  const res = await bg.send({ type: "getScore", title: "Round 6" });
  assert.equal(res.value.source, "imdb");
});

// ---- Série longa sem nota de críticos da série: média das temporadas ----

const seriesPage = (path, seasons, { critics = null, audience = 76 } = {}) => `
<html><body>
<script id="media-hero-json" type="application/json">{"content":{"metadataProps":["TV-PG","1989 - Present"]}}</script>
<script id="media-scorecard-json" data-json="mediaScorecard" type="application/json">
  {"audienceScore":{"score":${audience == null ? "null" : `"${audience}"`}},"criticsScore":{"score":${critics == null ? "null" : `"${critics}"`},"title":"Avg. Tomatometer"}}
</script>
${seasons
  .map(
    ([s, v]) => `<tile-season slot="tile" href="/${path}/${s}" skeleton="panel"><rt-text slot="title">Season</rt-text>
  <score-icon-critics certified="false" sentiment="" slot="critics-icon"></score-icon-critics>
  <rt-text slot="critics-score" size="0.75" context="label">${v == null ? "" : v + "%"}</rt-text></tile-season>`
  )
  .join("\n")}
<tile-season slot="tile" href="/tv/outra_serie/s01"><rt-text slot="critics-score">10%</rt-text></tile-season>
</body></html>`;

test("parseRtSeasons: média simples das temporadas com nota, sem partes/especiais nem outras séries", () => {
  const bg = loadBackground();
  const html = seriesPage("tv/the_simpsons", [["s38", null], ["s37.2", 20], ["s02", 100], ["s01", 70]]);
  const s = bg.ctx.parseRtSeasons(html, "tv/the_simpsons");
  assert.deepEqual({ ...s }, { critics: 85, rated: 2, total: 3 });
  assert.equal(bg.ctx.parseRtSeasons(seriesPage("tv/x", [["s01", null]]), "tv/x"), null);
});

function simpsonsRoutes(page) {
  return {
    "search/multi": tmdbSearch([{ id: 456, media_type: "tv", name: "Os Simpsons", original_name: "The Simpsons", first_air_date: "1989-12-17", vote_count: 10000, popularity: 90 }]),
    ...tmdbTv(456, { en: "The Simpsons", year: 1989, imdb: "tt0096697" }),
    "query.wikidata.org": wikidata("tv/the_simpsons"),
    "algolia.net": algolia(hit({ title: "The Simpsons", type: "tv", year: 1989, vanity: "the_simpsons", audience: 76 })),
    "rottentomatoes.com/tv/the_simpsons": { text: page },
  };
}

test("série sem nota de críticos da série: usa a média das temporadas (sem requisição extra)", async () => {
  const bg = loadBackground({ routes: simpsonsRoutes(seriesPage("tv/the_simpsons", [["s03", null], ["s02", 100], ["s01", 80]])) });
  const res = await bg.send({ type: "getScore", title: "Os Simpsons" });
  assert.equal(res.value.source, "rt");
  assert.equal(res.value.critics, 90);
  assert.equal(res.value.audience, 76);
  assert.deepEqual({ ...res.value.criticsSeasons }, { rated: 2, total: 3 });
  assert.equal(bg.calls.filter((u) => u.includes("rottentomatoes.com/tv/")).length, 1, "só a página da série");
});

test("série com nota da série inteira: não mexe; sem nenhuma temporada avaliada: fica só a audiência", async () => {
  const withAvg = loadBackground({ routes: simpsonsRoutes(seriesPage("tv/the_simpsons", [["s02", 100], ["s01", 80]], { critics: 88 })) });
  const r1 = await withAvg.send({ type: "getScore", title: "Os Simpsons" });
  assert.equal(r1.value.critics, 88);
  assert.equal(r1.value.criticsSeasons, undefined);

  const none = loadBackground({ routes: simpsonsRoutes(seriesPage("tv/the_simpsons", [["s02", null], ["s01", null]])) });
  const r2 = await none.send({ type: "getScore", title: "Os Simpsons" });
  assert.equal(r2.value.critics, null);
  assert.equal(r2.value.audience, 76);
});

// ---- Homônimos: desempate pelo catálogo do serviço no Brasil ----

const providers = (...ids) => ({ json: { results: { BR: { flatrate: ids.map((id) => ({ provider_id: id })) } } } });

function animalKingdomRoutes() {
  return {
    "search/multi": tmdbSearch([
      { id: 44629, media_type: "movie", title: "Reino Animal", original_title: "Animal Kingdom", release_date: "2010-06-03", vote_count: 1500, popularity: 12 },
      { id: 66025, media_type: "tv", name: "Animal Kingdom", original_name: "Animal Kingdom", first_air_date: "2016-06-14", vote_count: 900, popularity: 30 },
    ]),
    "3/movie/44629/watch/providers": providers(),
    "3/tv/66025/watch/providers": providers(8),
    ...tmdbMovie(44629, { en: "Animal Kingdom", year: 2010, imdb: "tt1313092" }),
    ...tmdbTv(66025, { en: "Animal Kingdom", year: 2016, imdb: "tt5574490" }),
    "query.wikidata.org": (url) => wikidata(url.includes("tt5574490") ? "tv/animal_kingdom" : "m/animal_kingdom"),
    "algolia.net": algolia(
      hit({ title: "Animal Kingdom", type: "movie", year: 2010, vanity: "animal_kingdom", critics: 97, audience: 83 }),
      hit({ title: "Animal Kingdom", type: "tv", year: 2016, vanity: "animal_kingdom", critics: 89, audience: 85 })
    ),
  };
}

test("homônimo filme x série: na Netflix, fica com o que está no catálogo dela", async () => {
  const bg = loadBackground({ routes: animalKingdomRoutes() });
  const res = await bg.send({ type: "getScore", title: "Animal Kingdom", site: "netflix" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/animal_kingdom");
  assert.equal(res.value.critics, 89);
});

test("homônimo sem saber o serviço (ou fora de empate): não consulta disponibilidade", async () => {
  const bg = loadBackground({ routes: animalKingdomRoutes() });
  const res = await bg.send({ type: "getScore", title: "Animal Kingdom" });
  assert.ok(!bg.calls.some((u) => u.includes("watch/providers")));
  assert.ok(res.value.url); // segue a pontuação normal
  const detail = loadBackground({ routes: animalKingdomRoutes() });
  await detail.send({ type: "getScore", title: "Animal Kingdom", year: 2016, mediaType: "tv", site: "netflix" });
  assert.ok(!detail.calls.some((u) => u.includes("watch/providers")), "ano e tipo já desempatam");
});

// ---------------------------------------------------------------------------
// v3.2: código do título da Netflix, lotes e cache por idade
// ---------------------------------------------------------------------------

// Wikidata que responde a lista de chaves (VALUES) pedida na consulta.
function wikidataByKey(table) {
  return (url) => {
    const q = decodeURIComponent(url.split("query=")[1] || "");
    const keys = [...q.matchAll(/"([a-z]+:[^"]+)"\)/g)].map((m) => m[1]);
    const bindings = [];
    for (const k of keys) {
      const row = table[k];
      if (!row) continue;
      bindings.push({
        key: { value: k },
        ...(row.rt ? { rt: { value: row.rt } } : {}),
        ...(row.label ? { label: { value: row.label } } : {}),
        ...(row.year ? { year: { value: String(row.year) } } : {}),
      });
    }
    return { json: { results: { bindings } } };
  };
}

// Índice do RT que responde cada busca do POST pelo título exato.
function algoliaByTitle(hitsList) {
  return (url, init) => {
    const reqs = JSON.parse(init.body).requests;
    return {
      json: {
        results: reqs.map((r) => {
          const q = new URLSearchParams(r.params).get("query");
          return { hits: hitsList.filter((h) => h.title === q) };
        }),
      },
    };
  };
}

test("Netflix: o código do card vai direto ao RT pelo Wikidata, sem TMDB", async () => {
  const bg = loadBackground({
    routes: {
      "query.wikidata.org": wikidataByKey({ "nf:81040344": { rt: "tv/squid_game", label: "Squid Game", year: 2021 } }),
      "algolia.net": algoliaByTitle([hit({ title: "Squid Game", type: "tv", year: 2021, vanity: "squid_game", critics: 86, audience: 67 })]),
    },
  });
  const res = await bg.send({ type: "getScore", title: "Round 6", site: "netflix", nfId: "81040344" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/squid_game");
  assert.equal(res.value.critics, 86);
  assert.equal(res.value.match, "Squid Game (2021)");
  assert.ok(!bg.calls.some((u) => u.includes("themoviedb")), "nenhuma chamada ao TMDB");
  assert.ok(!bg.calls.some((u) => u.includes("rottentomatoes.com/tv/")), "nem à página do RT");
  assert.ok(Object.keys(bg.store).includes("v9:nf:81040344"), "cache pelo código");
});

test("Netflix: código que o Wikidata não conhece cai no caminho por nome", async () => {
  const routes = squidRoutes();
  routes["query.wikidata.org"] = (url) => (decodeURIComponent(url).includes("nf:") ? { json: { results: { bindings: [] } } } : wikidata("tv/squid_game"));
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "Round 6", site: "netflix", nfId: "99999999" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/squid_game");
  assert.ok(bg.calls.some((u) => u.includes("themoviedb")));
});

test("lote: 30 cards da Netflix = 2 consultas ao Wikidata (lotes de 25) e 1 POST ao índice", async () => {
  const table = {};
  const hits = [];
  for (let i = 0; i < 30; i++) {
    table[`nf:8000${1000 + i}`] = { rt: `m/filme_${i}`, label: `Filme ${i}`, year: 2010 };
    hits.push(hit({ title: `Filme ${i}`, type: "movie", year: 2010, vanity: `filme_${i}`, critics: 50 + i, audience: 60 }));
  }
  const bg = loadBackground({ routes: { "query.wikidata.org": wikidataByKey(table), "algolia.net": algoliaByTitle(hits) } });
  const res = await Promise.all(
    Object.keys(table).map((k, i) => bg.send({ type: "getScore", title: `Título ${i}`, site: "netflix", nfId: k.slice(3) }))
  );
  assert.equal(res.filter((r) => r.value?.source === "rt").length, 30);
  assert.equal(res[7].value.critics, 57);
  assert.equal(bg.calls.filter((u) => u.includes("wikidata")).length, 2);
  assert.equal(bg.calls.filter((u) => u.includes("algolia")).length, 1);
});

test("validade pela idade do título", () => {
  const bg = loadBackground();
  const ttl = (v, t = false) => bg.ctx.ttlFor(v, t) / (24 * 3600 * 1000);
  const y = new Date().getFullYear();
  assert.equal(ttl({ source: "rt", year: y }), 2);
  assert.equal(ttl({ source: "rt", year: y - 3 }), 7);
  assert.equal(ttl({ source: "rt", year: 1972 }), 30);
  assert.equal(ttl({ source: "imdb", year: 1972 }), 3);
  assert.equal(ttl(null), 1);
  assert.ok(ttl(null, true) < 0.02, "falha de rede: 15 min");
});

test("nota vencida volta na hora e atualiza por trás", async () => {
  let critics = 97;
  const routes = godfatherRoutes();
  routes["rottentomatoes.com/m/the_godfather"] = () => ({ text: rtPageFor(critics) });
  const bg = loadBackground({ routes });
  const key = "v9:o poderoso chefao|||";
  bg.store[key] = {
    value: { source: "rt", critics: 90, audience: 90, url: "x", year: 1972 },
    expires: Date.now() - 1000,
    stale: Date.now() + 1e9,
  };
  critics = 97;
  const first = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(first.value.critics, 90, "devolve a antiga sem esperar");
  await new Promise((r) => setTimeout(r, 300)); // lotes esperam ~50ms pra juntar pedidos
  const second = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(second.value.critics, 97, "a atualização em segundo plano já entrou");
});

function rtPageFor(critics) {
  return rtPage({ critics, audience: 98 });
}

test("Wikidata com 2 endereços da mesma obra (um vazio): fica com o que tem nota", async () => {
  const routes = {
    "search/multi": tmdbSearch([{ id: 4574, media_type: "tv", name: "X-Men", original_name: "X-Men", first_air_date: "1992-10-31", vote_count: 900, popularity: 20 }]),
    ...tmdbTv(4574, { en: "X-Men", year: 1992, imdb: "tt0103584" }),
    // a página vazia vem primeiro (a ordem do Wikidata não é garantida)
    "query.wikidata.org": wikidata("tv/x_men_1992", "tv/x_men"),
    "algolia.net": algolia(hit({ title: "X-Men", type: "tv", year: 1992, vanity: "x_men", critics: 83, audience: 87 })),
    "rottentomatoes.com/tv/x_men_1992": { text: rtPage({ critics: null, audience: null }) },
  };
  const bg = loadBackground({ routes });
  const res = await bg.send({ type: "getScore", title: "X-Men", site: "disney" });
  assert.equal(res.value.url, "https://www.rottentomatoes.com/tv/x_men");
  assert.equal(res.value.critics, 83);
  assert.ok(!bg.calls.some((u) => u.includes("x_men_1992")), "o índice já mostrou qual tem nota");
});

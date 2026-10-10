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

test("pipeline: TMDB -> busca RT -> página RT, sem gastar OMDb", async () => {
  const bg = loadBackground({ routes: { ...godfatherRoutes(), omdbapi: { json: { Response: "False" } } } });
  const res = await bg.send({ type: "getScore", title: "O Poderoso Chefão" });
  assert.equal(res.ok, true);
  assert.equal(res.value.source, "rt");
  assert.equal(res.value.critics, 97);
  assert.equal(res.value.audience, 98);
  assert.equal(res.value.url, "https://www.rottentomatoes.com/m/the_godfather");
  assert.equal(res.value.match, "The Godfather (1972)");
  assert.equal(bg.calls.filter((u) => u.includes("omdbapi")).length, 0);
  assert.equal(bg.calls.length, 4);
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
  const keys = Object.keys(bg.store).filter((k) => k.startsWith("v6:"));
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
    "v5:x": { value: 1, expires: Date.now() + 1e9 },
    "v6:vencido": { value: 1, expires: Date.now() - 1 },
    "v6:ok": { value: 1, expires: Date.now() + 1e9 },
    "vop:clearedAt": 1,
  });
  await bg.run("pruneCache()");
  assert.deepEqual(Object.keys(bg.store).sort(), ["v6:ok", "vop:clearedAt"]);
});

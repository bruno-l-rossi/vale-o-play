// Checagem de saúde contra os serviços DE VERDADE (rede real).
// Roda toda semana no GitHub Actions (.github/workflows/checagem-semanal.yml)
// e também à mão: node tests/health.js
//
// Falha (código de saída 1) quando alguma peça que a extensão usa mudou:
// a chave pública do índice do RT, o HTML da página do RT, o Wikidata ou o
// casamento de títulos conhecidos. O GitHub manda e-mail quando falha.
"use strict";

const { loadBackground } = require("./load-background");

// O fetch do Node se apresenta como "node" e o RT costuma recusar. Usa um
// User-Agent de navegador, como a extensão faz (o Chrome manda o dele).
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const realFetch = (url, init = {}) =>
  fetch(url, { ...init, headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.8", ...(init.headers || {}) } });

// Status HTTP de cada fonte, pra o log dizer qual delas caiu.
async function status(url, init) {
  try {
    return (await realFetch(url, { ...init, redirect: "manual" })).status;
  } catch (e) {
    return `erro de rede (${e.message})`;
  }
}

// Títulos estáveis, com o endereço certo no RT. Mistura os caminhos:
// código da Netflix, nome em português, série com média de temporadas e
// homônimo desempatado pelo catálogo.
const CASES = [
  { title: "Round 6", site: "netflix", nfId: "81040344", expect: "tv/squid_game" },
  { title: "O Poderoso Chefão", site: "netflix", nfId: "60011152", expect: "m/the_godfather" },
  { title: "Stranger Things", site: "netflix", nfId: "80057281", expect: "tv/stranger_things" },
  { title: "Wandinha", site: "netflix", expect: "tv/wednesday" },
  { title: "Cidade de Deus", site: "netflix", expect: "m/city_of_god" },
  { title: "Adolescência", site: "netflix", expect: "tv/adolescence" },
  { title: "Ataque dos Cães", site: "netflix", expect: "m/the_power_of_the_dog" },
  { title: "La Casa de Papel", site: "netflix", expect: "tv/money_heist" },
  { title: "Arcane", site: "netflix", expect: "tv/arcane_league_of_legends" },
  { title: "Animal Kingdom", site: "netflix", expect: "tv/animal_kingdom" },
  { title: "Divertida Mente 2", site: "disney", expect: "m/inside_out_2" },
  { title: "Os Simpsons", site: "disney", expect: "tv/the_simpsons", seasons: true },
  { title: "Andor", site: "disney", expect: "tv/andor" },
  { title: "Xógum: A Gloriosa Saga do Japão", site: "disney", expect: "tv/shogun_2024" },
  { title: "O Urso", site: "disney", expect: "tv/the_bear" },
  { title: "Toy Story", site: "disney", expect: "m/toy_story" },
  { title: "Encanto", site: "disney", expect: "m/encanto_2021" },
  { title: "Avatar: O Caminho da Água", site: "disney", expect: "m/avatar_the_way_of_water" },
];

const MIN_OK = CASES.length - 2; // tolera 2 mudanças pontuais de catálogo

const path = (url) => String(url || "").replace("https://www.rottentomatoes.com/", "").replace(/\/+$/, "");

async function main() {
  const problems = [];
  const warnings = [];
  const bg = loadBackground({ realFetch });
  const blocked = (code) => code === 403 || code === 429;

  console.log("Fontes:");
  const rtStatus = await status("https://www.rottentomatoes.com/m/the_godfather");
  const wdStatus = await status("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent("ASK{}"));
  const tmdbStatus = await status("https://api.themoviedb.org/3/configuration");
  console.log(`  RT página: ${rtStatus}\n  Wikidata: ${wdStatus}\n  TMDB (sem chave, 401 é normal): ${tmdbStatus}\n`);
  const rtBlocked = blocked(rtStatus);
  if (rtBlocked) warnings.push(`RT recusou a página (${rtStatus}): a checagem não consegue ler notas daqui; as notas pelo índice seguem testadas`);
  const run = (code) => bg.run(code);

  // 1. Peças isoladas: se uma delas quebrar, o resto pode até mascarar
  const raw = await bg.ctx.algoliaRaw([{ query: "The Godfather", filters: "type:movie", hits: 5 }]);
  const idxHit = raw && raw[0] && raw[0].find((h) => h.vanity === "the_godfather");
  if (!idxHit) problems.push("índice de busca do RT: sem resposta ou sem 'The Godfather' (chave pública mudou?)");
  else if (idxHit.rottenTomatoes?.criticsScore == null) problems.push("índice de busca do RT: veio sem as notas (formato mudou?)");

  const html = await run("getText")("https://www.rottentomatoes.com/m/the_godfather", { transient: false });
  const page = bg.ctx.parseRtScores(html);
  if (!rtBlocked && (!page || page.critics == null || page.audience == null)) problems.push("página do RT: não deu pra ler as notas (HTML mudou? ver parseRtScores)");
  const seasonsHtml = await run("getText")("https://www.rottentomatoes.com/tv/the_simpsons", { transient: false });
  if (!rtBlocked && !bg.ctx.parseRtSeasons(seasonsHtml, "tv/the_simpsons")) problems.push("página de série do RT: não deu pra ler as temporadas (ver parseRtSeasons)");

  try {
    const wd = await bg.ctx.wikidataLookup(["nf:81040344", "imdb:tt0068646"]);
    if (!wd.get("nf:81040344")?.paths.includes("tv/squid_game")) problems.push("Wikidata: código da Netflix não levou ao RT");
    if (!wd.get("imdb:tt0068646")?.paths.includes("m/the_godfather")) problems.push("Wikidata: IMDb id não levou ao RT");
  } catch (e) {
    problems.push("Wikidata: fora do ar ou consulta recusada");
  }

  // 2. Pipeline completo, como a extensão faz
  let ok = 0;
  const lines = [];
  for (const c of CASES) {
    const res = await bg.send({ type: "getScore", title: c.title, site: c.site, nfId: c.nfId });
    const v = res && res.value;
    const got = path(v && v.url);
    const good = v && v.source === "rt" && got === c.expect && (v.critics != null || v.audience != null) &&
      (!c.seasons || v.critics != null);
    if (good) ok++;
    lines.push(`${good ? "ok  " : "FALHA"} ${c.title} -> ${v ? `${v.source} ${got} ${v.critics ?? "-"}/${v.audience ?? "-"}` : "sem nota"}${good ? "" : ` (esperado ${c.expect})`}`);
  }
  console.log(lines.join("\n"));
  console.log(`\n${ok}/${CASES.length} títulos certos (mínimo ${MIN_OK})`);
  if (ok < MIN_OK) {
    const msg = `só ${ok} de ${CASES.length} títulos casaram com a página certa do RT`;
    (rtBlocked ? warnings : problems).push(msg);
  }

  if (warnings.length) console.warn("\nAVISOS (não reprovam):\n- " + warnings.join("\n- "));
  if (problems.length) {
    console.error("\nPROBLEMAS:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("\nTudo certo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

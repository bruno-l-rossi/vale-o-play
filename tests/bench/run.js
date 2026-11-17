// Bench de cobertura com a rede de verdade (rode no seu computador):
//
//   node tests/bench/run.js            # cache novo a cada execução
//   node tests/bench/run.js --json     # saída em JSON (pra comparar entre versões)
//
// Lê tools/titulos.json (title, site, nfId/dpId opcionais, expect opcional) e
// passa cada título pelo mesmo pipeline da extensão. Mede:
//   - RT: quantos saíram do Rotten Tomatoes, com críticos e audiência
//   - planos B/C: quantos caíram no IMDb (OMDb) ou no TMDB
//   - certos: dos que têm "expect", quantos acharam a página certa
//   - motivos: por que não veio do RT (rt_absent, no_tmdb_match, transient...)
// Se o RT recusar sua rede (403/429), "transient" sobe e RT_alcançável cai:
// nesse caso o resultado diz mais da rede do que da extensão.
"use strict";

const fs = require("fs");
const path = require("path");
const { loadBackground } = require("../load-background");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const realFetch = (url, init = {}) => fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) } });
const rtPath = (url) => String(url || "").replace("https://www.rottentomatoes.com/", "").replace(/\/+$/, "");

async function main() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tools", "titulos.json"), "utf8"));
  const bg = loadBackground({ realFetch });
  const rows = [];
  for (const c of list) {
    const res = await bg.send({ type: "getScore", title: c.title, site: c.site, nfId: c.nfId, dpId: c.dpId, fresh: true });
    const v = res && res.value;
    rows.push({
      title: c.title,
      site: c.site,
      source: v ? v.source : "none",
      both: !!v && v.source === "rt" && v.critics != null && v.audience != null,
      via: (res && res.via) || null,
      miss: (res && res.miss) || null,
      got: rtPath(v && v.url),
      expect: c.expect || null,
      right: c.expect ? rtPath(v && v.url) === c.expect : null,
    });
  }
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const rt = count((r) => r.source === "rt");
  const withExpect = rows.filter((r) => r.expect);
  const reasons = {};
  for (const r of rows) if (r.source !== "rt") reasons[r.miss || "?"] = (reasons[r.miss || "?"] || 0) + 1;
  const transient = reasons.transient || 0;
  const summary = {
    titulos: n,
    rt,
    rt_pct: Math.round((rt / n) * 100),
    criticos_e_audiencia: count((r) => r.both),
    plano_b_imdb: count((r) => r.source === "imdb"),
    plano_c_tmdb: count((r) => r.source === "tmdb"),
    sem_nota: count((r) => r.source === "none"),
    certos: withExpect.length ? `${withExpect.filter((r) => r.right).length}/${withExpect.length}` : "-",
    RT_alcancavel_pct: Math.round(((n - transient) / n) * 100),
    motivos_sem_RT: reasons,
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ summary, rows }, null, 1));
    return;
  }
  for (const r of rows) {
    console.log(`${r.right === false ? "ERRADO" : "      "} ${r.site.padEnd(7)} ${r.title.padEnd(34)} ${r.source.padEnd(5)} ${r.via || "-"} ${r.got || ""}${r.right === false ? ` (esperado ${r.expect})` : ""}`);
  }
  console.log("\n" + JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

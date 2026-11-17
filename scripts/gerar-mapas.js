#!/usr/bin/env node
// Gera data/nf-map.json e data/dp-map.json: código do título na Netflix /
// Disney+ -> página do Rotten Tomatoes, a partir do Wikidata.
// A extensão lê esses arquivos antes de consultar o Wikidata (menos rede,
// primeira nota mais rápida). Rode no seu computador, com internet:
//
//   node scripts/gerar-mapas.js
//
// Depois recarregue a extensão em chrome://extensions. Rode de novo de tempos
// em tempos pra pegar títulos novos (o Wikidata cresce).
// Formato de cada entrada: "código": ["m/filme|tv/serie", "Nome em inglês", ano|null]

"use strict";
const fs = require("fs");
const path = require("path");

const ENDPOINT = "https://query.wikidata.org/sparql";
const PAGE = 4000;
const UA = "ValeOPlay-gerar-mapas/1.0 (uso pessoal; https://github.com/bruno-l-rossi/vale-o-play)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RT_OK = /^(m|tv)\/[a-z0-9_\-]+$/;

async function sparql(query) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
    });
    if (res.ok) return (await res.json()).results.bindings;
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 4000 * attempt;
      console.warn(`  Wikidata respondeu ${res.status}, nova tentativa em ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Wikidata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error("Wikidata indisponível");
}

// Todas as obras que têm a propriedade `prop` e página do RT (P1258).
async function coletar(prop, nome) {
  const out = new Map(); // valor -> { paths: Set, label }
  for (let offset = 0; ; offset += PAGE) {
    const rows = await sparql(`SELECT ?v ?rt ?label WHERE {
  ?i wdt:${prop} ?v ; wdt:P1258 ?rt .
  OPTIONAL { ?i rdfs:label ?label FILTER(LANG(?label) = "en") }
} ORDER BY ?v ?rt LIMIT ${PAGE} OFFSET ${offset}`);
    for (const b of rows) {
      const v = b.v.value;
      const rt = String(b.rt.value).trim().toLowerCase();
      if (!RT_OK.test(rt)) continue;
      const cur = out.get(v) || { paths: new Set(), label: null };
      cur.paths.add(rt);
      cur.label = cur.label || (b.label && b.label.value) || null;
      out.set(v, cur);
    }
    console.log(`  ${nome}: ${out.size} títulos (offset ${offset})`);
    if (rows.length < PAGE) break;
    await sleep(1500);
  }
  return out;
}

const entrada = (e) => [[...e.paths].join("|"), e.label, null];

function gravar(arquivo, obj) {
  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(path.join(dir, arquivo), JSON.stringify(sorted));
  console.log(`gravado data/${arquivo}: ${Object.keys(sorted).length} entradas`);
}

(async () => {
  const nf = {};
  for (const [v, e] of await coletar("P1874", "Netflix")) if (/^\d{4,}$/.test(v)) nf[v] = entrada(e);
  gravar("nf-map.json", nf);

  const dp = {};
  for (const [v, e] of await coletar("P13902", "Disney+ (entity)")) {
    const id = v.replace(/^entity-/, "");
    if (/^[0-9a-f-]{8,}$/i.test(id)) dp[`e:${id}`] = entrada(e);
  }
  for (const [prop, pre] of [["P7595", "m"], ["P7596", "s"]]) {
    for (const [v, e] of await coletar(prop, `Disney+ (${pre})`)) if (/^[0-9a-zA-Z]{8,}$/.test(v)) dp[`${pre}:${v}`] = entrada(e);
  }
  gravar("dp-map.json", dp);
})().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});

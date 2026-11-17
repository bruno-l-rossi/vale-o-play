// Bench dentro da extensão: manda cada título de titulos.json ao service worker.
// "Cache novo" usa fresh: true (ignora o cache de nota e de mapa).
const rtPath = (url) => String(url || "").replace("https://www.rottentomatoes.com/", "").replace(/\/+$/, "");
const ask = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (res) => r(res)));

async function bench(fresh) {
  const list = await (await fetch("titulos.json")).json();
  const table = document.getElementById("rows");
  table.textContent = "";
  const rows = [];
  for (const c of list) {
    const res = await ask({ type: "getScore", title: c.title, site: c.site, nfId: c.nfId, dpId: c.dpId, fresh });
    const v = res && res.value;
    const got = rtPath(v && v.url);
    const right = c.expect ? got === c.expect : null;
    rows.push({ source: v ? v.source : "none", both: !!v && v.source === "rt" && v.critics != null && v.audience != null, miss: res && res.miss, right });
    const tr = document.createElement("tr");
    if (right === false) tr.className = "bad";
    for (const t of [c.site, c.title, v ? v.source : "none", (res && res.via) || "-", got, right === false ? `esperado ${c.expect}` : ""]) {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  const n = rows.length;
  const c = (f) => rows.filter(f).length;
  const exp = rows.filter((r) => r.right !== null);
  const reasons = {};
  for (const r of rows) if (r.source !== "rt") reasons[r.miss || "?"] = (reasons[r.miss || "?"] || 0) + 1;
  document.getElementById("summary").textContent = JSON.stringify(
    {
      titulos: n,
      rt: c((r) => r.source === "rt"),
      criticos_e_audiencia: c((r) => r.both),
      plano_b_imdb: c((r) => r.source === "imdb"),
      plano_c_tmdb: c((r) => r.source === "tmdb"),
      sem_nota: c((r) => r.source === "none"),
      certos: exp.length ? `${exp.filter((r) => r.right).length}/${exp.length}` : "-",
      motivos_sem_RT: reasons,
    },
    null,
    2
  );
}

document.getElementById("run").addEventListener("click", () => bench(true));
document.getElementById("runCached").addEventListener("click", () => bench(false));

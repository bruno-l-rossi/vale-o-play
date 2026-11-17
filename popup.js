// Popup: preferências (chrome.storage.sync), cobertura do dia a dia
// (vop:stats e vop:misses, via service worker) e títulos escondidos.
// O content script escuta storage.onChanged e aplica na hora, sem recarregar.

const DEFAULTS = {
  badgeSize: "medium",
  badgePosition: "top-left",
  showMissing: false,
  dimThreshold: "off",
  dimMetric: "auto",
  dimAction: "dim",
  dimUnrated: false,
  hidden: [],
  enableNetflix: true,
  enableDisney: true,
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
let statusTimer = null;
let currentMisses = [];

function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 1800);
}

function save(values) {
  chrome.storage.sync.set(values, () => {
    flashStatus(chrome.runtime.lastError ? "Falhou, tente de novo" : "Salvo ✓");
  });
}

$("version").textContent = "v" + chrome.runtime.getManifest().version;

// ---- Preferências ----

function showHidden(list) {
  const n = Array.isArray(list) ? list.length : 0;
  $("hiddenInfo").textContent = n ? `${n} título${n > 1 ? "s" : ""} com a nota escondida.` : "Nenhum.";
  $("restoreHidden").hidden = !n;
}

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const name of ["badgeSize", "badgePosition"]) {
    const input = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
    if (input) input.checked = true;
  }
  for (const name of ["enableNetflix", "enableDisney", "showMissing", "dimUnrated"]) {
    document.querySelector(`input[name="${name}"]`).checked = name.startsWith("enable") ? settings[name] !== false : !!settings[name];
  }
  for (const id of ["dimThreshold", "dimMetric", "dimAction"]) $(id).value = settings[id];
  showHidden(settings.hidden);
});

document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener("change", () => save({ [input.name]: input.value }));
});
document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
  input.addEventListener("change", () => save({ [input.name]: input.checked }));
});
for (const id of ["dimThreshold", "dimMetric", "dimAction"]) {
  $(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
}

$("restoreHidden").addEventListener("click", () => {
  chrome.storage.sync.set({ hidden: [] }, () => {
    showHidden([]);
    flashStatus("Notas de volta ✓");
  });
});

// ---- Legenda (usa os mesmos ícones da página) ----

(function legend() {
  const items = [
    ["fresh", "Críticos 60% ou mais (fresco)"],
    ["rotten", "Críticos abaixo de 60% (podre)"],
    ["popcorn", "Audiência 60% ou mais"],
    ["spilled", "Audiência abaixo de 60%"],
    ["trophy", "Aclamado: críticos e audiência acima de 90%"],
  ];
  const box = $("legend");
  if (!window.VOPIcons) return;
  for (const [kind, text] of items) {
    box.appendChild(window.VOPIcons.make(kind));
    const t = document.createElement("span");
    t.textContent = text;
    box.appendChild(t);
  }
})();

// ---- Cobertura ----

const MISS_LABEL = {
  no_tmdb_match: "sem par no TMDB",
  rt_absent: "RT não tem",
  rt_no_score: "RT sem nota ainda",
  transient: "RT não respondeu",
  ambiguous: "ambíguo",
  override_none: "correção sem nota",
  none: "sem nota",
  reserve: "reserva",
};

function row(label, value) {
  const d = document.createElement("div");
  d.className = "stat-row";
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("b");
  b.textContent = value;
  d.append(a, b);
  return d;
}

function renderStats(stats) {
  const box = $("coverage");
  const days = Object.values((stats && stats.days) || {});
  const total = days.reduce((s, d) => s + (d.n || 0), 0);
  if (!total) return;
  const sum = (key, k) => days.reduce((s, d) => s + ((d[key] && d[key][k]) || 0), 0);
  const both = days.reduce((s, d) => s + (d.both || 0), 0);
  const rt = sum("src", "rt");
  const imdb = sum("src", "imdb");
  const tmdb = sum("src", "tmdb");
  const none = sum("src", "none");
  const pct = (n) => `${Math.round((n / total) * 100)}%`;

  box.textContent = "";
  box.appendChild(row("Títulos vistos", String(total)));
  box.appendChild(row("Com nota do RT", `${rt} (${pct(rt)})`));
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = pct(rt);
  bar.appendChild(fill);
  box.appendChild(bar);
  box.appendChild(row("Críticos e audiência", `${both} (${pct(both)})`));
  box.appendChild(row("Reserva IMDb", `${imdb} (${pct(imdb)})`));
  box.appendChild(row("Reserva TMDB", `${tmdb} (${pct(tmdb)})`));
  box.appendChild(row("Sem nota", `${none} (${pct(none)})`));

  const reasons = {};
  for (const d of days) for (const [k, v] of Object.entries(d.miss || {})) reasons[k] = (reasons[k] || 0) + v;
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (top.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = "Por que não veio do RT: " + top.map(([k, v]) => `${MISS_LABEL[k] || k} ${v}`).join(", ") + ".";
    box.appendChild(h);
  }
  $("clearStats").hidden = false;
}

function loadStats() {
  chrome.runtime.sendMessage({ type: "getStats" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    currentMisses = res.misses || [];
    renderStats(res.stats);
    $("exportMisses").hidden = !currentMisses.length;
  });
}
loadStats();

// lista pronta pra colar numa conversa com a IA ou numa issue
$("exportMisses").addEventListener("click", async () => {
  const lines = currentMisses.map((m) => `${m.site || "?"} | ${m.title} | ${m.src} | ${m.miss || "-"}${m.id ? ` | ${m.id}` : ""}`);
  const text = `site | título | fonte | motivo | id\n${lines.join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
    flashStatus(`${lines.length} títulos copiados ✓`);
  } catch (e) {
    flashStatus("Não consegui copiar");
  }
});

$("clearStats").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearStats" }, (res) => {
    if (!chrome.runtime.lastError && res?.ok) {
      $("coverage").innerHTML = '<p class="hint">Sem dados ainda. Navegue na Netflix ou na Disney+.</p>';
      $("exportMisses").hidden = true;
      $("clearStats").hidden = true;
      flashStatus("Estatísticas zeradas ✓");
    }
  });
});

$("clearCache").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearCache" }, (res) => {
    flashStatus(!chrome.runtime.lastError && res?.ok ? "Cache limpo ✓" : "Falhou, tente de novo");
  });
});

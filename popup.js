// Popup: lê e grava as preferências em chrome.storage.sync.
// O content script escuta storage.onChanged e aplica na hora, sem recarregar.

const DEFAULTS = {
  badgeSize: "medium",
  badgePosition: "top-left",
  dimThreshold: "off",
  enableNetflix: true,
  enableDisney: true,
};

const statusEl = document.getElementById("status");
let statusTimer = null;

function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 1500);
}

function save(values) {
  chrome.storage.sync.set(values, () => {
    flashStatus(chrome.runtime.lastError ? "Falhou, tente de novo" : "Salvo ✓");
  });
}

document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const name of ["badgeSize", "badgePosition"]) {
    const input = document.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
    if (input) input.checked = true;
  }
  for (const name of ["enableNetflix", "enableDisney"]) {
    document.querySelector(`input[name="${name}"]`).checked = settings[name] !== false;
  }
  document.getElementById("dimThreshold").value = settings.dimThreshold;
});

document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener("change", () => save({ [input.name]: input.value }));
});

document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
  input.addEventListener("change", () => save({ [input.name]: input.checked }));
});

document.getElementById("dimThreshold").addEventListener("change", (e) => {
  save({ dimThreshold: e.target.value });
});

document.getElementById("clearCache").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearCache" }, (res) => {
    flashStatus(!chrome.runtime.lastError && res?.ok ? "Cache limpo ✓" : "Falhou, tente de novo");
  });
});

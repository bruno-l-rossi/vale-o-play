// Popup: lê e grava as preferências em chrome.storage.sync.
// O content script escuta storage.onChanged e aplica na hora, sem recarregar.

const DEFAULTS = {
  badgeSize: "medium",
  badgePosition: "top-left",
  dimThreshold: "off",
};

const statusEl = document.getElementById("status");
let statusTimer = null;

function flashStatus(text) {
  statusEl.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 1500);
}

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const name of ["badgeSize", "badgePosition"]) {
    const input = document.querySelector(
      `input[name="${name}"][value="${settings[name]}"]`
    );
    if (input) input.checked = true;
  }
  document.getElementById("dimThreshold").value = settings.dimThreshold;
});

document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener("change", () => {
    chrome.storage.sync.set({ [input.name]: input.value }, () =>
      flashStatus("Salvo ✓")
    );
  });
});

document.getElementById("dimThreshold").addEventListener("change", (e) => {
  chrome.storage.sync.set({ dimThreshold: e.target.value }, () =>
    flashStatus("Salvo ✓")
  );
});

document.getElementById("clearCache").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearCache" }, (res) => {
    flashStatus(res?.ok ? "Cache limpo ✓" : "Falhou, tente de novo");
  });
});

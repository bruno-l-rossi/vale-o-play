// Content script: acha os cards de título na Netflix e pendura o badge com as notas do RT.

const DONE_ATTR = "data-rt-done";
const SCAN_DEBOUNCE_MS = 600;

function getTitleFromCard(card) {
  // 1ª opção: aria-label do link (mais confiável)
  const link = card.querySelector("a[aria-label]");
  if (link) {
    const label = link.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
  }
  // 2ª opção: texto de fallback que a Netflix usa quando a arte não carrega
  const fallback = card.querySelector(".fallback-text");
  if (fallback && fallback.textContent.trim()) {
    return fallback.textContent.trim();
  }
  return null;
}

function buildBadge(score) {
  const badge = document.createElement("div");
  badge.className = "rt-badge";

  const parts = [];
  if (score.critics !== null && score.critics !== undefined) {
    const icon = score.critics >= 60 ? "🍅" : "🟢";
    parts.push(`<span class="rt-part" title="Críticos">${icon} ${score.critics}%</span>`);
  }
  if (score.audience !== null && score.audience !== undefined) {
    const icon = score.audience >= 60 ? "🍿" : "🥤";
    parts.push(`<span class="rt-part" title="Audiência">${icon} ${score.audience}%</span>`);
  }
  if (!parts.length) return null;

  badge.innerHTML = parts.join("");

  if (score.url) {
    badge.classList.add("rt-clickable");
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(score.url, "_blank", "noopener");
    });
  }
  return badge;
}

function requestScore(title) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "getScore", title }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res && res.ok ? res.value : null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

async function processCard(card) {
  if (card.hasAttribute(DONE_ATTR)) return;
  card.setAttribute(DONE_ATTR, "1");

  const title = getTitleFromCard(card);
  if (!title) {
    // sem título ainda (card carregando); libera pra tentar de novo no próximo scan
    card.removeAttribute(DONE_ATTR);
    return;
  }

  const score = await requestScore(title);
  if (!score) return;

  const badge = buildBadge(score);
  if (!badge) return;

  // o card precisa ser referência de posição pro badge absoluto
  if (getComputedStyle(card).position === "static") {
    card.style.position = "relative";
  }
  card.appendChild(badge);
}

function scan() {
  const cards = document.querySelectorAll(
    `.title-card:not([${DONE_ATTR}])`
  );
  cards.forEach(processCard);
}

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.body, { childList: true, subtree: true });

scheduleScan();

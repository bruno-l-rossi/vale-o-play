// Content script: acha os cards de título na Netflix e pendura o badge com as notas do RT.

const DONE_ATTR = "data-rt-done";
const SCAN_DEBOUNCE_MS = 600;
const LOG = "[Vale o Play?]";

// 3 estratégias de detecção, da mais específica pra mais genérica,
// porque a Netflix muda as classes do DOM de tempos em tempos.
function findCards() {
  let cards = document.querySelectorAll(".title-card, .title-card-container");
  if (cards.length) return [...cards];

  cards = document.querySelectorAll(".boxart-container, .boxart-round");
  if (cards.length) return [...cards].map((c) => c.closest("a") || c);

  // genérica: âncoras de título/watch viram o próprio card
  const links = document.querySelectorAll(
    'a[href*="/watch/"], a[href*="/title/"]'
  );
  return [...links];
}

function getTitleFromCard(card) {
  const sources = [
    card.getAttribute && card.getAttribute("aria-label"),
    card.querySelector?.("a[aria-label]")?.getAttribute("aria-label"),
    card.querySelector?.(".fallback-text")?.textContent,
    card.querySelector?.("img[alt]")?.getAttribute("alt"),
  ];
  for (const s of sources) {
    if (s && s.trim().length > 1) return s.trim();
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
        if (chrome.runtime.lastError) {
          console.warn(LOG, "erro de mensagem:", chrome.runtime.lastError.message);
          return resolve(null);
        }
        resolve(res && res.ok ? res.value : null);
      });
    } catch (e) {
      console.warn(LOG, "exceção ao pedir nota:", e.message);
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

  if (getComputedStyle(card).position === "static") {
    card.style.position = "relative";
  }
  card.appendChild(badge);
}

let lastCount = -1;
function scan() {
  const all = findCards();
  const fresh = all.filter((c) => !c.hasAttribute(DONE_ATTR));
  if (all.length !== lastCount) {
    lastCount = all.length;
    console.info(LOG, `${all.length} cards detectados, ${fresh.length} novos`);
    if (all.length === 0) {
      console.warn(
        LOG,
        "nenhum card encontrado. A estrutura da página da Netflix pode ter mudado; reporte este aviso."
      );
    }
  }
  fresh.forEach(processCard);
}

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
}

console.info(LOG, "extensão carregada nesta página");
const observer = new MutationObserver(scheduleScan);
observer.observe(document.body, { childList: true, subtree: true });

scheduleScan();

// Content script: acha os cards de título na Netflix (home, busca, gêneros
// e modal de preview) e pendura o badge com as notas. Também esmaece capas
// abaixo do corte de qualidade e mostra as notas perto da sinopse no detalhe.

const DONE_ATTR = "data-rt-done";
const SCAN_DEBOUNCE_MS = 600;
const RESCAN_INTERVAL_MS = 4000; // rede de segurança pra rotas SPA e lazy load
const LOG = "[Vale o Play?]";

// ---- Configurações (popup): tamanho, posição e filtro de qualidade ----

const DEFAULT_SETTINGS = {
  badgeSize: "medium",
  badgePosition: "top-left",
  dimThreshold: "off",
};
let settings = { ...DEFAULT_SETTINGS };

function badgeClasses() {
  return ["rt-badge", `rt-size-${settings.badgeSize}`, `rt-pos-${settings.badgePosition}`];
}

function applySettingsToBadge(badge) {
  const cls = badgeClasses();
  if (badge.dataset.rtClickable === "1") cls.push("rt-clickable");
  if (badge.dataset.rtTop === "1") cls.push("rt-top");
  badge.className = cls.join(" ");
}

function refreshAllBadges() {
  document.querySelectorAll(".rt-badge").forEach(applySettingsToBadge);
}

// ---- Filtro de qualidade: esmaece capas abaixo do corte ----

// Nota única pra comparar com o corte: críticos do RT (ou audiência,
// se críticos faltar); IMDb/TMDB viram % (7,4 -> 74).
function effectiveScore(score) {
  if (score.source === "imdb" || score.source === "tmdb") {
    return Math.round(score.rating * 10);
  }
  if (typeof score.critics === "number") return score.critics;
  if (typeof score.audience === "number") return score.audience;
  return null;
}

function applyDim(el) {
  const t = settings.dimThreshold;
  const on = t !== "off" && Number(el.dataset.rtScore) < Number(t);
  el.classList.toggle("rt-dim", on);
}

function applyDimAll() {
  document.querySelectorAll("[data-rt-score]").forEach(applyDim);
}

chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
  settings = { ...DEFAULT_SETTINGS, ...stored };
  refreshAllBadges();
  applyDimAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.badgeSize) settings.badgeSize = changes.badgeSize.newValue;
  if (changes.badgePosition) settings.badgePosition = changes.badgePosition.newValue;
  if (changes.dimThreshold) settings.dimThreshold = changes.dimThreshold.newValue;
  refreshAllBadges();
  applyDimAll();
});

// ---- Detecção de cards ----

// Resolve um nó qualquer pro "card" onde o badge vai morar, subindo pro
// container de capa ou pra âncora mais próxima. Serve pra deduplicar: o card
// e a âncora /watch/ dentro dele caem no mesmo root, evitando badge dobrado.
const CARD_SELECTOR =
  '.title-card, .title-card-container, .boxart-container, .boxart-round, [data-uia*="title-card"]';

function cardRoot(node) {
  return node.closest?.(CARD_SELECTOR) || node.closest?.("a") || node;
}

// Junta todas as estratégias e deduplica por root, pra cobrir a home, as
// páginas de gênero/subgênero e a busca (inclusive os resultados que
// aparecem enquanto você digita). Cards dentro do modal de preview ficam
// de fora: o modal tem tratamento próprio.
function findCards() {
  const roots = new Set();
  const add = (n) => {
    const r = cardRoot(n);
    if (r && !r.closest('[class*="previewModal"]')) roots.add(r);
  };

  document.querySelectorAll(CARD_SELECTOR).forEach(add);

  // âncoras de título/assistir: é assim que a busca monta os resultados
  document
    .querySelectorAll('a[href*="/watch/"], a[href*="/title/"]')
    .forEach(add);

  return [...roots];
}

// Rótulos de UI que aparecem como aria-label mas não são nome de título.
const UI_LABELS = /^(reproduzir|assistir|play|mais informações|more info|adicionar à minha lista|remover da minha lista)$/i;

function cleanTitle(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length < 2 || UI_LABELS.test(t)) return null;
  return t;
}

function getTitleFromCard(card) {
  const sources = [
    card.getAttribute && card.getAttribute("aria-label"),
    card.querySelector?.("a[aria-label]")?.getAttribute("aria-label"),
    card.querySelector?.(".fallback-text")?.textContent,
    card.querySelector?.('[data-uia="video-title"]')?.textContent,
    card.querySelector?.("img[alt]")?.getAttribute("alt"),
  ];
  for (const s of sources) {
    const t = cleanTitle(s);
    if (t) return t;
  }
  return null;
}

// ---- Badge ----

function fmtRating(r) {
  return (Math.round(r * 10) / 10).toFixed(1).replace(".", ",");
}

// Destaque de aclamado: RT com críticos E audiência acima de 90%,
// ou IMDb acima de 9,0. O badge ganha 🏆 e borda dourada.
function isTopRated(score) {
  if (score.source === "imdb") return score.rating > 9;
  if (score.source === "tmdb") return false;
  return (
    typeof score.critics === "number" &&
    typeof score.audience === "number" &&
    score.critics > 90 &&
    score.audience > 90
  );
}

// Partes de HTML das notas, compartilhadas pelo badge e pela linha
// inline da sinopse.
function scoreParts(score) {
  const parts = [];
  if (score.source === "imdb") {
    parts.push(
      `<span class="rt-part rt-alt" title="Nota IMDb (0 a 10)">⭐ ${fmtRating(score.rating)}<small>IMDb</small></span>`
    );
  } else if (score.source === "tmdb") {
    parts.push(
      `<span class="rt-part rt-alt" title="Nota de usuários do TMDB (0 a 10)">★ ${fmtRating(score.rating)}<small>TMDB</small></span>`
    );
  } else {
    // Rotten Tomatoes (source "rt" ou cache antigo sem source)
    if (score.critics !== null && score.critics !== undefined) {
      const icon = score.critics >= 60 ? "🍅" : "🟢";
      parts.push(`<span class="rt-part" title="Críticos">${icon} ${score.critics}%</span>`);
    }
    if (score.audience !== null && score.audience !== undefined) {
      const icon = score.audience >= 60 ? "🍿" : "🥤";
      parts.push(`<span class="rt-part" title="Audiência">${icon} ${score.audience}%</span>`);
    }
  }
  return parts;
}

function makeClickable(el, url) {
  if (!url) return;
  el.dataset.rtClickable = "1";
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, "_blank", "noopener");
  });
}

function buildBadge(score) {
  const parts = scoreParts(score);
  if (!parts.length) return null;

  const badge = document.createElement("div");
  if (isTopRated(score)) {
    badge.dataset.rtTop = "1";
    parts.unshift(
      `<span class="rt-part rt-trophy" title="Aclamado: nota altíssima de críticos e audiência">🏆</span>`
    );
  }
  badge.innerHTML = parts.join("");
  makeClickable(badge, score.url);
  applySettingsToBadge(badge);
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

async function attachBadge(container, title, opts) {
  const score = await requestScore(title);
  if (!score) return;

  // container pode ter sido removido do DOM enquanto a nota chegava
  if (!container.isConnected) return;

  // filtro de qualidade: marca a nota no card e esmaece se estiver
  // abaixo do corte (só nos cards; modal de preview fica intacto)
  if (opts?.dim) {
    const eff = effectiveScore(score);
    if (eff !== null) {
      container.dataset.rtScore = eff;
      applyDim(container);
    }
  }

  if (container.querySelector(":scope > .rt-badge")) return;
  const badge = buildBadge(score);
  if (!badge) return;

  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(badge);
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
  await attachBadge(card, title, { dim: true });
}

// ---- Modal de preview (hover no card e visão de detalhe) ----

function getTitleFromModal(modal) {
  const sources = [
    modal.querySelector?.('[class*="titleTreatment"] img[alt]')?.getAttribute("alt"),
    modal.querySelector?.('img[class*="boxart"][alt]')?.getAttribute("alt"),
    modal.querySelector?.('[data-uia="video-title"]')?.textContent,
    modal.querySelector?.("img[alt]")?.getAttribute("alt"),
  ];
  for (const s of sources) {
    const t = cleanTitle(s);
    if (t) return t;
  }
  return null;
}

// Linha de notas perto da sinopse, na visão de detalhe do título.
async function attachInline(modal, title) {
  if (modal.getAttribute("data-rt-inline")) return;
  const synopsis = modal.querySelector(
    '.preview-modal-synopsis, [data-uia="preview-modal-synopsis"], [class*="synopsis"]'
  );
  if (!synopsis) return; // detalhe ainda não abriu; tenta no próximo scan
  modal.setAttribute("data-rt-inline", "1");

  const score = await requestScore(title);
  if (!score) return;

  const parts = scoreParts(score);
  if (!parts.length) return;

  const row = document.createElement("div");
  row.className = "rt-inline" + (isTopRated(score) ? " rt-top-inline" : "");
  if (isTopRated(score)) {
    parts.unshift(
      `<span class="rt-part rt-trophy" title="Aclamado: nota altíssima de críticos e audiência">🏆</span>`
    );
  }
  row.innerHTML = parts.join("");
  makeClickable(row, score.url);
  if (score.url) row.classList.add("rt-clickable");

  if (!synopsis.isConnected || synopsis.parentElement.querySelector(".rt-inline")) return;
  synopsis.parentElement.insertBefore(row, synopsis);
}

function processPreviewModals() {
  const modals = document.querySelectorAll(
    '.previewModal--container, [class*="previewModal--container"]'
  );
  modals.forEach((modal) => {
    const title = getTitleFromModal(modal);
    if (!title) return; // modal ainda montando; tenta no próximo scan

    if (!modal.hasAttribute(DONE_ATTR)) {
      modal.setAttribute(DONE_ATTR, "1");
      // pendura no player/imagem do topo do modal; senão, no próprio modal
      const container =
        modal.querySelector('[class*="player_container"], [class*="imageWrapper"]') ||
        modal;
      attachBadge(container, title);
    }

    // a sinopse carrega depois do modal; esta chamada é idempotente
    attachInline(modal, title);
  });
}

// ---- Loop de varredura ----

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
  processPreviewModals();
}

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
}

console.info(LOG, "extensão carregada nesta página");
const observer = new MutationObserver(scheduleScan);
observer.observe(document.body, { childList: true, subtree: true });

// varredura periódica: pega navegação SPA (busca, gêneros) e lazy load
// que às vezes escapam do debounce do MutationObserver
setInterval(scan, RESCAN_INTERVAL_MS);

scheduleScan();

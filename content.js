// Vale o Play? — content script (Netflix e Disney+)
//
// Acha os cards de título na página, pede a nota ao service worker e pendura
// o badge na capa. Também mostra as notas em tamanho grande no detalhe do
// título e esmaece capas abaixo do corte de qualidade escolhido no popup.
//
// Como a Netflix e a Disney+ trocam nomes de classe com frequência, a
// detecção se apoia no que elas não conseguem mudar sem quebrar o próprio
// site: os links de navegação (/browse?jbv=ID, /watch/ID, /browse/entity-ID),
// os atributos de teste (data-uia, data-testid) e os rótulos de acessibilidade
// (aria-label). Se um dia os badges sumirem, o lugar pra ajustar é o objeto
// do site (NETFLIX ou DISNEY) logo abaixo; ligue o diagnóstico com
// localStorage.setItem("valeoplay:debug", "1") no console da página.

(() => {
  "use strict";
  if (window.__valeOPlay) return; // proteção contra injeção dupla
  window.__valeOPlay = true;

  const LOG = "[Vale o Play?]";
  let DEBUG = false;
  try {
    DEBUG = localStorage.getItem("valeoplay:debug") === "1";
  } catch (e) {
    /* storage bloqueado */
  }
  const debug = (...a) => DEBUG && console.debug(LOG, ...a);

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function norm(s) {
    return clean(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Rótulos de botão/UI que aparecem em aria-label mas não são nome de título.
  const UI_LABELS = new Set(
    [
      "reproduzir", "assistir", "play", "continuar", "continuar assistindo", "resume",
      "mais informacoes", "more info", "informacoes", "detalhes", "details", "info",
      "minha lista", "my list", "adicionar a minha lista", "remover da minha lista",
      "add to my list", "remove from my list", "curtir", "like", "trailer", "episodios",
      "episodes", "compartilhar", "share", "fechar", "close", "ver tudo", "explorar tudo",
      "explore all", "thumbnail", "titulo", "title", "title card",
    ].map(norm)
  );

  // Interpreta um rótulo de card: tira prefixos de UI e separa o ano quando
  // vem no formato antigo "Nome (2010) - 16+ - Filmes".
  function parseLabel(raw) {
    let t = clean(raw)
      .replace(/^thumbnail\s*[-–:]\s*/i, "") // Disney+: "thumbnail - Nome"
      .replace(/^(go to|ir para)\s+/i, ""); // Netflix pública: "Go to Nome"
    if (!t) return null;
    let year = null;
    const m = /^(.+?)\s*\((\d{4})\)(?:\s*[-–—|].*)?$/.exec(t);
    if (m) {
      t = m[1].trim();
      year = Number(m[2]);
    }
    if (t.length < 2 || UI_LABELS.has(norm(t))) return null;
    return { title: t, year };
  }

  // Ano e tipo (filme/série) a partir de um texto de metadados.
  function parseMeta(text) {
    const t = clean(text);
    if (!t) return { year: null, type: null };
    const y = /\b(19[2-9]\d|20[0-4]\d)\b/.exec(t);
    let type = null;
    if (/\b(temporadas?|seasons?|epis[oó]dios?|episodes?|miniss[eé]rie|limited series|s[eé]rie)\b/i.test(t)) type = "tv";
    else if (/\b\d+\s*h(\s*\d+\s*min)?\b|\b\d+\s*min\b/i.test(t)) type = "movie";
    return { year: y ? Number(y[1]) : null, type };
  }

  function firstLabel(sources) {
    for (const s of sources) {
      const p = parseLabel(s);
      if (p) return p;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Adaptadores de site
  // -------------------------------------------------------------------------

  // Onde o badge mora: o próprio card, ou (se o card for um <a> "inline", que
  // não serve de referência pra posicionar) o filho dele que contém a capa.
  function boxOf(host) {
    if (getComputedStyle(host).display !== "inline") return host;
    let el = host.querySelector("img, picture, [style*='background-image']");
    while (el && el.parentElement !== host) el = el.parentElement;
    return el && el.nodeType === 1 ? el : host;
  }

  // ID do vídeo da Netflix em qualquer formato de link.
  function nfId(href) {
    const m = /(?:\/(?:watch|title)\/|[?&]jbv=)(\d{4,})/.exec(href || "");
    return m ? m[1] : null;
  }

  const NETFLIX = {
    id: "netflix",
    settingKey: "enableNetflix",
    // páginas onde não há catálogo (player): não varre, poupa CPU
    idle: () => /^\/watch\//.test(location.pathname),
    // Formato atual (2026): <a href="/browse?jbv=ID" data-uia="standard-card"
    // aria-label="Nome"><img alt=""></a>. Os demais são formatos antigos e
    // de outras áreas (busca, Minha lista, Top 10, Continuar assistindo).
    cardSelector: [
      'a[data-uia$="-card"]',
      'a[href*="jbv="]',
      'a[href*="/watch/"]',
      'a[href*="/title/"]',
      ".title-card",
    ].join(","),
    exclude: [
      "header", "nav", "footer", '[role="dialog"]',
      '[class*="previewModal"]', '[data-uia^="previewModal"]', '[data-uia*="mini-modal"]',
      '[class*="mini-modal"]', ".jawBoneContainer", '[data-uia*="notification"]',
      '[class*="buttonControls"]', '[class*="billboard"]', '[data-uia*="billboard"]',
      '[data-uia*="episode"]', '[class*="episodeSelector"]', '[data-uia*="game"]',
    ].join(","),
    host(el) {
      return el.closest(".title-card") || (el.tagName === "A" ? el : el.closest("a")) || el;
    },
    badgeParent(host) {
      return host.querySelector(".boxart-container") || boxOf(host);
    },
    info(host) {
      const a = host.tagName === "A" ? host : host.querySelector("a[href]");
      const id = nfId(a && a.getAttribute("href")) || host.getAttribute("data-videoid") || null;
      const label = firstLabel([
        a && a.getAttribute("aria-label"),
        host.getAttribute("aria-label"),
        host.querySelector(".fallback-text")?.textContent,
        host.querySelector('[data-uia="video-title"]')?.textContent,
        host.querySelector("img[alt]")?.getAttribute("alt"),
      ]);
      const title = label?.title || (id && idTitles.get(id)) || null;
      if (!title) return null;
      return { key: `nf:${id || norm(title)}:${norm(title)}`, id, title, year: label?.year || null, type: null };
    },
    // Modal de preview (hover) e de detalhe (clique / ?jbv=ID).
    details() {
      const out = [];
      const sel =
        '[data-uia="previewModal--container"], .previewModal--container, [class*="previewModal--container"], .jawBoneContainer, [data-uia="detail-modal"]';
      for (const modal of document.querySelectorAll(sel)) {
        if (modal.parentElement && modal.parentElement.closest(sel)) continue; // aninhado
        const isDetail =
          /detail/i.test(modal.className) || modal.matches(".jawBoneContainer") || /[?&]jbv=/.test(location.search);
        let id = isDetail ? nfId(location.search) : null;
        if (!id) {
          for (const a of modal.querySelectorAll("a[href]")) {
            id = nfId(a.getAttribute("href"));
            if (id) break;
          }
        }
        const logo = modal.querySelector(
          '[data-uia="previewModal--player-titleTreatment-logo"], .previewModal--player-titleTreatment-logo, img[class*="titleTreatment"], [class*="titleTreatment"] img[alt], [data-uia*="title-treatment"] img[alt]'
        );
        const label = firstLabel([
          logo && (logo.getAttribute("alt") || logo.getAttribute("title") || logo.textContent),
          modal.querySelector('[data-uia="video-title"]')?.textContent,
          modal.querySelector('img[class*="boxart"][alt]')?.getAttribute("alt"),
          modal.querySelector("h1")?.textContent,
          modal.getAttribute("aria-label"),
        ]);
        const title = label?.title || (id && idTitles.get(id)) || null;
        if (!title) continue;

        const metaEl = modal.querySelector('[data-uia="videoMetadata--container"], .videoMetadata--container, [class*="videoMetadata--container"]');
        const meta = parseMeta(metaEl?.textContent);

        const synopsis = modal.querySelector('[data-uia="preview-modal-synopsis"], .preview-modal-synopsis, [class*="synopsis"]');
        const detailsMeta = modal.querySelector('[data-uia="previewModal--detailsMetadata"], [class*="detailsMetadata"]');
        let anchor = null;
        if (synopsis) anchor = { el: synopsis, where: "before" };
        else if (metaEl) anchor = { el: metaEl, where: "after" };
        else if (detailsMeta) anchor = { el: detailsMeta, where: "prepend" };

        out.push({
          root: modal,
          key: `nfd:${id || ""}:${norm(title)}`,
          title,
          year: label?.year || meta.year,
          type: meta.type,
          anchor,
          compact: !isDetail,
          badgeHost: anchor
            ? null
            : modal.querySelector('[class*="player_container"], [class*="imageWrapper"], [data-uia*="player"]'),
        });
      }
      return out;
    },
  };

  // Disney+: marcas e coleções que viram card mas não são título.
  const DISNEY_BRANDS = new Set(
    ["disney", "disney+", "pixar", "marvel", "star wars", "national geographic", "star", "hulu", "espn", "disney junior", "20th century studios"].map(norm)
  );

  function dpId(href) {
    const m =
      /\/browse\/entity-([0-9a-f-]{8,})/i.exec(href || "") ||
      /\/(?:movies|series)\/[^/]+\/([0-9a-zA-Z]{8,})/.exec(href || "");
    return m ? m[1] : null;
  }

  // "Assistir a Os Simpsons | Disney+" -> "Os Simpsons"
  function disneyDocTitle() {
    const t = clean(document.title)
      .replace(/\s*[|·–—-]\s*Disney\+.*$/i, "")
      .replace(/^(assistir|assista|watch|ver|mira)\s+((a|ao|à|aos|às)\s+)?/i, "");
    return t && !/^disney\+?$/i.test(t) ? t : null;
  }

  const DISNEY = {
    id: "disney",
    settingKey: "enableDisney",
    idle: () => /\/(play|video)\//.test(location.pathname),
    cardSelector: 'a[href*="/browse/entity-"], a[data-item-id], a[href*="/movies/"], a[href*="/series/"]',
    exclude: [
      "header", "nav", "footer", '[data-testid*="brand"]', '[data-testid*="cta"]', '[role="dialog"]',
    ].join(","),
    host(el) {
      return el.tagName === "A" ? el : el.closest("a");
    },
    badgeParent(host) {
      return boxOf(host);
    },
    info(host) {
      const id = dpId(host.getAttribute("href")) || host.getAttribute("data-item-id") || null;
      const fromAlt = parseLabel(host.querySelector("img[alt]")?.getAttribute("alt"));
      const fromAria = parseLabel(host.getAttribute("aria-label"));
      // aria-label às vezes traz texto extra depois do nome: fica o mais curto
      let label = fromAria || fromAlt;
      if (fromAlt && fromAria && norm(fromAria.title).startsWith(norm(fromAlt.title))) label = fromAlt;
      if (!label || DISNEY_BRANDS.has(norm(label.title))) return null;
      return { key: `dp:${id || ""}:${norm(label.title)}`, id, title: label.title, year: label.year, type: null };
    },
    // Página de detalhe: /browse/entity-<id>
    details() {
      const id = dpId(location.pathname);
      if (!id) return [];
      const hero = document.querySelector('[data-testid="hero"]');
      const h1 = document.querySelector('h1[data-testid="content-title"]') || document.querySelector("main h1");
      const logo =
        (hero && hero.querySelector('img[alt]:not([alt=""])')) ||
        document.querySelector('[data-testid*="title-treatment"] img[alt], img[data-testid*="title"][alt]');
      const label = firstLabel([h1?.textContent, logo?.getAttribute("alt"), disneyDocTitle()]);
      if (!label || DISNEY_BRANDS.has(norm(label.title))) return [];

      const metaEl = document.querySelector('[data-testid="masthead-metadata"], [data-testid*="metadata"]');
      const meta = parseMeta(metaEl?.textContent || hero?.textContent?.slice(0, 400));

      let anchor = null;
      if (metaEl) anchor = { el: metaEl, where: "after" };
      else if (logo) anchor = { el: logo.parentElement || logo, where: "after" };
      else if (h1) anchor = { el: h1, where: "after" };
      else if (hero) anchor = { el: hero, where: "prepend" };
      if (!anchor) return [];

      return [
        {
          root: document.querySelector("main") || document.body,
          key: `dpd:${id}:${norm(label.title)}`,
          title: label.title,
          year: label.year || meta.year,
          type: meta.type,
          anchor,
          compact: false,
          badgeHost: null,
        },
      ];
    },
  };

  const SITE = /(^|\.)netflix\.com$/.test(location.hostname)
    ? NETFLIX
    : /(^|\.)disneyplus\.com$/.test(location.hostname)
      ? DISNEY
      : null;
  if (!SITE) return;

  // -------------------------------------------------------------------------
  // Configurações (popup)
  // -------------------------------------------------------------------------

  const DEFAULT_SETTINGS = {
    badgeSize: "medium",
    badgePosition: "top-left",
    dimThreshold: "off",
    enableNetflix: true,
    enableDisney: true,
  };
  let settings = { ...DEFAULT_SETTINGS };
  let enabled = false;

  // -------------------------------------------------------------------------
  // Notas: pedido ao service worker com memo por página
  // -------------------------------------------------------------------------

  const idTitles = new Map(); // ID do vídeo -> nome (ajuda o modal a se achar)
  const memo = new Map(); // título|tipo|ano -> Promise<nota|null|undefined>
  let dead = false; // extensão recarregada: este script ficou órfão

  function requestScore(q, priority) {
    const k = `${norm(q.title)}|${q.type || ""}|${q.year || ""}`;
    if (memo.has(k)) return memo.get(k);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "getScore", title: q.title, year: q.year || null, mediaType: q.type || null, priority, site: SITE.id },
          (res) => {
            const err = chrome.runtime.lastError;
            if (err || !res) {
              debug("falha ao pedir nota:", err?.message);
              return resolve(undefined); // undefined = tenta de novo depois
            }
            resolve(res.ok ? res.value : undefined);
          }
        );
      } catch (e) {
        if (/context invalidated/i.test(e.message)) shutdown();
        resolve(undefined);
      }
    });
    memo.set(k, p);
    p.then((v) => {
      if (v === undefined) memo.delete(k);
    });
    return p;
  }

  // -------------------------------------------------------------------------
  // Badge e linha de notas
  // -------------------------------------------------------------------------

  const fmtRating = (r) => (Math.round(r * 10) / 10).toFixed(1).replace(".", ",");

  // Nota única pra comparar com o corte: críticos do RT (ou audiência na
  // falta); IMDb/TMDB viram % (7,4 -> 74).
  function effectiveScore(s) {
    if (s.source === "imdb" || s.source === "tmdb") return Math.round(s.rating * 10);
    if (typeof s.critics === "number") return s.critics;
    if (typeof s.audience === "number") return s.audience;
    return null;
  }

  // Aclamado: RT com críticos E audiência acima de 90%, ou IMDb acima de 9,0.
  function isTopRated(s) {
    if (s.source === "imdb") return s.rating > 9;
    if (s.source !== "rt") return false;
    // média de temporadas só vale troféu se vier de 2 ou mais temporadas
    if (s.criticsSeasons && s.criticsSeasons.rated < 2) return false;
    return s.critics > 90 && s.audience > 90;
  }

  function scoreParts(s) {
    const parts = [];
    if (s.source === "imdb" || s.source === "tmdb") {
      const imdb = s.source === "imdb";
      parts.push({
        icon: imdb ? "⭐" : "★",
        text: fmtRating(s.rating),
        label: imdb ? "IMDb" : "TMDB",
        tip: imdb ? "Nota IMDb (0 a 10)" : "Nota de usuários do TMDB (0 a 10)",
      });
    } else {
      if (typeof s.critics === "number") {
        const cs = s.criticsSeasons;
        parts.push({
          icon: s.critics >= 60 ? "🍅" : "🟢",
          text: `${s.critics}%`,
          // série sem nota da série inteira no RT: média das temporadas
          mark: cs ? "*" : "",
          tip: cs
            ? cs.rated === 1
              ? `Críticos: só 1 das ${cs.total} temporadas tem nota no RT`
              : `Críticos: média das ${cs.rated} temporadas com nota no RT (de ${cs.total})`
            : s.certified
              ? "Críticos (Certified Fresh)"
              : "Críticos (Tomatometer)",
        });
      }
      if (typeof s.audience === "number") {
        parts.push({ icon: s.audience >= 60 ? "🍿" : "🥤", text: `${s.audience}%`, tip: "Audiência (Popcornmeter)" });
      }
    }
    if (parts.length && isTopRated(s)) {
      parts.unshift({ icon: "🏆", text: "", tip: "Aclamado: nota altíssima de críticos e audiência", trophy: true });
    }
    return parts;
  }

  function sourceName(s) {
    return s.source === "imdb" ? "IMDb" : s.source === "tmdb" ? "TMDB" : "Rotten Tomatoes";
  }

  function fillParts(el, s) {
    for (const p of scoreParts(s)) {
      const span = document.createElement("span");
      span.className = "vop-part" + (p.trophy ? " vop-trophy" : "") + (p.label ? " vop-alt" : "");
      span.title = p.tip;
      span.textContent = p.text ? `${p.icon} ${p.text}` : p.icon;
      if (p.label) {
        const small = document.createElement("small");
        small.textContent = p.label;
        span.appendChild(small);
      }
      if (p.mark) {
        const mark = document.createElement("small");
        mark.className = "vop-mark";
        mark.textContent = p.mark;
        span.appendChild(mark);
      }
      el.appendChild(span);
    }
    el.title = `${sourceName(s)}${s.match ? ` · ${s.match}` : ""}${s.url ? " · clique pra abrir" : ""}`;
    if (s.url) {
      el.classList.add("vop-clickable");
      const stop = (e) => e.stopPropagation();
      // não deixa o clique cair no card (que abriria o título no streaming)
      for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.addEventListener(ev, stop);
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(s.url, "_blank", "noopener");
      });
    }
    return el.childNodes.length > 0;
  }

  function badgeClass(extra) {
    return `vop-badge vop-size-${settings.badgeSize} vop-pos-${settings.badgePosition}${extra || ""}`;
  }

  function buildBadge(s) {
    const badge = document.createElement("div");
    badge.dataset.vopTop = isTopRated(s) ? "1" : "";
    if (!fillParts(badge, s)) return null;
    badge.className = badgeClass(badge.classList.contains("vop-clickable") ? " vop-clickable" : "");
    if (badge.dataset.vopTop) badge.classList.add("vop-top");
    return badge;
  }

  function refreshBadgeClasses() {
    document.querySelectorAll(".vop-badge").forEach((b) => {
      const clickable = b.classList.contains("vop-clickable");
      b.className = badgeClass(clickable ? " vop-clickable" : "");
      if (b.dataset.vopTop) b.classList.add("vop-top");
    });
  }

  function applyDim(host) {
    const t = settings.dimThreshold;
    const score = Number(host.dataset.vopScore);
    host.classList.toggle("vop-dim", t !== "off" && Number.isFinite(score) && score < Number(t));
  }

  function applyDimAll() {
    document.querySelectorAll("[data-vop-score]").forEach(applyDim);
  }

  // -------------------------------------------------------------------------
  // Cards: varredura + carga preguiçosa (só o que está perto da tela)
  // -------------------------------------------------------------------------

  const pending = new WeakMap(); // host -> info aguardando ficar visível
  const retries = new Map(); // chave -> tentativas após falha de mensagem
  const io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(onIntersect, { rootMargin: "400px 800px" })
      : null;

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      loadCard(e.target);
    }
  }

  function clearHost(host) {
    host.querySelectorAll(".vop-badge").forEach((b) => b.remove());
    host.classList.remove("vop-dim");
    delete host.dataset.vopScore;
  }

  async function loadCard(host) {
    const info = pending.get(host);
    if (!info) return;
    pending.delete(host);
    const s = await requestScore(info, "normal");
    if (host.dataset.vopKey !== info.key || !host.isConnected) return; // card mudou
    if (s === undefined) return retryLater(host, info);
    if (!s) return;

    const eff = effectiveScore(s);
    if (eff !== null) {
      host.dataset.vopScore = String(eff);
      applyDim(host);
    }
    const parent = SITE.badgeParent(host);
    host.querySelectorAll(".vop-badge").forEach((b) => b.remove());
    const badge = buildBadge(s);
    if (!badge) return;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    parent.appendChild(badge);
  }

  function retryLater(host, info) {
    const n = (retries.get(info.key) || 0) + 1;
    retries.set(info.key, n);
    if (n > 3) return;
    setTimeout(() => {
      if (host.dataset.vopKey === info.key) delete host.dataset.vopKey;
      scheduleScan();
    }, 3000 * n);
  }

  function hasImage(host) {
    return !!host.querySelector("img, picture, [style*='background-image']");
  }

  let lastCount = -1;
  function scanCards() {
    const seen = new Set();
    let count = 0;
    for (const el of document.querySelectorAll(SITE.cardSelector)) {
      if (el.closest(SITE.exclude)) continue;
      const host = SITE.host(el);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      if (!hasImage(host)) continue; // ainda carregando (ou não é card)
      const info = SITE.info(host);
      if (!info) continue;
      count++;
      if (info.id) idTitles.set(info.id, info.title);
      if (host.dataset.vopKey === info.key) continue; // já tratado
      if (host.dataset.vopKey) clearHost(host); // card reciclado com outro título
      host.dataset.vopKey = info.key;
      pending.set(host, info);
      if (io) io.observe(host);
      else loadCard(host);
    }
    if (count !== lastCount) {
      lastCount = count;
      debug(`${count} cards detectados em ${location.pathname}`);
      if (count === 0 && SITE === NETFLIX && /^\/(browse|search|latest|my-list)/.test(location.pathname)) {
        debug("nenhum card encontrado: a estrutura da página pode ter mudado.");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Detalhe do título: linha de notas grande perto da sinopse
  // -------------------------------------------------------------------------

  async function processDetail(d) {
    const { root } = d;
    if (root.dataset.vopDetail === d.key) return;
    root.dataset.vopDetail = d.key;
    root.querySelectorAll(".vop-inline, .vop-badge.vop-modal").forEach((x) => x.remove());

    const s = await requestScore(d, "high");
    if (root.dataset.vopDetail !== d.key || !root.isConnected) return;
    if (s === undefined) {
      delete root.dataset.vopDetail; // tenta de novo na próxima varredura
      return;
    }
    if (!s) return;

    if (d.anchor && d.anchor.el.isConnected) {
      const row = document.createElement("div");
      row.className = "vop-inline" + (d.compact ? " vop-compact" : "") + (isTopRated(s) ? " vop-top-inline" : "");
      if (!fillParts(row, s)) return;
      root.querySelectorAll(".vop-inline").forEach((x) => x.remove());
      const { el, where } = d.anchor;
      if (where === "before") el.parentElement.insertBefore(row, el);
      else if (where === "after") el.insertAdjacentElement("afterend", row);
      else el.insertAdjacentElement("afterbegin", row);
    } else if (d.badgeHost && d.badgeHost.isConnected) {
      const badge = buildBadge(s);
      if (!badge) return;
      badge.classList.add("vop-modal");
      if (getComputedStyle(d.badgeHost).position === "static") d.badgeHost.style.position = "relative";
      d.badgeHost.appendChild(badge);
    }
  }

  function scanDetails() {
    for (const d of SITE.details()) processDetail(d);
  }

  // -------------------------------------------------------------------------
  // Laço: MutationObserver com debounce + rede de segurança leve
  // -------------------------------------------------------------------------

  let scanTimer = null;
  let firstPendingAt = 0;

  function scan() {
    scanTimer = null;
    firstPendingAt = 0;
    if (!enabled || dead || SITE.idle()) return;
    try {
      scanCards();
      scanDetails();
    } catch (e) {
      console.warn(LOG, "erro na varredura:", e);
    }
  }

  // debounce de 250ms, mas nunca segura mais de 1s em página que não para
  function scheduleScan() {
    if (!enabled || dead) return;
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, now - firstPendingAt > 1000 ? 0 : 250);
  }

  const isOurs = (n) => n.nodeType === 1 && (n.classList.contains("vop-badge") || n.classList.contains("vop-inline"));

  const observer = new MutationObserver((mutations) => {
    if (SITE.idle()) return;
    for (const m of mutations) {
      if (m.type === "attributes") return scheduleScan();
      for (const n of m.addedNodes) if (!isOurs(n)) return scheduleScan();
      for (const n of m.removedNodes) if (!isOurs(n)) return scheduleScan();
    }
  });

  let safetyTimer = null;

  function start() {
    if (enabled || dead) return;
    enabled = true;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "aria-label"],
    });
    // rede de segurança: navegação SPA que não mexe no DOM observado
    safetyTimer = setInterval(() => {
      if (document.visibilityState === "visible") scheduleScan();
    }, 5000);
    scheduleScan();
    debug(`ativo em ${SITE.id}`);
  }

  function stop() {
    enabled = false;
    observer.disconnect();
    if (io) io.disconnect();
    clearInterval(safetyTimer);
    clearTimeout(scanTimer);
    document.querySelectorAll(".vop-badge, .vop-inline").forEach((x) => x.remove());
    document.querySelectorAll("[data-vop-key], [data-vop-detail], [data-vop-score]").forEach((el) => {
      delete el.dataset.vopKey;
      delete el.dataset.vopDetail;
      delete el.dataset.vopScore;
      el.classList.remove("vop-dim");
    });
  }

  function shutdown() {
    if (dead) return;
    dead = true;
    stop();
    debug("extensão recarregada; recarregue a página pra voltar a ver as notas.");
  }

  // Reprocessa tudo (cache limpo no popup).
  function resetAll() {
    memo.clear();
    retries.clear();
    if (enabled) {
      stop();
      start();
    }
  }

  function syncEnabled() {
    if (settings[SITE.settingKey] !== false) start();
    else stop();
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    syncEnabled();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["vop:clearedAt"]) return resetAll();
    if (area !== "sync") return;
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (changes[k]) settings[k] = changes[k].newValue ?? DEFAULT_SETTINGS[k];
    }
    if (changes.badgeSize || changes.badgePosition) refreshBadgeClasses();
    if (changes.dimThreshold) applyDimAll();
    if (changes[SITE.settingKey]) syncEnabled();
  });
})();

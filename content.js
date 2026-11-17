// Vale o Play? — content script (Netflix e Disney+)
//
// Acha os cards de título na página, pede a nota ao service worker e pendura
// o badge na capa. Também mostra as notas em tamanho grande no detalhe do
// título e no billboard (Netflix), filtra capas abaixo do corte de qualidade
// e abre um cartão com a origem da nota (hover ou teclado).
//
// Como a Netflix e a Disney+ trocam nomes de classe com frequência, a
// detecção se apoia no que elas não conseguem mudar sem quebrar o próprio
// site: os links de navegação (/browse?jbv=ID, /watch/ID, /browse/entity-ID),
// os atributos de teste (data-uia, data-testid) e os rótulos de acessibilidade
// (aria-label). Se um dia os badges sumirem, o lugar pra ajustar é o objeto
// do site (NETFLIX ou DISNEY) logo abaixo; ligue o diagnóstico com
// localStorage.setItem("valeoplay:debug", "1") no console da página.
//
// Depende de icons.js (window.VOPIcons), carregado antes pelo manifest.

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

  const ICONS = window.VOPIcons;
  const ISSUES_URL = "https://github.com/bruno-l-rossi/vale-o-play/issues/new";
  const RETRY_DELAYS = [30000, 120000, 600000]; // reserva provisória / falha temporária

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function norm(s) {
    return clean(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
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
          id,
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
    // Billboard: o título gigante do topo da home. Estrutura não confirmada
    // no DOM real (a Netflix pede login), então a detecção é por heurística:
    // logo do título (alt), link /watch ou jbv e sinopse. Sem âncora, não faz nada.
    hero() {
      const out = [];
      const sel = '[data-uia="our-billboard"], [data-uia*="billboard"], .billboard-row .billboard, .billboard';
      for (const root of document.querySelectorAll(sel)) {
        if (root.parentElement && root.parentElement.closest(sel)) continue; // aninhado
        if (root.closest('[role="dialog"]')) continue;
        const link = root.querySelector('a[href*="/watch/"], a[href*="jbv="], a[href*="/title/"]');
        const id = nfId(link && link.getAttribute("href"));
        const logo = root.querySelector(
          'img[class*="title-logo"], img[class*="titleLogo"], [data-uia*="title-logo"] img, [class*="title-logo"] img, img.logo[alt], img[alt]:not([alt=""])'
        );
        const label = firstLabel([
          logo && (logo.getAttribute("alt") || logo.getAttribute("title")),
          root.querySelector('[class*="title-logo"][aria-label], [data-uia*="title-logo"][aria-label]')?.getAttribute("aria-label"),
        ]);
        const title = label?.title || (id && idTitles.get(id)) || null;
        const synopsis = root.querySelector('[class*="synopsis"], [data-uia*="synopsis"], .info-wrapper p');
        let anchor = null;
        if (synopsis) anchor = { el: synopsis, where: "before" };
        else if (logo) anchor = { el: logo.parentElement || logo, where: "after" };
        if (!title || !anchor) {
          debug("billboard encontrado, mas sem título ou âncora; ajustar NETFLIX.hero()");
          continue;
        }
        out.push({
          root,
          id,
          key: `nfh:${id || ""}:${norm(title)}`,
          title,
          year: label?.year || null,
          type: null,
          anchor,
          compact: true,
          badgeHost: null,
        });
      }
      return out;
    },
  };

  // Disney+: marcas e coleções que viram card mas não são título.
  const DISNEY_BRANDS = new Set(
    ["disney", "disney+", "pixar", "marvel", "star wars", "national geographic", "star", "hulu", "espn", "disney junior", "20th century studios"].map(norm)
  );

  // entity-<uuid> (formato atual) ou /movies|series/<slug>/<id> (antigo)
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
          id,
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
    showMissing: false, // mostra um traço no título sem nota
    dimThreshold: "off", // "off" ou o corte, em %
    dimMetric: "auto", // auto | critics | audience | min
    dimAction: "dim", // dim | hide
    dimUnrated: false, // aplica o filtro a título sem nota
    hidden: [], // títulos cuja nota o usuário escondeu
    enableNetflix: true,
    enableDisney: true,
  };
  let settings = { ...DEFAULT_SETTINGS };
  let enabled = false;

  // id do serviço (nf:ID / dp:ID) ou nome: chave de título pra "ocultar"
  function idsFor(q) {
    const id = q.id ? String(q.id) : "";
    if (SITE === NETFLIX) return { nfId: /^\d{5,10}$/.test(id) ? id : null, dpId: null };
    return { nfId: null, dpId: /^[0-9a-zA-Z-]{8,40}$/.test(id) ? id : null };
  }

  function titleKey(q) {
    const ids = idsFor(q);
    return ids.nfId ? `nf:${ids.nfId}` : ids.dpId ? `dp:${ids.dpId}` : `t:${norm(q.title)}`;
  }

  const isHidden = (q) => Array.isArray(settings.hidden) && settings.hidden.includes(titleKey(q));

  // -------------------------------------------------------------------------
  // Notas: pedido ao service worker com memo por página
  // -------------------------------------------------------------------------

  const idTitles = new Map(); // ID do vídeo -> nome (ajuda o modal a se achar)
  const memo = new Map(); // id|título|tipo|ano -> Promise<resposta|undefined>
  let dead = false; // extensão recarregada: este script ficou órfão

  // Resolve com a resposta { ok, value, miss, provisional, via } ou undefined
  // (falha de mensagem: tenta de novo depois). retry = true ignora o memo e
  // pede ao service worker que refaça entradas provisórias.
  function requestScore(q, priority, retry) {
    const { nfId: nid, dpId: did } = idsFor(q);
    const sid = nid ? `nf:${nid}` : did ? `dp:${did}` : null;
    // com ano/tipo (detalhe) a resposta pode ser melhor que a do card: outra chave
    const k = `${sid || ""}|${norm(q.title)}|${q.type || ""}|${q.year || ""}`;
    if (!retry && memo.has(k)) return memo.get(k);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "getScore",
            title: q.title,
            year: q.year || null,
            mediaType: q.type || null,
            priority,
            site: SITE.id,
            nfId: nid,
            dpId: did,
            retry: !!retry,
          },
          (res) => {
            const err = chrome.runtime.lastError;
            if (err || !res) {
              debug("falha ao pedir nota:", err?.message);
              return resolve(undefined);
            }
            resolve(res.ok ? res : undefined);
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
  // Partes da nota (ícone + texto) e o texto de explicação
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
        kind: imdb ? "imdb" : "tmdb",
        chip: imdb ? "IMDb" : "TMDB",
        text: fmtRating(s.rating),
        tip: imdb ? "Nota IMDb (0 a 10)" : "Nota de usuários do TMDB (0 a 10)",
      });
    } else {
      if (typeof s.critics === "number") {
        const cs = s.criticsSeasons;
        parts.push({
          kind: "critics",
          icon: s.critics >= 60 ? "fresh" : "rotten",
          text: `${s.critics}%`,
          // série sem nota da série inteira no RT: média das temporadas
          mark: cs ? "*" : "",
          label: "Críticos",
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
        parts.push({
          kind: "audience",
          icon: s.audience >= 60 ? "popcorn" : "spilled",
          text: `${s.audience}%`,
          label: "Audiência",
          tip: "Audiência (Popcornmeter)",
        });
      }
    }
    if (parts.length && isTopRated(s)) {
      parts.unshift({ kind: "trophy", icon: "trophy", text: "", tip: "Aclamado: nota altíssima de críticos e audiência", trophy: true });
    }
    return parts;
  }

  function sourceName(s) {
    return s.source === "imdb" ? "IMDb" : s.source === "tmdb" ? "TMDB" : "Rotten Tomatoes";
  }

  // texto curto pra leitor de tela e pro cartão
  function summaryText(s) {
    const bits = scoreParts(s)
      .filter((p) => p.text)
      .map((p) => (p.label ? `${p.label.toLowerCase()} ${p.text}` : `${p.chip} ${p.text}`));
    return `${sourceName(s)}${s.match ? `, ${s.match}` : ""}: ${bits.join(", ")}`;
  }

  const VIA_TEXT = {
    "netflix-id": "Identificado pelo código do título na Netflix.",
    "disney-id": "Identificado pelo código do título na Disney+.",
    wikidata: "Casado com a página do RT pelo Wikidata.",
    "rt-index": "Achado na busca do Rotten Tomatoes.",
    "rt-search": "Achado na busca do site do Rotten Tomatoes.",
    "rt-shown": "Casado pelo nome exibido no card.",
    override: "Corrigido manualmente.",
    "omdb-rt": "Só a nota de críticos (via OMDb); sem audiência.",
  };
  const MISS_TEXT = {
    rt_absent: "O Rotten Tomatoes não tem este título.",
    rt_no_score: "O Rotten Tomatoes tem a página, mas ainda sem avaliações.",
    transient: "O Rotten Tomatoes não respondeu agora.",
  };

  function noteText(s, res) {
    const lines = [];
    if (res && res.provisional) lines.push("Provisório: vou tentar o Rotten Tomatoes de novo em alguns minutos.");
    if (s.source !== "rt" && res && res.miss && MISS_TEXT[res.miss]) lines.push(MISS_TEXT[res.miss]);
    if (VIA_TEXT[s.via]) lines.push(VIA_TEXT[s.via]);
    return lines;
  }

  // -------------------------------------------------------------------------
  // Badge, linha de notas e estados
  // -------------------------------------------------------------------------

  function fillParts(el, s) {
    for (const p of scoreParts(s)) {
      const span = document.createElement("span");
      span.className = "vop-part" + (p.trophy ? " vop-trophy" : "") + (p.chip ? ` vop-chip vop-chip-${p.kind}` : "");
      span.dataset.kind = p.kind;
      span.dataset.tip = p.tip;
      if (p.chip) {
        span.textContent = `${p.chip} ${p.text}`;
      } else {
        span.appendChild(ICONS.make(p.icon));
        if (p.text) span.appendChild(document.createTextNode(p.text));
        if (p.mark) {
          const mark = document.createElement("small");
          mark.className = "vop-mark";
          mark.textContent = p.mark;
          span.appendChild(mark);
        }
      }
      el.appendChild(span);
    }
    return el.childNodes.length > 0;
  }

  function badgeClass(extra) {
    return `vop-badge vop-size-${settings.badgeSize} vop-pos-${settings.badgePosition}${extra || ""}`;
  }

  function openSource(s) {
    if (s && s.url) window.open(s.url, "_blank", "noopener");
  }

  // clique abre a fonte; teclado (Enter/Espaço) também; hover/foco abre o cartão
  function attachInteractions(el, s, info, res) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", `${summaryText(s)}${s.url ? ". Enter abre a página" : ""}`);
    if (s.url) el.classList.add("vop-clickable");
    const stop = (e) => e.stopPropagation();
    // não deixa o clique cair no card (que abriria o título no streaming)
    for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.addEventListener(ev, stop);
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSource(s);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openSource(s);
      } else if (e.key === "Escape") {
        closeCard();
      }
    });
    el.addEventListener("mouseenter", () => scheduleCard(el, s, info, res));
    el.addEventListener("focus", () => scheduleCard(el, s, info, res));
    el.addEventListener("mouseleave", () => scheduleClose());
    el.addEventListener("blur", () => scheduleClose());
  }

  function buildBadge(s, info, res) {
    const badge = document.createElement("div");
    badge.dataset.vopTop = isTopRated(s) ? "1" : "";
    if (!fillParts(badge, s)) return null;
    badge.className = badgeClass();
    if (badge.dataset.vopTop) badge.classList.add("vop-top");
    if (res && res.provisional) badge.classList.add("vop-provisional");
    attachInteractions(badge, s, info, res);
    return badge;
  }

  function placeBadge(host, badge) {
    const parent = SITE.badgeParent(host);
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    parent.appendChild(badge);
  }

  function refreshBadgeClasses() {
    document.querySelectorAll(".vop-badge").forEach((b) => {
      b.className = b.className
        .split(/\s+/)
        .filter((c) => c && !/^vop-(size|pos)-/.test(c))
        .join(" ");
      b.classList.add(`vop-size-${settings.badgeSize}`, `vop-pos-${settings.badgePosition}`);
    });
  }

  // Estados sem nota: carregando (aparece só se demorar), falha (clicável) e
  // "sem nota" (opcional).
  function showState(host, info, kind) {
    if (host.querySelector(".vop-badge")) return; // já tem badge (ex.: reserva provisória)
    const b = document.createElement("div");
    b.className = badgeClass(` vop-state vop-${kind}`);
    if (kind === "loading") {
      const dot = document.createElement("span");
      dot.className = "vop-dot";
      b.appendChild(dot);
      b.setAttribute("aria-label", "Buscando a nota");
    } else if (kind === "failed") {
      b.textContent = "↻";
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.setAttribute("aria-label", "Não consegui buscar a nota. Clique para tentar de novo");
      b.title = "Não consegui buscar a nota. Clique pra tentar de novo";
      const again = (e) => {
        e.preventDefault();
        e.stopPropagation();
        failRetries.delete(info.key);
        retries.delete(info.key);
        resolveCard(host, info, { retry: true });
      };
      b.addEventListener("click", again);
      b.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && again(e));
    } else {
      b.textContent = "–";
      b.setAttribute("aria-label", "Sem nota no Rotten Tomatoes");
      b.title = "Sem nota no Rotten Tomatoes";
    }
    for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) b.addEventListener(ev, (e) => e.stopPropagation());
    placeBadge(host, b);
  }

  // -------------------------------------------------------------------------
  // Cartão de detalhe (hover ou foco no badge)
  // -------------------------------------------------------------------------

  let cardEl = null;
  let showT = null;
  let hideT = null;

  function scheduleCard(anchor, s, info, res) {
    clearTimeout(hideT);
    clearTimeout(showT);
    showT = setTimeout(() => openCard(anchor, s, info, res), 150);
  }

  function scheduleClose() {
    clearTimeout(showT);
    clearTimeout(hideT);
    hideT = setTimeout(closeCard, 250);
  }

  function closeCard() {
    clearTimeout(showT);
    if (cardEl) {
      cardEl.remove();
      cardEl = null;
    }
  }

  function btn(label, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vop-card-btn" + (cls ? ` ${cls}` : "");
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function reportWrong(s, info) {
    let version = "?";
    try {
      version = chrome.runtime.getManifest().version;
    } catch (e) {
      /* sem manifest nos testes */
    }
    const body = [
      `Título: ${info.title}`,
      `Site: ${SITE.id}`,
      `ID: ${info.id || "-"}`,
      `Obra casada: ${s.match || "-"}`,
      `Fonte: ${sourceName(s)}`,
      `Link: ${s.url || "-"}`,
      `Via: ${s.via || "-"}`,
      `Versão: ${version}`,
    ].join("\n");
    window.open(`${ISSUES_URL}?title=${encodeURIComponent(`Nota errada: ${info.title}`)}&body=${encodeURIComponent(body)}`, "_blank", "noopener");
  }

  function messageBase(info) {
    const ids = idsFor(info);
    return { title: info.title, year: info.year || null, mediaType: info.type || null, site: SITE.id, nfId: ids.nfId, dpId: ids.dpId };
  }

  // Cola o link da página certa no RT: vale pra este título daqui pra frente
  function correctTitle(info) {
    const typed = window.prompt(
      `Cole o link da página certa de "${info.title}" no Rotten Tomatoes\n(rottentomatoes.com/m/... para filme ou /tv/... para série):`
    );
    if (!typed) return;
    const m = /rottentomatoes\.com\/((?:m|tv)\/[^/?#\s]+)/i.exec(typed);
    if (!m) {
      window.alert("Não reconheci o link. Ele precisa ter rottentomatoes.com/m/... ou rottentomatoes.com/tv/...");
      return;
    }
    chrome.runtime.sendMessage({ ...messageBase(info), type: "setOverride", path: m[1] }, () => void chrome.runtime.lastError);
    closeCard();
  }

  function clearCorrection(info) {
    chrome.runtime.sendMessage({ ...messageBase(info), type: "clearOverride" }, () => void chrome.runtime.lastError);
    closeCard();
  }

  function hideTitle(info) {
    const list = [...new Set([...(settings.hidden || []), titleKey(info)])].slice(-200);
    settings.hidden = list;
    try {
      chrome.storage.sync.set && chrome.storage.sync.set({ hidden: list });
    } catch (e) {
      /* só nesta página */
    }
    closeCard();
    refreshVisible();
  }

  function openCard(anchor, s, info, res) {
    if (!anchor.isConnected || dead) return;
    closeCard();
    const card = document.createElement("div");
    card.className = "vop-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Detalhes da nota de ${info.title}`);

    const head = document.createElement("div");
    head.className = "vop-card-head";
    head.textContent = sourceName(s);
    if (s.match) {
      const m = document.createElement("span");
      m.textContent = ` · ${s.match}`;
      head.appendChild(m);
    }
    card.appendChild(head);

    for (const p of scoreParts(s).filter((x) => !x.trophy)) {
      const line = document.createElement("div");
      line.className = "vop-card-line";
      if (p.icon) line.appendChild(ICONS.make(p.icon));
      const t = document.createElement("span");
      t.textContent = p.chip ? `${p.chip} ${p.text}` : `${p.tip}: ${p.text}`;
      line.appendChild(t);
      card.appendChild(line);
    }
    if (isTopRated(s)) {
      const line = document.createElement("div");
      line.className = "vop-card-line";
      line.appendChild(ICONS.make("trophy"));
      const t = document.createElement("span");
      t.textContent = "Aclamado: críticos e audiência acima de 90%";
      line.appendChild(t);
      card.appendChild(line);
    }
    for (const text of noteText(s, res)) {
      const n = document.createElement("div");
      n.className = "vop-card-note";
      n.textContent = text;
      card.appendChild(n);
    }

    const actions = document.createElement("div");
    actions.className = "vop-card-actions";
    if (s.url) actions.appendChild(btn(s.source === "rt" ? "Abrir no Rotten Tomatoes" : `Abrir no ${sourceName(s)}`, () => openSource(s), "vop-primary"));
    actions.appendChild(btn("Corrigir pelo link do RT", () => correctTitle(info)));
    if (s.via === "override") actions.appendChild(btn("Remover correção", () => clearCorrection(info)));
    actions.appendChild(btn("Esconder nota deste título", () => hideTitle(info)));
    actions.appendChild(btn("Nota errada? Avisar", () => reportWrong(s, info)));
    card.appendChild(actions);

    card.addEventListener("mouseenter", () => clearTimeout(hideT));
    card.addEventListener("mouseleave", () => scheduleClose());
    document.body.appendChild(card);
    cardEl = card;

    // posição: abaixo do badge; se não couber, acima. Nunca fora da tela.
    const r = anchor.getBoundingClientRect();
    const cw = card.offsetWidth || 260;
    const ch = card.offsetHeight || 160;
    let top = r.bottom + 6;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 6);
    let left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - cw - 8));
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  // -------------------------------------------------------------------------
  // Filtro de qualidade: esmaece ou esconde a capa abaixo do corte
  // -------------------------------------------------------------------------

  const num = (v) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  function filterValue(host) {
    const c = num(host.dataset.vopCritics);
    const a = num(host.dataset.vopAudience);
    const eff = num(host.dataset.vopScore);
    switch (settings.dimMetric) {
      case "critics":
        return c;
      case "audience":
        return a;
      case "min": {
        const have = [c, a].filter((v) => v !== null);
        return have.length ? Math.min(...have) : eff;
      }
      default:
        return eff;
    }
  }

  function applyDim(host) {
    const t = settings.dimThreshold;
    let hit = false;
    if (t !== "off") {
      if (host.dataset.vopNone === "1") {
        hit = !!settings.dimUnrated;
      } else {
        const v = filterValue(host);
        hit = v !== null && v < Number(t);
      }
    }
    host.classList.toggle("vop-dim", hit && settings.dimAction !== "hide");
    host.classList.toggle("vop-hide", hit && settings.dimAction === "hide");
  }

  function applyDimAll() {
    document.querySelectorAll("[data-vop-key]").forEach(applyDim);
  }

  function setScoreData(host, s, res) {
    delete host.dataset.vopScore;
    delete host.dataset.vopCritics;
    delete host.dataset.vopAudience;
    delete host.dataset.vopNone;
    if (s) {
      const eff = effectiveScore(s);
      if (eff !== null) host.dataset.vopScore = String(eff);
      if (typeof s.critics === "number") host.dataset.vopCritics = String(s.critics);
      if (typeof s.audience === "number") host.dataset.vopAudience = String(s.audience);
    } else if (!(res && res.provisional)) {
      host.dataset.vopNone = "1";
    }
    applyDim(host);
  }

  // -------------------------------------------------------------------------
  // Cards: varredura + carga preguiçosa (só o que está perto da tela)
  // -------------------------------------------------------------------------

  const pending = new WeakMap(); // host -> info aguardando ficar visível
  const infoOf = new WeakMap(); // host -> info já carregada (pra refazer sem varrer)
  const retries = new Map(); // chave -> tentativas após resposta provisória
  const failRetries = new Map(); // chave -> tentativas após falha de mensagem
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
    host.classList.remove("vop-dim", "vop-hide");
    delete host.dataset.vopScore;
    delete host.dataset.vopCritics;
    delete host.dataset.vopAudience;
    delete host.dataset.vopNone;
  }

  function loadCard(host) {
    const info = pending.get(host);
    if (!info) return Promise.resolve();
    pending.delete(host);
    infoOf.set(host, info);
    return resolveCard(host, info);
  }

  async function resolveCard(host, info, opts = {}) {
    const loadingTimer = setTimeout(() => {
      if (host.dataset.vopKey === info.key && host.isConnected) showState(host, info, "loading");
    }, 400);
    const res = await requestScore(info, "normal", opts.retry);
    clearTimeout(loadingTimer);
    if (host.dataset.vopKey !== info.key || !host.isConnected) return; // card mudou
    host.querySelectorAll(".vop-state").forEach((b) => b.remove());
    if (res === undefined) return failLater(host, info);
    renderCard(host, info, res);
  }

  function renderCard(host, info, res) {
    const s = res.value;
    host.querySelectorAll(".vop-badge").forEach((b) => b.remove());
    setScoreData(host, s, res);
    if (isHidden(info)) return;
    if (!s) {
      if (res.provisional) scheduleRetry(host, info);
      else if (settings.showMissing) showState(host, info, "none");
      return;
    }
    const badge = buildBadge(s, info, res);
    if (!badge) return;
    placeBadge(host, badge);
    if (res.provisional) scheduleRetry(host, info);
  }

  // reserva provisória ou falha temporária do RT: tenta de novo (30 s, 2 min, 10 min)
  function scheduleRetry(host, info) {
    const n = retries.get(info.key) || 0;
    if (n >= RETRY_DELAYS.length) {
      if (!host.querySelector(".vop-badge")) showState(host, info, "failed");
      return;
    }
    retries.set(info.key, n + 1);
    setTimeout(() => {
      if (dead || !enabled || host.dataset.vopKey !== info.key || !host.isConnected) return;
      resolveCard(host, info, { retry: true });
    }, RETRY_DELAYS[n]);
  }

  // a mensagem ao service worker falhou (ele estava acordando, por exemplo)
  function failLater(host, info) {
    const n = (failRetries.get(info.key) || 0) + 1;
    failRetries.set(info.key, n);
    if (n > 3) return showState(host, info, "failed");
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
  // Detalhe do título e billboard: linha de notas grande perto da sinopse
  // -------------------------------------------------------------------------

  const detailRetries = new Map();

  async function processDetail(d, retry) {
    const { root } = d;
    if (!retry && root.dataset.vopDetail === d.key) return;
    root.dataset.vopDetail = d.key;
    root.querySelectorAll(".vop-inline, .vop-badge.vop-modal").forEach((x) => x.remove());

    const res = await requestScore(d, "high", retry);
    if (root.dataset.vopDetail !== d.key || !root.isConnected) return;
    if (res === undefined) {
      delete root.dataset.vopDetail; // tenta de novo na próxima varredura
      return;
    }
    const s = res.value;
    if (res.provisional) {
      const n = detailRetries.get(d.key) || 0;
      if (n < RETRY_DELAYS.length) {
        detailRetries.set(d.key, n + 1);
        setTimeout(() => {
          if (!dead && enabled && root.isConnected && root.dataset.vopDetail === d.key) processDetail(d, true);
        }, RETRY_DELAYS[n]);
      }
    }
    if (!s || isHidden(d)) return;

    if (d.anchor && d.anchor.el.isConnected) {
      const row = document.createElement("div");
      row.className = "vop-inline" + (d.compact ? " vop-compact" : "") + (isTopRated(s) ? " vop-top-inline" : "") + (res.provisional ? " vop-provisional" : "");
      if (!fillParts(row, s)) return;
      attachInteractions(row, s, d, res);
      root.querySelectorAll(".vop-inline").forEach((x) => x.remove());
      const { el, where } = d.anchor;
      if (where === "before") el.parentElement.insertBefore(row, el);
      else if (where === "after") el.insertAdjacentElement("afterend", row);
      else el.insertAdjacentElement("afterbegin", row);
    } else if (d.badgeHost && d.badgeHost.isConnected) {
      const badge = buildBadge(s, d, res);
      if (!badge) return;
      badge.classList.add("vop-modal");
      if (getComputedStyle(d.badgeHost).position === "static") d.badgeHost.style.position = "relative";
      d.badgeHost.appendChild(badge);
    }
  }

  function scanDetails() {
    const list = [...SITE.details(), ...(SITE.hero ? SITE.hero() : [])];
    for (const d of list) processDetail(d);
  }

  // -------------------------------------------------------------------------
  // Refazer o que está na tela (nota atualizada em segundo plano, correção
  // manual, título escondido ou "mostrar traço" ligado)
  // -------------------------------------------------------------------------

  let refreshTimer = null;
  function refreshVisible() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!enabled || dead) return;
      memo.clear();
      retries.clear();
      document.querySelectorAll("[data-vop-key]").forEach((host) => {
        const info = infoOf.get(host);
        if (!info || host.dataset.vopKey !== info.key || pending.has(host)) return;
        pending.set(host, info);
        loadCard(host);
      });
      document.querySelectorAll("[data-vop-detail]").forEach((root) => delete root.dataset.vopDetail);
      scanDetails();
    }, 1200);
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

  const isOurs = (n) =>
    n.nodeType === 1 && (n.classList.contains("vop-badge") || n.classList.contains("vop-inline") || n.classList.contains("vop-card"));

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
    clearTimeout(refreshTimer);
    closeCard();
    document.querySelectorAll(".vop-badge, .vop-inline").forEach((x) => x.remove());
    document.querySelectorAll("[data-vop-key], [data-vop-detail], [data-vop-score], [data-vop-none]").forEach((el) => {
      delete el.dataset.vopKey;
      delete el.dataset.vopDetail;
      delete el.dataset.vopScore;
      delete el.dataset.vopCritics;
      delete el.dataset.vopAudience;
      delete el.dataset.vopNone;
      el.classList.remove("vop-dim", "vop-hide");
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
    failRetries.clear();
    detailRetries.clear();
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
    if (area === "local") {
      if (changes["vop:clearedAt"]) return resetAll();
      if (changes["vop:updatedAt"]) refreshVisible(); // uma nota mudou em segundo plano
      return;
    }
    if (area !== "sync") return;
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (changes[k]) settings[k] = changes[k].newValue ?? DEFAULT_SETTINGS[k];
    }
    if (changes.badgeSize || changes.badgePosition) refreshBadgeClasses();
    if (changes.dimThreshold || changes.dimMetric || changes.dimAction || changes.dimUnrated) applyDimAll();
    if (changes.showMissing || changes.hidden) refreshVisible();
    if (changes[SITE.settingKey]) syncEnabled();
  });
})();

// Testes do content script com jsdom (DOM no formato real de out/2026).
// Rodar: npm test (dentro de tests/), que instala o jsdom.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const windows = [];
test.after(() => windows.forEach((w) => w.close()));

const SCORES = {
  "Genie, Make a Wish": { source: "rt", critics: 75, audience: 67, url: "https://rt/genie", match: "Genie, Make a Wish (2025)" },
  "Stranger Things": { source: "rt", critics: 91, audience: 92, url: "https://rt/st", match: "Stranger Things (2016)" },
  "Breaking Bad": { source: "rt", critics: 96, audience: 97, url: "https://rt/bb" },
  "Beleza Fatal": { source: "imdb", rating: 7.8, url: "https://imdb/bf" },
  Dark: { source: "rt", critics: 95, audience: 94 },
  "Family Guy": { source: "rt", critics: null, audience: 65, url: "https://rt/fg" },
  "O Rei do Pedaço": { source: "tmdb", rating: 7.4, url: "https://tmdb/k" },
  "Os Simpsons": { source: "rt", critics: 85, audience: 76, url: "https://rt/simpsons" },
  Futurama: { source: "rt", critics: 40, audience: 85 },
};

async function setup(url, html, { settings = {}, scores = SCORES } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Netflix</title></head><body>${html}</body></html>`, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  windows.push(window);
  const asked = [];
  const syncListeners = [];
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { setTimeout(() => this.cb([{ isIntersecting: true, target: el }]), 0); }
    unobserve() {}
    disconnect() {}
  };
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        asked.push(msg);
        setTimeout(() => cb({ ok: true, value: scores[msg.title] || null }), 5);
      },
    },
    storage: {
      sync: { get(defaults, cb) { setTimeout(() => cb({ ...defaults, ...settings }), 0); } },
      onChanged: { addListener(fn) { syncListeners.push(fn); } },
    },
  };
  window.open = (u) => (window.__opened = u);
  window.eval(SRC);
  await settle();
  const changeSettings = async (changes) => {
    const c = {};
    for (const [k, v] of Object.entries(changes)) c[k] = { newValue: v };
    syncListeners.forEach((fn) => fn(c, "sync"));
    await settle();
  };
  return { window, doc: window.document, asked, changeSettings, settle };
}

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));
// texto das partes do badge/linha, separadas por espaço (o espaçamento visual é CSS)
const partsText = (el) => (el ? [...el.querySelectorAll(".vop-part")].map((p) => p.textContent.trim()).join(" ") : null);
const badgeText = (el) => partsText(el?.querySelector(".vop-badge")) ?? null;

// ---------------- Netflix ----------------

const NETFLIX_2026 = `
<div class="billboard-row"><div class="billboard"><a href="/watch/80057281"><button aria-label="Assistir">Assistir</button></a><img src="hero.jpg"></div></div>
<header><a href="/browse/my-list">Minha lista</a><a href="/title/80057281">Stranger Things</a></header>
<div class="lolomoRow">
  <div class="slider-item"><a id="c1" href="/browse?jbv=81748484" tabindex="0" aria-label="Genie, Make a Wish" data-uia="standard-card"><div><div><img alt="" src="x.webp"></div></div></a></div>
  <div class="slider-item"><a id="c2" href="/browse?jbv=80057281" aria-label="Stranger Things" data-uia="ranked-card"><img alt="" src="y.webp"></a></div>
  <div class="slider-item"><a id="c3" href="/browse?jbv=81111111" aria-label="Beleza Fatal" data-uia="progress-card"><img alt="" src="z.webp"></a></div>
  <div class="slider-item"><a id="c4" href="/browse?jbv=82222222" aria-label="Título Sem Nota" data-uia="standard-card"><img alt="" src="w.webp"></a></div>
  <div class="slider-item"><a id="c5" href="/browse?jbv=83333333" aria-label="Carregando" data-uia="standard-card"></a></div>
</div>`;

const NETFLIX_LEGACY = `
<div class="title-card-container"><div class="title-card" id="legacy"><div class="ptrack-content">
  <a href="/watch/70143836?tctx=0" aria-label="Breaking Bad" class="slider-refocus">
    <div class="boxart-size-16x9 boxart-container"><img class="boxart-image" src="b.jpg" alt="Breaking Bad">
      <div class="fallback-text-container"><p class="fallback-text">Breaking Bad</p></div></div>
  </a></div></div></div>`;

test("Netflix 2026: badge em cada card standard/ranked/progress, nada no billboard/header", async () => {
  const { doc, asked } = await setup("https://www.netflix.com/browse", NETFLIX_2026);
  assert.equal(badgeText(doc.getElementById("c1")), "🍅 75% 🍿 67%");
  assert.equal(badgeText(doc.getElementById("c2")), "🏆 🍅 91% 🍿 92%");
  assert.equal(badgeText(doc.getElementById("c3")), "⭐ 7,8IMDb");
  assert.equal(badgeText(doc.getElementById("c4")), null); // sem nota: sem badge
  assert.equal(doc.querySelectorAll(".vop-badge").length, 3);
  assert.equal(doc.querySelector(".billboard .vop-badge"), null);
  assert.equal(doc.querySelector("header .vop-badge"), null);
  const titles = asked.map((m) => m.title).sort();
  assert.deepEqual(titles, ["Beleza Fatal", "Genie, Make a Wish", "Stranger Things", "Título Sem Nota"]);
  // o card do aclamado ganha a classe dourada; o badge tem dica da fonte
  const top = doc.querySelector("#c2 .vop-badge");
  assert.ok(top.classList.contains("vop-top"));
  assert.match(top.title, /Rotten Tomatoes · Stranger Things \(2016\)/);
});

test("Netflix: clique no badge abre a fonte e não deixa o clique cair no card", async () => {
  const { window, doc } = await setup("https://www.netflix.com/browse", NETFLIX_2026);
  let cardClicked = false;
  doc.getElementById("c1").addEventListener("click", () => (cardClicked = true));
  doc.querySelector("#c1 .vop-badge").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(window.__opened, "https://rt/genie");
  assert.equal(cardClicked, false);
});

test("Netflix legado (.title-card): badge dentro da capa", async () => {
  const { doc } = await setup("https://www.netflix.com/browse", NETFLIX_LEGACY);
  const box = doc.querySelector("#legacy .boxart-container");
  assert.equal(badgeText(box), "🏆 🍅 96% 🍿 97%");
  assert.equal(doc.querySelectorAll(".vop-badge").length, 1, "card + link interno não duplicam badge");
});

test("Netflix: card carregado depois (lazy) e card reciclado com outro título", async () => {
  const { doc, settle } = await setup("https://www.netflix.com/browse", NETFLIX_2026);
  // lazy: a imagem chega depois
  const c5 = doc.getElementById("c5");
  c5.setAttribute("aria-label", "Dark");
  c5.innerHTML = '<img alt="" src="d.webp">';
  await settle();
  assert.equal(badgeText(c5), "🏆 🍅 95% 🍿 94%");
  // reciclagem: o mesmo <a> passa a mostrar outro título
  const c1 = doc.getElementById("c1");
  c1.setAttribute("href", "/browse?jbv=70143836");
  c1.setAttribute("aria-label", "Breaking Bad");
  await settle();
  assert.equal(badgeText(c1), "🏆 🍅 96% 🍿 97%");
  assert.equal(c1.querySelectorAll(".vop-badge").length, 1);
});

test("Netflix: modal de detalhe (?jbv=) ganha linha de notas antes da sinopse; cards do modal ficam de fora", async () => {
  const html = `${NETFLIX_2026}
  <div class="previewModal--container detail-modal" data-uia="previewModal--container" role="dialog">
    <div class="previewModal--player_container"><img class="previewModal--player-titleTreatment-logo" data-uia="previewModal--player-titleTreatment-logo" alt="Stranger Things"></div>
    <div class="previewModal--detailsMetadata" data-uia="previewModal--detailsMetadata">
      <div class="videoMetadata--container" data-uia="videoMetadata--container">2016 · 4 temporadas · 16+</div>
      <p class="preview-modal-synopsis" data-uia="preview-modal-synopsis">Quando um garoto desaparece...</p>
    </div>
    <div class="moreLikeThis--container"><div class="titleCard--container"><a href="/watch/80100172" aria-label="Dark"><img src="d.jpg"></a></div></div>
  </div>`;
  const { doc, asked } = await setup("https://www.netflix.com/browse?jbv=80057281", html);
  const row = doc.querySelector(".vop-inline");
  assert.ok(row, "linha de notas criada");
  assert.equal(row.nextElementSibling.className, "preview-modal-synopsis");
  assert.equal(partsText(row), "🏆 🍅 91% 🍿 92%");
  assert.equal(doc.querySelector(".moreLikeThis--container .vop-badge"), null);
  const detailAsk = asked.find((m) => m.priority === "high");
  assert.deepEqual({ title: detailAsk.title, year: detailAsk.year, mediaType: detailAsk.mediaType }, { title: "Stranger Things", year: 2016, mediaType: "tv" });
});

test("Netflix: mini-modal do hover sem logo usa o nome do card pelo ID e fica compacto", async () => {
  const html = `${NETFLIX_2026}
  <div class="previewModal--container mini-modal" data-uia="previewModal--container">
    <div class="previewModal--player_container"><img src="p.jpg"></div>
    <div class="previewModal--info">
      <div class="buttonControls--container" data-uia="mini-modal-controls"><a href="/watch/81748484" aria-label="Assistir"></a></div>
      <div class="videoMetadata--container" data-uia="videoMetadata--container">16+ · 1 temporada</div>
    </div>
  </div>`;
  const { doc } = await setup("https://www.netflix.com/browse", html);
  const row = doc.querySelector(".previewModal--info .vop-inline");
  assert.ok(row);
  assert.ok(row.classList.contains("vop-compact"));
  assert.equal(row.previousElementSibling.className, "videoMetadata--container");
  assert.equal(partsText(row), "🍅 75% 🍿 67%");
});

test("Netflix: player (/watch) não varre; preferências mudam badge, filtro e liga/desliga", async () => {
  const idle = await setup("https://www.netflix.com/watch/80057281", NETFLIX_2026);
  assert.equal(idle.asked.length, 0);

  const { doc, changeSettings } = await setup("https://www.netflix.com/browse", NETFLIX_2026);
  await changeSettings({ badgeSize: "large", badgePosition: "bottom-right" });
  const b = doc.querySelector("#c2 .vop-badge");
  assert.ok(b.classList.contains("vop-size-large") && b.classList.contains("vop-pos-bottom-right"));
  assert.ok(b.classList.contains("vop-top") && b.classList.contains("vop-clickable"));

  await changeSettings({ dimThreshold: "80" });
  assert.ok(doc.getElementById("c1").classList.contains("vop-dim")); // 75 < 80
  assert.ok(!doc.getElementById("c2").classList.contains("vop-dim")); // 91
  assert.ok(doc.getElementById("c3").classList.contains("vop-dim")); // IMDb 7,8 -> 78

  await changeSettings({ enableNetflix: false });
  assert.equal(doc.querySelectorAll(".vop-badge, .vop-inline, .vop-dim").length, 0);
  await changeSettings({ enableNetflix: true });
  assert.equal(doc.querySelectorAll(".vop-badge").length, 3);
});

// ---------------- Disney+ ----------------

const DISNEY_TILES = `
<nav data-testid="nav"><a href="/pt-br/browse/entity-aaaaaaaa-0000-0000-0000-000000000000" aria-label="Início"><img alt="Disney+ Logo"></a></nav>
<div data-testid="set">
  <a id="d1" data-item-id="x1" href="/pt-br/browse/entity-3c3c0f8b-7366-4d15-88ab-18050285978e" aria-label="Family Guy. Selecione para ver detalhes." class="underline relative block"><div><img alt="Family Guy" src="fg.jpg"></div></a>
  <a id="d2" href="/pt-br/browse/entity-52b8dd8a-eff2-4ed2-9b8d-7c0039df1c53" aria-label="O Rei do Pedaço" class="underline"><img alt="thumbnail - O Rei do Pedaço" src="k.jpg"></a>
  <a id="d3" href="/pt-br/browse/entity-85bf4cc1-cd8b-4469-ad87-7289217a0b74"><figure><img alt="thumbnail - Futurama" src="f.jpg"></figure></a>
  <a id="brand" href="/pt-br/browse/entity-bbbbbbbb-0000-0000-0000-000000000000" aria-label="Pixar"><img alt="Pixar" src="p.jpg"></a>
</div>`;

test("Disney+: tiles (logado e público), sem marcas nem menu", async () => {
  const { doc, asked } = await setup("https://www.disneyplus.com/pt-br/home", DISNEY_TILES);
  assert.equal(badgeText(doc.getElementById("d1")), "🍿 65%");
  assert.equal(badgeText(doc.getElementById("d2")), "★ 7,4TMDB");
  assert.equal(badgeText(doc.getElementById("d3")), "🟢 40% 🍿 85%");
  assert.equal(badgeText(doc.getElementById("brand")), null);
  assert.equal(doc.querySelector("nav .vop-badge"), null);
  assert.deepEqual(asked.map((m) => m.title).sort(), ["Family Guy", "Futurama", "O Rei do Pedaço"]);
});

test("Disney+: página de detalhe (/browse/entity-) ganha a linha após os metadados", async () => {
  const html = `
  <main>
    <section data-testid="hero">
      <div data-testid="details-page-background-image"><img alt="Os Simpsons" src="bg.jpg"></div>
      <img alt="Os Simpsons" src="logo.png">
      <div data-testid="masthead-metadata"><span>1989 – 2025</span> • <span>38 temporadas</span> <span>Comédia, Animação</span></div>
      <a data-testid="details-signup-cta" href="/pt-br/sign-up">Assinar</a>
    </section>
    <section data-testid="detail"><div><h1 data-testid="content-title">Os Simpsons</h1></div>
      <div data-testid="details-metadata">...</div></section>
    <div data-testid="you-may-also-like">${DISNEY_TILES}</div>
  </main>`;
  const { doc, asked } = await setup("https://www.disneyplus.com/pt-br/browse/entity-cac75c8f-a9e2-4d95-ac73-1cf1cc7b9568", html);
  const row = doc.querySelector(".vop-inline");
  assert.ok(row);
  assert.equal(row.previousElementSibling.getAttribute("data-testid"), "masthead-metadata");
  assert.equal(partsText(row), "🍅 85% 🍿 76%");
  const detailAsk = asked.find((m) => m.priority === "high");
  assert.deepEqual({ t: detailAsk.title, y: detailAsk.year, m: detailAsk.mediaType }, { t: "Os Simpsons", y: 1989, m: "tv" });
  assert.equal(doc.querySelector('[data-testid="hero"] .vop-badge'), null);
  assert.equal(doc.querySelectorAll('[data-testid="you-may-also-like"] .vop-badge').length, 3);
});

test("Disney+: sem h1 nem metadados, o nome vem do título da aba", async () => {
  const { doc, asked } = await setup(
    "https://www.disneyplus.com/browse/entity-cac75c8f-a9e2-4d95-ac73-1cf1cc7b9568",
    `<main><section data-testid="hero"><div>poster</div></section></main>`
  );
  doc.title = "Assistir a Os Simpsons | Disney+";
  await new Promise((r) => setTimeout(r, 5600)); // espera a rede de segurança (5s)
  assert.ok(asked.some((m) => m.title === "Os Simpsons" && m.priority === "high"));
  assert.ok(doc.querySelector('[data-testid="hero"] > .vop-inline'));
});

test("Netflix pública (sem login): \"Go to Nome\" e capa em background-image", async () => {
  const html = `<div data-uia="more-like-this"><ul>
    <li><a id="p1" href="https://www.netflix.com/title/80100172" data-uia="titleId-80100172" aria-label="Go to Dark"><div><span style="background-image:url(x.webp)"></span>Dark</div></a></li>
  </ul></div>`;
  const { doc, asked } = await setup("https://www.netflix.com/br/title/80057281", html);
  assert.deepEqual(asked.map((m) => m.title), ["Dark"]);
  assert.equal(badgeText(doc.getElementById("p1")), "🏆 🍅 95% 🍿 94%");
});

test("nota de críticos vinda da média das temporadas: asterisco e dica explicando", async () => {
  const scores = {
    "Os Simpsons": { source: "rt", critics: 85, audience: 76, criticsSeasons: { rated: 21, total: 38 }, url: "https://rt/s" },
    NCIS: { source: "rt", critics: 95, audience: 95, criticsSeasons: { rated: 1, total: 24 }, url: "https://rt/n" },
  };
  const html = `<div class="row">
    <div class="slider-item"><a id="s1" href="/browse?jbv=1" aria-label="Os Simpsons" data-uia="standard-card"><img alt="" src="a.webp"></a></div>
    <div class="slider-item"><a id="s2" href="/browse?jbv=2" aria-label="NCIS" data-uia="standard-card"><img alt="" src="b.webp"></a></div>
  </div>`;
  const { doc } = await setup("https://www.netflix.com/browse", html, { scores });
  const crit = doc.querySelector("#s1 .vop-part");
  assert.equal(crit.textContent, "🍅 85%*");
  assert.equal(crit.title, "Críticos: média das 21 temporadas com nota no RT (de 38)");
  const one = doc.querySelector("#s2 .vop-badge");
  assert.equal(one.querySelector(".vop-part").title, "Críticos: só 1 das 24 temporadas tem nota no RT");
  assert.ok(!one.classList.contains("vop-top"), "uma temporada só não dá troféu");
});

test("site desconhecido: script não faz nada", async () => {
  const { doc, asked } = await setup("https://example.com/", NETFLIX_2026);
  assert.equal(asked.length, 0);
  assert.equal(doc.querySelectorAll(".vop-badge").length, 0);
});

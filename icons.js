// Vale o Play? — ícones em SVG (iguais em qualquer sistema, ao contrário dos
// emojis). Formas próprias, sem copiar as marcas do Rotten Tomatoes.
// Usado pelo content script (badge e cartão) e pelo popup (legenda).
// Fresco x podre se distingue pela forma E pela cor, não só pela cor.

(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  const SHAPES = {
    // críticos, nota >= 60%: tomate com folhas
    fresh: [
      ["circle", { cx: 12, cy: 13.5, r: 8.5, fill: "#fa320a" }],
      ["path", { d: "M12 5.8c-1-2.3-3-3.2-5-2.7 1.1.6 1.8 1.4 2.1 2.4-1.7-.3-3.2.3-4.2 1.6 1.7 0 3 .6 3.9 1.6L12 7.5l3.2 1.2c.9-1 2.2-1.6 3.9-1.6-1-1.3-2.5-1.9-4.2-1.6.3-1 1-1.8 2.1-2.4-2-.5-4 .4-5 2.7z", fill: "#3a9e2f" }],
      ["circle", { cx: 8.6, cy: 12.2, r: 1.5, fill: "#ff8a6e", opacity: 0.7 }],
    ],
    // críticos, nota < 60%: mancha verde irregular
    rotten: [
      ["path", { d: "M12 3.2c2 0 2.8 1.8 4.8 2 2 .2 4.4 1 4.2 3.6-.2 2.2-2 2.6-1.8 4.6.2 2.2 1.4 4.4-.8 5.6-2 1.2-3.8-.8-6-.4-2.2.4-3.4 2.4-5.6 1.4-2.4-1.2-1-3.8-1.6-5.8-.6-2-2.8-2.6-2.2-5 .6-2.2 3-1.8 4.4-3.2C9.2 4 10 3.2 12 3.2z", fill: "#6fa03a" }],
      ["circle", { cx: 9, cy: 10, r: 1.3, fill: "#c9e6a2" }],
      ["circle", { cx: 15, cy: 14.5, r: 1, fill: "#4c7a25" }],
    ],
    // audiência, nota >= 60%: balde de pipoca
    popcorn: [
      ["path", { d: "M5.6 10.5h12.8l-1.7 10.8H7.3z", fill: "#fa320a" }],
      ["path", { d: "M9.6 10.5l.5 10.8M14.4 10.5l-.5 10.8", stroke: "#fff", "stroke-width": 1.3, fill: "none" }],
      ["circle", { cx: 8, cy: 8.2, r: 2.7, fill: "#ffd966" }],
      ["circle", { cx: 12, cy: 6.6, r: 3.1, fill: "#fff1b8" }],
      ["circle", { cx: 16, cy: 8.2, r: 2.7, fill: "#ffd966" }],
    ],
    // audiência, nota < 60%: copo cinza com canudo
    spilled: [
      ["path", { d: "M7.2 7.5h9.6l-1.3 13.8H8.5z", fill: "#8c97a8" }],
      ["path", { d: "M6 7.5h12", stroke: "#d3dae3", "stroke-width": 2.2, "stroke-linecap": "round", fill: "none" }],
      ["path", { d: "M13.2 7.3 14.8 3", stroke: "#d3dae3", "stroke-width": 1.6, "stroke-linecap": "round", fill: "none" }],
      ["circle", { cx: 17.8, cy: 19.5, r: 1.4, fill: "#8c97a8" }],
    ],
    trophy: [
      ["path", { d: "M7 4h10v5a5 5 0 0 1-10 0z", fill: "#d4a017" }],
      ["path", { d: "M7 5H4c0 3 1.3 4.6 3 4.8M17 5h3c0 3-1.3 4.6-3 4.8", fill: "none", stroke: "#d4a017", "stroke-width": 1.6 }],
      ["path", { d: "M12 14v4M8.5 20h7", fill: "none", stroke: "#d4a017", "stroke-width": 2, "stroke-linecap": "round" }],
    ],
  };

  function make(kind) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "vop-icon");
    svg.dataset.icon = kind;
    for (const [tag, attrs] of SHAPES[kind] || []) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    return svg;
  }

  window.VOPIcons = { make, kinds: Object.keys(SHAPES) };
})();

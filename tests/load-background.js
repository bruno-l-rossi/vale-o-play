// Carrega o background.js num contexto isolado (vm) com chrome e fetch falsos,
// pra testar o pipeline sem navegador e sem rede.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadBackground({ routes = {}, onFetch } = {}) {
  const store = {};
  const listeners = [];
  const calls = [];
  const chrome = {
    storage: {
      local: {
        async get(k) {
          if (k === null) return { ...store };
          return k in store ? { [k]: store[k] } : {};
        },
        async set(obj) { Object.assign(store, obj); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
        async clear() { for (const k of Object.keys(store)) delete store[k]; },
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listeners.push(fn); } },
    },
  };
  async function fetch(url) {
    calls.push(url);
    if (onFetch) onFetch(url);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const r = typeof handler === "function" ? handler(url) : handler;
        if (r instanceof Error) throw r;
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => r.json,
          text: async () => r.text ?? "",
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
  const ctx = vm.createContext({
    chrome, fetch, console, setTimeout, clearTimeout, URLSearchParams, AbortController, Promise, Date,
  });
  const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  vm.runInContext(src, ctx, { filename: "background.js" });
  const send = (msg) =>
    new Promise((resolve) => {
      const keep = listeners[0](msg, {}, resolve);
      if (!keep) resolve(undefined);
    });
  return { ctx, store, calls, send, run: (code) => vm.runInContext(code, ctx) };
}

module.exports = { loadBackground };

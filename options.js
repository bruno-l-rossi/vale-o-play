const input = document.getElementById("key");
const status = document.getElementById("status");

chrome.storage.sync.get("tmdbApiKey", ({ tmdbApiKey }) => {
  if (tmdbApiKey) input.value = tmdbApiKey;
});

document.getElementById("save").addEventListener("click", async () => {
  const key = input.value.trim();
  await chrome.storage.sync.set({ tmdbApiKey: key });

  // testa a chave na hora
  if (key) {
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`
      );
      status.textContent = res.ok
        ? "Salvo. Chave válida ✓"
        : "Salvo, mas a chave foi rejeitada pelo TMDB. Confere se copiou a API Key v3.";
      status.style.color = res.ok ? "#2e7d32" : "#c62828";
    } catch (e) {
      status.textContent = "Salvo, mas não consegui testar a chave agora.";
      status.style.color = "#e65100";
    }
  } else {
    status.textContent = "Salvo (sem chave: busca direta em português).";
    status.style.color = "#e65100";
  }
});

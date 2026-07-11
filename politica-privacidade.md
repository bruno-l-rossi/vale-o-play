# Política de privacidade: Vale o Play?

Última atualização: 11 de julho de 2026

## O que a extensão coleta

Nada. A extensão não coleta, não armazena e não transmite nenhum dado pessoal. Não há cadastro, login, analytics, cookies próprios ou qualquer identificador de usuário.

## O que a extensão envia pra fora

Pra buscar as notas, a extensão envia somente o nome dos títulos visíveis na sua tela da Netflix pra 3 serviços:

1. **TMDB** (api.themoviedb.org): casa o título em português com a obra certa e devolve o IMDb id dela.
2. **OMDb** (omdbapi.com): recebe o IMDb id do título e retorna o link da página do RT e a nota do IMDb.
3. **Rotten Tomatoes** (rottentomatoes.com): a extensão abre a página do título no RT pra ler as notas de críticos e audiência. Só a URL do título é acessada, nenhum dado seu.

Nenhuma dessas requisições carrega informação sobre você: sem nome de usuário, sem e-mail, sem histórico, sem identificadores. Só o nome do título (pro TMDB) ou o IMDb id dele (pro OMDb e pro RT).

## Armazenamento local

As notas ficam guardadas por até 7 dias no armazenamento local do seu navegador (chrome.storage), só pra evitar buscas repetidas. As preferências de exibição (tamanho e posição do badge, filtro de qualidade) ficam no chrome.storage.sync, que o Chrome sincroniza entre os seus próprios dispositivos. Nada disso passa por servidores da extensão (que, aliás, não existem) e tudo é apagado quando você remove a extensão.

## Contato

Dúvidas: abra uma issue em [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play) ou escreva pra rideblan33@gmail.com.

---

# Privacy policy: Vale o Play? (English)

Last updated: July 11, 2026

This extension collects no personal data. There is no sign-up, no analytics, no cookies, no user identifiers.

To fetch ratings, the extension sends only the names of the titles visible on your Netflix screen to 3 services: TMDB (api.themoviedb.org), to match the localized title with the right work and get its IMDb id; OMDb (omdbapi.com), which receives the IMDb id and returns the Rotten Tomatoes page link and the IMDb rating; and Rotten Tomatoes (rottentomatoes.com), whose title page the extension fetches to read critic and audience scores. These requests carry no information about you.

Ratings are cached locally in your browser (chrome.storage) for up to 7 days to avoid repeated lookups. Display preferences (badge size and position, quality filter) are kept in chrome.storage.sync, which Chrome syncs across your own devices. None of this passes through any extension server (there is none), and everything is deleted when you remove the extension.

Questions: open an issue at github.com/bruno-l-rossi/vale-o-play or email rideblan33@gmail.com.

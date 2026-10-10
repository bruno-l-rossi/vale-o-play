# Política de privacidade: Vale o Play?

Última atualização: 10 de outubro de 2026

## O que a extensão coleta

Nada. A extensão não coleta, não armazena e não transmite nenhum dado pessoal. Não há cadastro, login, analytics, cookies próprios ou qualquer identificador de usuário.

## Onde ela roda

Só nas páginas da Netflix (netflix.com) e da Disney+ (disneyplus.com). Nelas, a extensão lê apenas o nome dos títulos que aparecem na tela (e, na página de detalhe, o ano e se é filme ou série) pra mostrar as notas. Nada mais da página é lido ou enviado.

## O que a extensão envia pra fora

Pra buscar as notas, a extensão envia somente informações sobre os títulos visíveis na sua tela pra 3 serviços:

1. **TMDB** (api.themoviedb.org): recebe o nome do título (e, quando disponível, o ano e o tipo) pra casar com a obra certa, e devolve o nome em inglês e o IMDb id dela.
2. **Rotten Tomatoes** (rottentomatoes.com): a extensão faz uma busca pelo nome em inglês do título e abre a página dele pra ler as notas de críticos e audiência.
3. **OMDb** (omdbapi.com): só quando o Rotten Tomatoes não tem o título. Recebe o IMDb id e devolve a nota do IMDb.

Nenhuma dessas requisições carrega informação sobre você: sem nome de usuário, sem e-mail, sem histórico, sem identificadores, sem cookies.

## Armazenamento local

As notas ficam guardadas por até 7 dias no armazenamento local do seu navegador (chrome.storage), só pra evitar buscas repetidas. As preferências de exibição (em quais sites mostrar, tamanho e posição do badge, filtro de qualidade) ficam no chrome.storage.sync, que o Chrome sincroniza entre os seus próprios dispositivos. Nada disso passa por servidores da extensão (que, aliás, não existem) e tudo é apagado quando você remove a extensão. O botão "Limpar cache de notas" apaga as notas guardadas a qualquer momento.

## Contato

Dúvidas: abra uma issue em [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play) ou escreva pra rideblan33@gmail.com.

---

# Privacy policy: Vale o Play? (English)

Last updated: October 10, 2026

This extension collects no personal data. There is no sign-up, no analytics, no cookies, no user identifiers.

It runs only on Netflix (netflix.com) and Disney+ (disneyplus.com) pages, where it reads only the names of the titles shown on screen (and, on a title's detail page, its year and whether it is a movie or a series) to display ratings.

To fetch ratings, the extension sends only information about the titles visible on your screen to 3 services: TMDB (api.themoviedb.org), to match the title with the right work and get its English name and IMDb id; Rotten Tomatoes (rottentomatoes.com), whose search and title pages the extension reads to get critic and audience scores; and OMDb (omdbapi.com), only when Rotten Tomatoes has no entry, which receives the IMDb id and returns the IMDb rating. These requests carry no information about you.

Ratings are cached locally in your browser (chrome.storage) for up to 7 days to avoid repeated lookups. Display preferences (enabled sites, badge size and position, quality filter) are kept in chrome.storage.sync, which Chrome syncs across your own devices. None of this passes through any extension server (there is none), and everything is deleted when you remove the extension.

Questions: open an issue at github.com/bruno-l-rossi/vale-o-play or email rideblan33@gmail.com.

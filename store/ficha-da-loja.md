# Ficha da Chrome Web Store: Vale o Play?

Tudo que o Developer Dashboard pede, pronto pra copiar e colar. Os campos do formulário do Google estão em inglês; os textos da vitrine ficam em português porque o público é brasileiro.

## Aba "Store listing"

**Title**: Vale o Play?

**Summary** (máx. 132 caracteres, este tem 113):

> Notas do Rotten Tomatoes direto nos cards da Netflix e da Disney+. Veja críticos e audiência antes de dar o play.

**Description**:

> Cansado de dar play e se arrepender 20 minutos depois? O Vale o Play? mostra as notas do Rotten Tomatoes direto nos cards da Netflix e da Disney+, sem passar o mouse e sem abrir outra aba.
>
> Cada título ganha um badge no canto da capa: 🍅 nota dos críticos e 🍿 nota da audiência. Abaixo de 60%, os ícones viram 🟢 e 🥤, o padrão "podre" do Rotten Tomatoes. Clicou no badge? Abre a página do título no RT pra ler as críticas.
>
> Funciona com o catálogo em português: a extensão identifica a obra certa antes de buscar a nota, então "O Poderoso Chefão" encontra "The Godfather" e "Round 6" encontra "Squid Game", certinho.
>
> Título sem registro no Rotten Tomatoes mostra a nota do IMDb (⭐) ou, em último caso, a dos usuários do TMDB (★), sempre com o rótulo da fonte. As notas aparecem na home, na busca, nas páginas de gênero, no preview e no detalhe dos títulos. E os aclamados (críticos e audiência acima de 90%, ou IMDb acima de 9,0) ganham 🏆 e borda dourada.
>
> Zero cadastro: instalou, abriu a Netflix ou a Disney+, funcionou. No menu da extensão dá pra escolher em quais sites mostrar, o tamanho das notas (pequeno, médio ou grande), o canto da capa onde elas ficam e ligar o filtro de qualidade, que esmaece as capas com nota abaixo do corte que você definir. A extensão também dispensa qualquer dado seu (veja a política de privacidade).
>
> Extensão independente, sem vínculo com Netflix, Disney+, Rotten Tomatoes, IMDb ou TMDB.

**Category**: Entertainment

**Language**: Português (Brasil)

**Graphic assets** (nesta pasta):

| Campo | Arquivo |
|---|---|
| Store icon 128x128 | `../icons/icon128.png` |
| Screenshots 1280x800 | `screenshot-1.png`, `screenshot-2.png` (da v2; vale tirar novas na Netflix e na Disney+ com a v3 instalada) |
| Small promo tile 440x280 | `promo-tile-440x280.png` |

## Aba "Privacy"

**Single purpose description**:

> Display Rotten Tomatoes critic and audience scores on Netflix and Disney+ title cards, so users can evaluate titles before watching.

**Permission justifications**:

- `storage`:
  > Caches fetched ratings locally for up to 7 days to avoid repeated requests to external services, and stores the user's display preferences (enabled sites, badge size and position, quality filter). No personal data is stored.
- Host permission `https://www.rottentomatoes.com/*`:
  > Searches Rotten Tomatoes by the title's English name and reads the title page to get critic and audience scores for the titles visible on the user's Netflix or Disney+ page. Only title names are sent.
- Host permission `https://api.themoviedb.org/*`:
  > Matches localized (Brazilian Portuguese) Netflix and Disney+ titles with the correct work and retrieves its English name, year and IMDb id. Only title names are sent.
- Host permission `https://*.algolia.net/*`:
  > Queries Rotten Tomatoes' own public search index (hosted by Algolia, the same search box rottentomatoes.com uses) by the title's English name to find its Rotten Tomatoes page and scores. Only title names are sent.
- Host permission `https://query.wikidata.org/*`:
  > Looks up the title's IMDb id in Wikidata (the open database behind Wikipedia) to get the exact address of its Rotten Tomatoes page. Only title IDs are sent.
- Host permission `https://www.omdbapi.com/*`:
  > Fallback only: given the IMDb id, returns the title's IMDb rating when Rotten Tomatoes has no entry. Only title IDs are sent.
- Content script on `https://www.netflix.com/*` and `https://www.disneyplus.com/*`:
  > Reads title names from the cards and title pages and injects the rating badges. Nothing else on the page is read or modified.

**Are you using remote code?**: No. (Todo o código vem no pacote; as requisições externas só trazem dados JSON e HTML lido como texto, nunca código executado.)

**Data usage**: marcar que a extensão NÃO coleta nenhum dos tipos de dados listados (não coleta informação pessoal, saúde, financeira, autenticação, comunicação, localização, histórico, atividade ou conteúdo do usuário).

**Privacy policy URL**:

> https://github.com/bruno-l-rossi/vale-o-play/blob/main/politica-privacidade.md

## Aba "Distribution"

- **Visibility**: Public (ou Unlisted, se quiser distribuir só pelo link no começo).
- **Distribution**: todos os países (sem motivo pra restringir).

## Checklist antes de enviar

1. Rodar `git push` com a versão 3.1.0 (o politica-privacidade.md atualizado precisa estar público no GitHub antes da revisão).
2. Subir o `vale-o-play-store.zip` (sem `.git`, sem `store/`, sem `tests/`) na aba Package.
3. Preencher as 3 abas com os textos acima.
4. Submit for review. Resposta costuma chegar por e-mail em poucos dias; rejeição vem com motivo e aceita reenvio.

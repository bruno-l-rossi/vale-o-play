# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto da capa. Quando o Rotten Tomatoes tem o título, aparece o 🍅 dos críticos (ou 🟢 abaixo de 60%, o padrão "podre"). Quando não tem, o badge mostra ⭐ com a nota do IMDb (de 0 a 10). Clicar no badge abre a página do título.

Instalou, abriu a Netflix, funcionou. Zero configuração: as chaves de API já vêm embutidas no código.

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega.

## De onde vem a nota

A Netflix mostra os títulos em português. A extensão busca esse título no TMDB (The Movie Database), que casa o nome PT com a obra certa e devolve o IMDb id. O TMDB serve só pra isso, achar o título certo; a nota dele não é usada. Tipo e ano desempatam homônimos, tipo o filme e a série "Wednesday".

Com o IMDb id em mãos, a extensão consulta o OMDb, que numa resposta só devolve a nota dos críticos do Rotten Tomatoes (quando existe) e a nota do IMDb. A 1ª fonte é o RT (🍅). Quando não tem RT, o que é comum em série, o badge mostra a nota do IMDb (⭐). O IMDb entra como reserva porque tem base de votos maior e mais reconhecida que a do TMDB.

As duas chaves de API (TMDB e OMDb) já vêm embutidas no código, então não tem nada pra configurar.

## Sobre o Rotten Tomatoes (histórico e nota pra quem mantém)

Até a v1, a extensão lia as duas notas do RT (críticos 🍅 e audiência 🍿) de um endpoint interno não oficial do site (`rottentomatoes.com/napi/search/all`). Esse endpoint saiu do ar e passou a responder 404, e a extensão parou de mostrar nota.

A v2 trocou a fonte pelo OMDb, uma API oficial e estável que repassa a nota dos críticos do RT. A nota da audiência (🍿) foi descontinuada: ela só existe no site do próprio RT, e nenhuma API gratuita a expõe.

A chave do OMDb embutida é do plano FREE (1000 requisições por dia). Se um dia ela estourar o limite ou for abusada, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx), ative pelo link do email e troque o valor de `const OMDB_KEY` no `background.js`.

## Como funciona por dentro

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card. O service worker (`background.js`) resolve o título no TMDB, busca RT e IMDb no OMDb (uma chamada só) e devolve o resultado pro card.

Tem 3 proteções contra excesso de requisição: cache de 7 dias por título (1 dia quando não acha nota), máximo de 4 requisições simultâneas com pausa de 80ms entre elas, e deduplicação de pedidos repetidos.

## Limitações

- A nota dos críticos do RT depende do OMDb, que cobre bem filme mas tem cobertura fraca de série. Série da Netflix costuma mostrar a nota do IMDb.
- Título com poucos votos no IMDb (menos de 500) fica sem badge, pra não mostrar nota de obra obscura.
- O match acerta a grande maioria, mas garantia de 100% não existe: depende do título estar no TMDB e ter um IMDb id ligado.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. Enviar um `.crx` avulso por fora da Web Store não funciona: o Chrome bloqueia.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards e injeta os badges |
| `background.js` | Resolve no TMDB, busca a nota do RT no OMDb, cache e fila de requisições |
| `styles.css` | Visual do badge |

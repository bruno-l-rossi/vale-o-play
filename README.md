# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto da capa. Com a nota do Rotten Tomatoes ligada, aparece 🍅 (críticos, padrão "fresh") ou 🟢 abaixo de 60% (padrão "podre"). Sem RT, o badge mostra ⭐ com a nota do público no TMDB (de 0 a 10). Clicar no badge abre a página do título.

Instalou, abriu a Netflix, funcionou. Zero configuração pra ver a nota do TMDB; um passo extra de 1 minuto pra ligar a nota do RT (veja abaixo).

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega.

## De onde vem a nota

A Netflix mostra os títulos em português. A extensão busca esse título no TMDB (The Movie Database), que casa o nome PT com a obra certa e devolve o tipo (filme ou série), o ano, o IMDb id e a nota do público. Ano e tipo desempatam homônimos, tipo o filme e a série "Wednesday".

Com a nota do RT ligada, a extensão usa o IMDb id pra consultar o OMDb e pegar a nota dos críticos do Rotten Tomatoes. Sem RT (ou quando o OMDb não tem o título), o badge mostra a nota do público no TMDB.

A chave da API do TMDB já vem embutida no código.

## Ligar a nota do Rotten Tomatoes (opcional)

A nota da audiência do RT (🍿) saiu de cena: o endpoint interno que entregava ela morreu, e nenhuma API gratuita expõe a nota da audiência. A nota dos críticos (🍅) continua disponível pelo OMDb, que é oficial e estável.

1. Pegue uma chave grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (plano FREE, chega por email em 1 minuto).
2. Abra `background.js` e cole a chave em `const OMDB_KEY = ""`.
3. Recarregue a extensão em `chrome://extensions`.

Sem chave, a extensão funciona normal mostrando a nota do TMDB.

## Como funciona por dentro

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card. O service worker (`background.js`) resolve o título no TMDB, pega a nota do RT no OMDb (se houver chave) e devolve o resultado.

Tem 3 proteções contra excesso de requisição: cache de 7 dias por título (1 dia quando não acha nota), máximo de 2 requisições simultâneas com pausa de 300ms entre elas, e deduplicação de pedidos repetidos.

## Limitações

- A nota dos críticos do RT depende do OMDb, que cobre bem filme mas tem cobertura fraca de série. Série da Netflix costuma cair pra nota do TMDB.
- Título com poucos votos no TMDB (menos de 50) fica sem badge, pra não mostrar nota fake de 1 voto.
- O match acerta a grande maioria, mas garantia de 100% não existe: depende do título estar registrado no TMDB.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. Enviar um `.crx` avulso por fora da Web Store não funciona: o Chrome bloqueia.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards e injeta os badges |
| `background.js` | Resolve no TMDB, busca a nota do RT no OMDb, cache e fila de requisições |
| `styles.css` | Visual do badge |

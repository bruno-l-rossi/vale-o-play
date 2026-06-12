# Vale o Play?

Extensão de Chrome que mostra as notas do Rotten Tomatoes direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto da capa: 🍅 nota dos críticos e 🍿 nota da audiência. Abaixo de 60%, os ícones viram 🟢 e 🥤 (o padrão "podre" do RT). Clicar no badge abre a página do título no RT.

Instalou, abriu a Netflix, funcionou. Zero configuração.

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega.

## Como o título em português vira inglês

A Netflix mostra os títulos em português e o Rotten Tomatoes indexa em inglês. A extensão resolve isso com o TMDB (The Movie Database): busca o título PT lá, recebe o nome em inglês, o ano e o tipo (filme ou série), e só então consulta o RT. Ano e tipo desempatam obras homônimas, tipo o filme e a série "Wednesday".

A chave da API do TMDB já vem embutida no código.

## Como funciona por dentro

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card. O service worker (`background.js`) traduz o nome via TMDB e busca no endpoint interno do RT, devolvendo as notas.

Pra não martelar o site do RT, tem 3 proteções: cache de 7 dias por título (1 dia quando o título não é encontrado), máximo de 2 requisições simultâneas com pausa de 300ms entre elas, e deduplicação de pedidos repetidos.

## Limitações

- O endpoint do RT não é oficial. Se o site mudar, a extensão para de mostrar notas até o parser ser ajustado (o `extractCandidates` em `background.js` é o lugar pra mexer).
- Título que não está no catálogo do RT (muita produção brasileira e originais Netflix menores) fica sem badge, de propósito.
- O match acerta a grande maioria dos casos, mas garantia de 100% não existe: depende do título estar registrado no TMDB e no RT.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. Enviar um `.crx` avulso por fora da Web Store não funciona: o Chrome bloqueia.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards e injeta os badges |
| `background.js` | Ponte TMDB, busca no RT, cache e fila de requisições |
| `styles.css` | Visual do badge |

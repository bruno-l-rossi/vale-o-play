# Vale o Play?

Extensão de Chrome que mostra as notas do Rotten Tomatoes direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto da capa: 🍅 nota dos críticos e 🍿 nota da audiência. Abaixo de 60%, os ícones viram 🟢 e 🥤 (o padrão "podre" do RT). Clicar no badge abre a página do título no RT.

## Instalação

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em "Carregar sem compactação" e selecione esta pasta (`netflix-rotten-tomatoes`).
4. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega. Nenhuma configuração é necessária.

## Como o título em português vira inglês

A Netflix mostra os títulos em português e o Rotten Tomatoes indexa em inglês. A extensão resolve isso com o TMDB (The Movie Database): busca o título PT lá, recebe o nome em inglês, o ano e o tipo (filme ou série), e só então consulta o RT. Ano e tipo desempatam casos de obras homônimas.

A chave da API do TMDB já vem embutida no código. Não há nada pra configurar.

## Como funciona

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card. O service worker (`background.js`) traduz o nome via TMDB e busca no endpoint interno do RT, devolvendo as notas.

Pra não martelar o site do RT, tem 3 proteções: cache de 7 dias por título (1 dia quando o título não é encontrado), máximo de 2 requisições simultâneas com pausa de 300ms entre elas, e deduplicação de pedidos repetidos.

## Levar pra outro computador

Opção rápida: copie o arquivo `netflix-rotten-tomatoes.zip` (está na pasta junto deste projeto) pro outro computador, descompacte e carregue via "Carregar sem compactação", igual à instalação acima.

Pra disponibilizar online:

1. **GitHub**: suba a pasta num repositório público. Qualquer pessoa baixa pelo botão Code → Download ZIP e instala do mesmo jeito. Grátis e imediato.
2. **Chrome Web Store**: instalação de 1 clique, sem modo desenvolvedor. Exige conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado": só instala quem tem o link.

Enviar só o `.crx` por fora da Web Store não funciona: o Chrome bloqueia a instalação de extensões avulsas.

## Limitações

- O endpoint do RT não é oficial. Se o site mudar, a extensão para de mostrar notas até o parser ser ajustado (o `extractCandidates` em `background.js` é o lugar pra mexer).
- Com a chave do TMDB o match acerta a grande maioria dos casos, mas 100% absoluto não existe: título que não está no catálogo do RT (muita produção brasileira e originais Netflix menores) fica sem badge, de propósito.
- Sem a chave do TMDB, a busca usa o nome em português direto no RT e falha em boa parte dos títulos.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards e injeta os badges |
| `background.js` | Ponte TMDB, busca no RT, cache e fila de requisições |
| `styles.css` | Visual do badge |

# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto superior direito da capa, com as duas notas do Rotten Tomatoes: 🍅 críticos (Tomatometer) e 🍿 audiência (Popcornmeter). Abaixo de 60% os ícones viram 🟢 e 🥤 (o padrão "podre"). Quando o RT não tem o título, o badge mostra ⭐ com a nota do IMDb (de 0 a 10). Clicar no badge abre a página do título.

Instalou, abriu a Netflix, funcionou. Zero configuração: as chaves de API já vêm embutidas no código.

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega.

## De onde vem a nota

A Netflix mostra os títulos em português. A extensão busca esse título no TMDB (The Movie Database), que casa o nome PT com a obra certa e devolve o IMDb id. O TMDB serve só pra isso, achar o título certo; a nota dele não é usada. Tipo e ano desempatam homônimos, tipo o filme e a série "Wednesday".

Com o IMDb id, a extensão consulta o OMDb pra pegar o link da página do RT (no caso de filme) e a nota do IMDb de reserva. Aí ela abre a página do RT e raspa os dois números: críticos e audiência. Pra série, que o OMDb não cobre, a URL do RT é adivinhada a partir do nome em inglês. Quando o RT não responde, o badge mostra a nota do IMDb (⭐), que entra como rede de segurança por ter base de votos maior e mais reconhecida que a do TMDB.

As duas chaves de API (TMDB e OMDb) já vêm embutidas no código, então não tem nada pra configurar.

## Sobre o Rotten Tomatoes (histórico e nota pra quem mantém)

Até a v1, a extensão lia as duas notas do RT (críticos 🍅 e audiência 🍿) de um endpoint interno não oficial do site (`rottentomatoes.com/napi/search/all`). Esse endpoint saiu do ar e passou a responder 404, e a extensão parou de mostrar nota.

A v2.2 raspa a página do RT direto, o que traz de volta a nota da audiência (🍿), que nenhuma API gratuita expõe. Como o OMDb não dá nota nem link de RT pra série, a URL da série é adivinhada pelo nome em inglês, então parte das séries não casa e cai pro IMDb.

Essa raspagem é a parte frágil. Se o RT mudar o HTML do site, o parser para de achar os números; o lugar pra ajustar é o `parseRtScores` no `background.js` (os nomes de slot `criticsScore`/`audienceScore`). Enquanto isso o IMDb segura como reserva. Vale lembrar também que raspar a página inteira por título é mais pesado e pode levar a bloqueio do RT em uso intenso.

A chave do OMDb embutida é do plano FREE (1000 requisições por dia). Se estourar o limite, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx), ative pelo link do email e troque o valor de `const OMDB_KEY` no `background.js`.

## Como funciona por dentro

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card. O service worker (`background.js`) resolve o título no TMDB, pega link do RT e nota do IMDb no OMDb, raspa a página do RT e devolve o resultado pro card.

Tem 3 proteções contra excesso de requisição: cache de 7 dias por título (1 dia quando não acha nota), máximo de 4 requisições simultâneas com pausa de 80ms entre elas, e deduplicação de pedidos repetidos.

## Limitações

- Filme casa direto com a página do RT (o OMDb dá o link). Série depende de adivinhar a URL do RT pelo nome, então parte das séries não acha e cai pro IMDb.
- A audiência (🍿) e a nota de série só existem raspando o RT, que pode quebrar quando o site muda ou bloquear em uso intenso. O IMDb segura como reserva.
- Título com poucos votos no IMDb (menos de 500) fica sem badge, pra não mostrar nota de obra obscura.
- O match acerta a grande maioria, mas garantia de 100% não existe: depende do título estar no TMDB e ter um IMDb id ligado.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. Enviar um `.crx` avulso por fora da Web Store não funciona: o Chrome bloqueia.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards e injeta os badges |
| `background.js` | Resolve no TMDB, pega link/IMDb no OMDb, raspa a página do RT, cache e fila |
| `styles.css` | Visual do badge |

# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da Netflix, sem precisar passar o mouse. Cada título ganha um badge no canto da capa, com as duas notas do Rotten Tomatoes: 🍅 críticos (Tomatometer) e 🍿 audiência (Popcornmeter). Abaixo de 60% os ícones viram 🟢 e 🥤 (o padrão "podre"). Quando o RT não tem o título, o badge mostra ⭐ com a nota do IMDb (de 0 a 10) e, em último caso, ★ com a nota de usuários do TMDB, sempre com o rótulo da fonte. Clicar no badge abre a página do título.

Título aclamado ganha destaque: 🏆 e borda dourada quando críticos e audiência passam de 90% no RT, ou quando a nota do IMDb passa de 9,0.

Os badges aparecem na home, nas páginas de gênero e subgênero, nos resultados de busca e no modal de preview (aquele que abre no hover ou no clique do card). Na visão de detalhe, as notas também aparecem em tamanho grande logo acima da sinopse.

Instalou, abriu a Netflix, funcionou: as chaves de API já vêm embutidas. Toda configuração é opcional, no menu da extensão: tamanho das notas (pequeno, médio ou grande), canto da capa, filtro de qualidade (esmaece as capas com nota abaixo do corte que você escolher; o hover devolve as cores) e um botão pra limpar o cache de notas.

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix. Os badges aparecem alguns segundos depois que a página carrega.

## De onde vem a nota

A Netflix mostra os títulos em português. A extensão busca esse título no TMDB (The Movie Database), que casa o nome PT com a obra certa e devolve o IMDb id. O match aceita nome exato tanto no título localizado quanto no original, o que segura homônimos e remakes.

Com o IMDb id, a extensão consulta o OMDb pra pegar o link da página do RT (no caso de filme) e a nota do IMDb de reserva. Aí ela abre a página do RT e raspa os dois números: críticos e audiência. Pra série, que o OMDb não cobre, a URL do RT é adivinhada a partir do nome em inglês. Quando o RT não responde, o badge mostra a nota do IMDb (⭐), que entra como rede de segurança por ter base de votos maior e mais reconhecida. E quando nem o IMDb tem nota (ou o título tem menos de 500 votos lá), entra o último recurso: a nota de usuários do TMDB (★), exigindo pelo menos 20 votos.

As duas chaves de API (TMDB e OMDb) já vêm embutidas no código, então não tem nada pra configurar.

## Sobre o Rotten Tomatoes (histórico e nota pra quem mantém)

Até a v1, a extensão lia as duas notas do RT de um endpoint interno não oficial do site (`rottentomatoes.com/napi/search/all`). Esse endpoint saiu do ar e passou a responder 404, e a extensão parou de mostrar nota.

Desde a v2.2 a extensão raspa a página do RT direto, o que traz de volta a nota da audiência (🍿), que nenhuma API gratuita expõe. Como o OMDb não dá nota nem link de RT pra série, a URL da série é adivinhada pelo nome em inglês, então parte das séries não casa e cai pro IMDb.

Essa raspagem é a parte frágil. Se o RT mudar o HTML do site, o parser para de achar os números; o lugar pra ajustar é o `parseRtScores` no `background.js` (os nomes de slot `criticsScore`/`audienceScore`). Enquanto isso o IMDb segura como reserva. Vale lembrar também que raspar a página inteira por título é mais pesado e pode levar a bloqueio do RT em uso intenso.

A chave do OMDb embutida é do plano FREE (1000 requisições por dia). Se estourar o limite, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx), ative pelo link do email e troque o valor de `const OMDB_KEY` no `background.js`.

## Como funciona por dentro

O content script (`content.js`) observa a página da Netflix e lê o nome de cada card, incluindo os da busca e o modal de preview; na visão de detalhe, injeta a linha de notas antes da sinopse. O service worker (`background.js`) resolve o título no TMDB, pega link do RT e nota do IMDb no OMDb, raspa a página do RT e devolve o resultado com a fonte.

O popup (`popup.html` + `popup.js`) grava as preferências (tamanho, posição, filtro de qualidade) em `chrome.storage.sync`; o content script escuta as mudanças e aplica na hora, sem recarregar a página. O filtro compara o corte com a nota de críticos (ou audiência na falta dela; IMDb e TMDB viram %, tipo 7,4 → 74). O botão de limpar cache apaga só o cache de notas, as preferências ficam. Quando a lógica de nota muda entre versões, o `CACHE_VERSION` no `background.js` é incrementado pra descartar o cache antigo sozinho.

Tem 3 proteções contra excesso de requisição: cache de 7 dias por título (1 dia quando não acha nota), máximo de 4 requisições simultâneas com pausa de 80ms entre elas, e deduplicação de pedidos repetidos.

## Limitações

- Filme casa direto com a página do RT (o OMDb dá o link). Série depende de adivinhar a URL do RT pelo nome, então parte das séries não acha e cai pro IMDb.
- A audiência (🍿) e a nota de série só existem raspando o RT, que pode quebrar quando o site muda ou bloquear em uso intenso. O IMDb segura como reserva, e o TMDB como último recurso.
- Título com poucos votos (menos de 500 no IMDb e menos de 20 no TMDB) fica sem badge, pra não mostrar nota de obra obscura.
- O match acerta a grande maioria, mas garantia de 100% não existe: depende do título estar no TMDB e ter um IMDb id ligado.
- O DOM da Netflix muda de tempos em tempos. Se os badges sumirem de alguma área, os seletores em `findCards` e `processPreviewModals` (`content.js`) são o lugar pra ajustar; o console mostra avisos `[Vale o Play?]` de diagnóstico.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. Enviar um `.crx` avulso por fora da Web Store não funciona: o Chrome bloqueia.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix: acha os cards (home, busca, preview), injeta badges, filtro e linha da sinopse |
| `background.js` | Resolve no TMDB, pega link/IMDb no OMDb, raspa a página do RT, cache e fila |
| `popup.html` / `popup.js` | Menu da extensão: tamanho, posição, filtro de qualidade e limpar cache |
| `styles.css` | Visual do badge, do filtro de esmaecer e da linha de notas na sinopse |

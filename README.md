# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da **Netflix** e da **Disney+**, sem precisar passar o mouse. Cada título ganha um badge no canto da capa, com as duas notas do Rotten Tomatoes: 🍅 críticos (Tomatometer) e 🍿 audiência (Popcornmeter). Abaixo de 60% os ícones viram 🟢 e 🥤 (o padrão "podre"). Quando o RT não tem o título, o badge mostra ⭐ com a nota do IMDb (de 0 a 10) e, em último caso, ★ com a nota de usuários do TMDB, sempre com o rótulo da fonte. Clicar no badge abre a página do título na fonte; passar o mouse mostra qual obra foi encontrada (ex.: "Rotten Tomatoes · The Godfather (1972)").

Título aclamado ganha destaque: 🏆 e borda dourada quando críticos e audiência passam de 90% no RT, ou quando a nota do IMDb passa de 9,0.

Onde aparece:

- **Netflix**: home, gêneros, busca, Minha lista, Top 10, Continuar assistindo, no preview do hover e no detalhe do título (as notas em tamanho grande logo acima da sinopse).
- **Disney+**: fileiras da home e das coleções, busca, "Você também pode gostar" e a página de detalhe do título (as notas logo abaixo do ano e das temporadas).

Instalou, abriu a Netflix ou a Disney+, funcionou: as chaves de API já vêm embutidas. Toda configuração é opcional, no menu da extensão: em quais sites mostrar, tamanho das notas (pequeno, médio ou grande), canto da capa, filtro de qualidade (esmaece as capas com nota abaixo do corte que você escolher; o hover devolve as cores) e um botão pra limpar o cache de notas (as abas abertas se atualizam sozinhas).

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte. (Ou use o `vale-o-play.zip` desta pasta.)
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix ou a Disney+. Os badges aparecem um ou dois segundos depois que a página carrega.

Atualizando de uma versão antiga: em `chrome://extensions`, clique no ícone de recarregar (↻) do card do Vale o Play? e recarregue a aba da Netflix. O cache antigo é descartado sozinho.

## De onde vem a nota

1. **TMDB (The Movie Database)** casa o nome que o streaming mostra (em português) com a obra certa. Cada candidato ganha pontos por nome exato (no título em português, no original ou no inglês), ano e tipo quando a página informa, e número de votos. Só passa quem tem confiança alta, então "Marvel" não vira "Ms. Marvel" e um homônimo obscuro não rouba o lugar da série famosa.
2. Na mesma ida ao TMDB vêm o nome em inglês, o ano e o IMDb id da obra.
3. **Rotten Tomatoes**: a extensão usa a busca do próprio RT pelo nome em inglês, escolhe o resultado do mesmo tipo (filme ou série) e do mesmo ano, e lê a página do título. As duas notas saem do JSON do placar que o RT usa pra desenhar a página. Funciona pra filme e pra série. Se a busca não achar, tenta a URL pelo nome, mas só aceita se o ano da página bater.
4. **Reserva**: quando o RT não tem o título, o **OMDb** devolve o Tomatometer (se tiver) e a nota do IMDb (⭐), exigindo pelo menos 500 votos.
5. **Último recurso**: a nota de usuários do TMDB (★), exigindo pelo menos 20 votos.

O OMDb só entra no passo 4, o que poupa a cota diária da chave grátis.

## Como funciona por dentro

O content script (`content.js`) tem um adaptador por site. A Netflix e a Disney+ trocam nomes de classe CSS com frequência (foi isso que derrubou a v2.3 e outras extensões do tipo em 2026), então a detecção se apoia no que elas não conseguem mudar sem quebrar o próprio site: os links de navegação (`/browse?jbv=ID`, `/watch/ID`, `/title/ID` na Netflix; `/browse/entity-ID` na Disney+), os atributos de teste (`data-uia`, `data-testid`) e os rótulos de acessibilidade (`aria-label`).

Performance:

- Só pede nota do que está na tela ou perto dela (IntersectionObserver). Rolar a página puxa o resto.
- Observa o DOM com debounce (250ms, no máximo 1s de espera) e ignora as próprias mudanças. No player (`/watch`, `/play`) a varredura fica parada.
- Card reciclado pela Netflix (mesmo elemento, outro título) é detectado e o badge é refeito.
- O service worker (`background.js`) resolve até 4 títulos em paralelo, dá prioridade ao detalhe que você abriu, deduplica pedidos repetidos e guarda cache de 7 dias por título (1 dia quando não acha nota; 15 minutos quando a falha foi de rede, pra tentar de novo logo).

O popup (`popup.html` + `popup.js`) grava as preferências em `chrome.storage.sync`; o content script escuta as mudanças e aplica na hora, sem recarregar a página. O filtro compara o corte com a nota de críticos (ou audiência na falta dela; IMDb e TMDB viram %, tipo 7,4 → 74). Quando a lógica de nota muda entre versões, o `CACHE_VERSION` no `background.js` é incrementado e o cache antigo é apagado sozinho.

## Diagnóstico (se um dia os badges sumirem)

Na aba da Netflix ou da Disney+, abra o console (Cmd+Option+J) e rode:

```js
localStorage.setItem("valeoplay:debug", "1")
```

Recarregue a página. O console passa a mostrar `[Vale o Play?] N cards detectados`. Se aparecer 0 cards, o site mudou a estrutura: o lugar pra ajustar é o objeto `NETFLIX` ou `DISNEY` no `content.js` (seletores `cardSelector`, `exclude` e a função `details`). Se os cards aparecem mas sem nota, o problema está nas fontes: `parseRtSearch` e `parseRtScores` no `background.js` leem o HTML do RT.

Pra desligar: `localStorage.removeItem("valeoplay:debug")`.

## Testes

A pasta `tests/` tem testes automáticos dos dois scripts, com o HTML no formato real da Netflix, da Disney+ e do RT (capturado em outubro de 2026). Precisa de Node 18 ou mais novo:

```bash
cd tests
npm install
npm test
```

## Limitações

- O Rotten Tomatoes não tem API pública: a extensão lê o HTML do site. Se o RT mudar o layout, o IMDb segura como reserva até o ajuste. Raspar a página por título é mais pesado e pode levar a bloqueio do RT em uso muito intenso (o cache de 7 dias e a carga só do que está na tela seguram isso).
- Algumas séries não têm nota de críticos da série inteira no RT (ex.: Os Simpsons); aí o badge mostra só a audiência.
- Título sem cadastro em lugar nenhum, ou com poucos votos (menos de 500 no IMDb e 20 no TMDB), fica sem badge.
- O casamento acerta a grande maioria, mas não existe garantia de 100%: card sem ano (caso da Netflix) com dois filmes de mesmo nome fica com o mais votado. No detalhe do título, onde o ano aparece, o casamento usa o ano.
- A chave do OMDb embutida é do plano FREE (1000 requisições por dia). Se estourar, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) e troque `const OMDB_KEY` no `background.js`.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. O pacote pronto pra loja é o `vale-o-play-store.zip` (sem testes nem arquivos da loja); os textos estão em `store/ficha-da-loja.md`.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix e na Disney+: acha os cards e o detalhe, pendura badges, filtro e linha de notas |
| `background.js` | Casa no TMDB, busca e lê o RT, reserva no OMDb/TMDB, cache e fila |
| `popup.html` / `popup.js` | Menu da extensão: sites, tamanho, posição, filtro de qualidade e limpar cache |
| `styles.css` | Visual do badge, da linha de notas e do filtro de esmaecer |
| `tests/` | Testes automáticos (não vão no pacote da loja) |

## Histórico

- **3.0.0** (out/2026): a Netflix trocou a estrutura dos cards (agora `<a data-uia="standard-card" href="/browse?jbv=ID">`, sem `.title-card`) e a extensão parou de achar os títulos. Detecção reescrita sem depender de classe CSS; suporte à Disney+; busca no próprio RT (série deixa de depender de adivinhar URL); casamento no TMDB com pontuação e nome em inglês; OMDb só como reserva; carga só do que está na tela; card reciclado; cache que não guarda erro de rede por 1 dia; botão de limpar cache atualiza as abas; liga/desliga por site; testes automáticos.
- **2.3.0** (jul/2026): popup (tamanho, posição, filtro, limpar cache), troféu de aclamado, badges na busca e no preview, notas na sinopse.
- **2.2** a **1.0**: versões anteriores (RT via OMDb e raspagem da página, IMDb de reserva).

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

0. **Netflix, pelo código do título**: todo card da Netflix tem o código do título no link (`/browse?jbv=81040344`). O Wikidata, a base aberta da Wikipédia, liga esse código direto à página do RT (81040344 → `tv/squid_game`). É o caminho mais rápido e mais certeiro: não depende do nome, então não confunde homônimos nem remakes. Na medição, 7 em cada 10 títulos da Netflix foram resolvidos assim; os outros seguem pelo nome, nos passos abaixo.
1. **TMDB (The Movie Database)** casa o nome que o streaming mostra (em português) com a obra certa. Cada candidato ganha pontos por nome exato (no título em português, no original ou no inglês), ano e tipo quando a página informa, e número de votos. Só passa quem tem confiança alta, então "Marvel" não vira "Ms. Marvel" e um homônimo obscuro não rouba o lugar da série famosa.
2. **Homônimos** (o filme "Animal Kingdom" e a série "Animal Kingdom", ou "Doctor Who" de 2005 e o de 2024): quando dois candidatos empatam, a extensão pergunta ao TMDB qual deles está de fato no catálogo da Netflix ou da Disney+ no Brasil e fica com esse.
3. Na mesma ida ao TMDB vêm o nome em inglês, o ano, o IMDb id e os nomes alternativos usados nos EUA e no Reino Unido.
4. **Rotten Tomatoes**, por dois caminhos ao mesmo tempo:
   - **Wikidata**: a base aberta da Wikipédia guarda, pra cada filme e série, o endereço exato da página no RT. Pelo IMDb id a extensão pega esse endereço direto, sem adivinhar nada (Round 6 → `tv/squid_game`). Resolve cerca de 9 em cada 10 títulos.
   - **Índice de busca do RT**: a mesma busca do topo do site, que devolve nome, apelidos (inclusive em português), tipo, ano e as duas notas de uma vez. Entra quando o Wikidata não conhece o título e confirma o que ele achou.
   - Se faltou alguma nota, a extensão abre a página do título no RT, que é a palavra final.
5. **Série longa sem nota de críticos** (Simpsons, NCIS, Family Guy): o RT não calcula a nota da série inteira, só a de cada temporada. A extensão faz a média das temporadas que têm nota, o mesmo critério do "Avg. Tomatometer" que o RT mostra nas séries em que calcula (conferido em 8 séries: no máximo 1 ponto de diferença). Essa nota aparece com um asterisco (🍅 85%*), e passar o mouse mostra de quantas temporadas ela veio.
6. **Reserva**: só quando o RT não tem nota nenhuma do título, o **OMDb** devolve a nota do IMDb (⭐), exigindo pelo menos 500 votos.
7. **Último recurso**: a nota de usuários do TMDB (★), exigindo pelo menos 20 votos.

### Quanto acerta (medição de outubro de 2026)

458 títulos reais dos catálogos da Netflix e da Disney+ no Brasil, pelo nome em português que aparece no card (222 dos mais populares e 236 da parte menos popular do catálogo):

| | v3.0 | v3.1 | v3.2 |
|---|---|---|---|
| Nota do Rotten Tomatoes | 89,5% | 92,6% | **92,6%** |
| Rotten Tomatoes com críticos e audiência | 71,4% | 83,4% | **83,4%** |
| Caem no IMDb/TMDB/sem nota | 48 títulos | 34 títulos | **34 títulos** |
| Obra errada (homônimos) | 7 | 5 | **5** |

A v3.2 chega nas mesmas páginas do RT que a v3.1 (as 424 conferidas uma a uma), só que mais rápido e com menos pedidos. Mesmos 458 títulos, em páginas de 40 cards, sem cache:

| | v3.1 | v3.2 |
|---|---|---|
| Pedidos de rede | 2.297 | **1.400** (−39%) |
| Metade dos cards com nota em até | 5,4 s | **2,2 s** |
| 9 em cada 10 cards com nota em até | 11,2 s | **7,2 s** |

Os tempos absolutos são de um teste com o navegador em segundo plano, que segura o ritmo; no uso normal ficam menores. O que vale é a comparação. Na segunda visita, com cache, a nota aparece na hora.

Os 34 que ficam fora do RT foram conferidos um a um no próprio RT: ou o título não está lá (vários animes, novelas e realities), ou está sem nenhuma avaliação (lançamentos da semana, desenhos infantis). Os 5 casos de obra errada são remakes com o mesmo nome no mesmo serviço (A Bela e a Fera de 1991 e de 2017, ambos na Disney+): o card não mostra o ano, então não tem como saber qual é. No detalhe do título, onde o ano aparece, a extensão acerta.

## Como funciona por dentro

O content script (`content.js`) tem um adaptador por site. A Netflix e a Disney+ trocam nomes de classe CSS com frequência (foi isso que derrubou a v2.3 e outras extensões do tipo em 2026), então a detecção se apoia no que elas não conseguem mudar sem quebrar o próprio site: os links de navegação (`/browse?jbv=ID`, `/watch/ID`, `/title/ID` na Netflix; `/browse/entity-ID` na Disney+), os atributos de teste (`data-uia`, `data-testid`) e os rótulos de acessibilidade (`aria-label`).

Performance:

- Só pede nota do que está na tela ou perto dela (IntersectionObserver). Rolar a página puxa o resto.
- Observa o DOM com debounce (250ms, no máximo 1s de espera) e ignora as próprias mudanças. No player (`/watch`, `/play`) a varredura fica parada.
- Card reciclado pela Netflix (mesmo elemento, outro título) é detectado e o badge é refeito.
- Pedidos em lote: os cards que aparecem juntos viram uma consulta só ao Wikidata e um envio só ao índice de busca do RT, em vez de uma consulta por card.
- O service worker (`background.js`) resolve até 8 títulos em paralelo pelo nome (o caminho pelo código da Netflix nem entra nessa fila), dá prioridade ao detalhe que você abriu e deduplica pedidos repetidos.
- Cache pela idade do título: lançamento (deste ano ou do anterior) vale 2 dias, porque a nota ainda muda; até 5 anos, 7 dias; mais antigo, 30 dias. Sem nota em lugar nenhum, 1 dia; falha de rede, 15 minutos.
- Nota vencida aparece na hora e é atualizada em segundo plano: a próxima visita já mostra a nova.

O popup (`popup.html` + `popup.js`) grava as preferências em `chrome.storage.sync`; o content script escuta as mudanças e aplica na hora, sem recarregar a página. O filtro compara o corte com a nota de críticos (ou audiência na falta dela; IMDb e TMDB viram %, tipo 7,4 → 74). Quando a lógica de nota muda entre versões, o `CACHE_VERSION` no `background.js` é incrementado e o cache antigo é apagado sozinho.

## Diagnóstico (se um dia os badges sumirem)

Na aba da Netflix ou da Disney+, abra o console (Cmd+Option+J) e rode:

```js
localStorage.setItem("valeoplay:debug", "1")
```

Recarregue a página. O console passa a mostrar `[Vale o Play?] N cards detectados`. Se aparecer 0 cards, o site mudou a estrutura: o lugar pra ajustar é o objeto `NETFLIX` ou `DISNEY` no `content.js` (seletores `cardSelector`, `exclude` e a função `details`). Se os cards aparecem mas sem nota, o problema está nas fontes: `algoliaSearch` (índice de busca do RT), `wikidataRtPath`, `parseRtScores` e `parseRtSeasons` no `background.js`.

Pra desligar: `localStorage.removeItem("valeoplay:debug")`.

## Testes

### Checagem semanal automática

O repositório tem duas rotinas no GitHub Actions (pasta `.github/workflows`):

- **Testes**: roda os testes automáticos a cada envio pro GitHub.
- **Checagem semanal**: toda segunda de manhã, roda a extensão contra os serviços de verdade (Rotten Tomatoes, índice de busca do RT, Wikidata e TMDB) com 18 títulos conhecidos. Se o RT mudar a página, trocar a chave pública do índice ou o casamento começar a errar, a rotina falha e o GitHub manda um e-mail pra você. Dá pra rodar na hora pela aba **Actions** → **Checagem semanal** → **Run workflow**. Também roda no computador com `node tests/health.js`.

### Testes automáticos

A pasta `tests/` tem testes automáticos dos dois scripts, com o HTML no formato real da Netflix, da Disney+ e do RT (capturado em outubro de 2026). Precisa de Node 18 ou mais novo:

```bash
cd tests
npm install
npm test
```

## Limitações

- O Rotten Tomatoes não tem API pública. A extensão usa o índice de busca que o próprio site publica e, quando falta nota, lê o HTML da página. Se o RT trocar a chave pública do índice, a extensão relê a chave nova na home do RT sozinha; se o índice cair de vez, volta pra busca HTML antiga. Se o layout da página mudar, o IMDb segura como reserva até o ajuste.
- Remake com o mesmo nome no mesmo serviço (A Bela e a Fera 1991 × 2017): no card, sem ano, fica a versão com mais votos; no detalhe do título a extensão usa o ano e acerta. Passar o mouse no badge mostra qual obra foi encontrada.
- Nota de críticos com asterisco é a média das temporadas que têm nota no RT. Quando só uma temporada tem nota (comum em série longa, em que os críticos avaliam só a estreia), a dica avisa e o troféu de aclamado não é dado.
- Título sem cadastro em lugar nenhum, ou com poucos votos (menos de 500 no IMDb e 20 no TMDB), fica sem badge.
- A chave do OMDb embutida é do plano FREE (1000 requisições por dia), mas agora ela quase não é usada: só quando o RT não tem o título. Se estourar, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) e troque `const OMDB_KEY` no `background.js`.

## Publicação (nota pra quem mantém)

Hoje a distribuição é por este repositório. Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. O pacote pronto pra loja é o `vale-o-play-store.zip` (sem testes nem arquivos da loja); os textos estão em `store/ficha-da-loja.md`.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix e na Disney+: acha os cards e o detalhe, pendura badges, filtro e linha de notas |
| `background.js` | Casa no TMDB, acha o título no RT (Wikidata + índice de busca do RT), lê as notas, reserva no OMDb/TMDB, cache e fila |
| `popup.html` / `popup.js` | Menu da extensão: sites, tamanho, posição, filtro de qualidade e limpar cache |
| `styles.css` | Visual do badge, da linha de notas e do filtro de esmaecer |
| `tests/` | Testes automáticos (não vão no pacote da loja) |

## Histórico

- **3.2.0** (out/2026): na Netflix, a nota vem pelo código do título no card (Wikidata), sem depender do nome: zero homônimo errado na Netflix na medição, e 7 em cada 10 títulos da Netflix sem passar pelo TMDB. Consultas em lote (Wikidata e índice do RT). Cache pela idade do título e nota vencida mostrada na hora enquanto atualiza. Página duplicada no RT (ex.: "X-Men" com e sem ano) não esconde mais a nota. Checagem semanal automática no GitHub e testes a cada envio.
- **3.1.0** (out/2026): mais títulos com nota do RT (de 89,5% pra 92,6%) e muito mais com as duas notas (de 71,4% pra 83,4%), medido em 458 títulos reais. Endereço exato do RT pelo Wikidata; índice de busca do próprio RT com apelidos em português; nomes alternativos dos EUA/RU; nota de críticos de série longa pela média das temporadas (com asterisco); desempate de homônimos pelo catálogo do serviço no Brasil; correção de filme e série com o mesmo endereço curto no RT; OMDb quase não é mais chamado.
- **3.0.0** (out/2026): a Netflix trocou a estrutura dos cards (agora `<a data-uia="standard-card" href="/browse?jbv=ID">`, sem `.title-card`) e a extensão parou de achar os títulos. Detecção reescrita sem depender de classe CSS; suporte à Disney+; busca no próprio RT (série deixa de depender de adivinhar URL); casamento no TMDB com pontuação e nome em inglês; OMDb só como reserva; carga só do que está na tela; card reciclado; cache que não guarda erro de rede por 1 dia; botão de limpar cache atualiza as abas; liga/desliga por site; testes automáticos.
- **2.3.0** (jul/2026): popup (tamanho, posição, filtro, limpar cache), troféu de aclamado, badges na busca e no preview, notas na sinopse.
- **2.2** a **1.0**: versões anteriores (RT via OMDb e raspagem da página, IMDb de reserva).

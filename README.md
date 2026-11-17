# Vale o Play?

Extensão de Chrome que mostra a nota do título direto nos cards da **Netflix** e da **Disney+**, sem precisar passar o mouse. Cada título ganha um badge no canto da capa, com as duas notas do Rotten Tomatoes: 🍅 críticos (Tomatometer) e 🍿 audiência (Popcornmeter). Os ícones são desenhos próprios em SVG (tomate e pipoca; abaixo de 60% viram o tomate esverdeado e a pipoca derramada, diferentes também na forma, não só na cor). Quando o RT não tem o título, o badge mostra um selo "IMDb 7,8" (nota de 0 a 10) e, em último caso, "TMDB 7,4" (nota de usuários). Clicar no badge abre a página do título na fonte. Passar o mouse (ou focar com Tab) abre um cartão com a obra encontrada (ex.: "The Godfather (1972)"), de onde veio a nota e as ações: abrir no RT, **corrigir pelo link do RT**, **esconder a nota deste título** e **avisar nota errada** (abre uma issue já preenchida).

Título aclamado ganha destaque: 🏆 e borda dourada quando críticos e audiência passam de 90% no RT, ou quando a nota do IMDb passa de 9,0.

Onde aparece:

- **Netflix**: home, gêneros, busca, Minha lista, Top 10, Continuar assistindo, no preview do hover e no detalhe do título (as notas em tamanho grande logo acima da sinopse).
- **Disney+**: fileiras da home e das coleções, busca, "Você também pode gostar" e a página de detalhe do título (as notas logo abaixo do ano e das temporadas).

Instalou, abriu a Netflix ou a Disney+, funcionou: as chaves de API já vêm embutidas. Toda configuração é opcional, no menu da extensão: em quais sites mostrar, tamanho das notas (pequeno, médio ou grande), canto da capa, traço quando não há nota, filtro de qualidade (corte, qual nota usar: críticos, audiência ou a menor das duas, esmaecer ou esconder a capa, e se vale pra título sem nota), títulos escondidos, a cobertura dos seus últimos dias (quantos títulos vieram do RT, do IMDb ou ficaram sem nota, e por quê), a legenda dos ícones e um botão pra limpar o cache de notas (as abas abertas se atualizam sozinhas; suas correções e estatísticas ficam).

Estados do badge: um ponto pulsando se a nota demorar mais de meio segundo; badge levemente translúcido quando é uma nota provisória (o RT não respondeu e a extensão tenta de novo em 30 s, 2 min e 10 min); um ↻ clicável se a busca falhou; e, se você ligar a opção, um traço "–" nos títulos sem nota.

## Instalação

1. Baixe o código: na página [github.com/bruno-l-rossi/vale-o-play](https://github.com/bruno-l-rossi/vale-o-play), clique no botão verde **Code** → Download ZIP, e descompacte. (Ou use o `vale-o-play.zip` desta pasta.)
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta descompactada (`vale-o-play`).
5. Abra a Netflix ou a Disney+. Os badges aparecem um ou dois segundos depois que a página carrega.

Atualizando de uma versão antiga: em `chrome://extensions`, clique no ícone de recarregar (↻) do card do Vale o Play? e recarregue a aba da Netflix. O cache antigo é descartado sozinho.

## De onde vem a nota

0. **Correção manual**: se você corrigiu o título pelo cartão (ou ele está em `overrides.json`), a página indicada vale e nada mais é consultado.
0. **Disney+, pelo código do título**: o card traz `entity-<uuid>` no link; o Wikidata (propriedade P13902, e P7595/P7596 pros códigos antigos) liga isso direto ao RT, igual à Netflix. Se o Wikidata aponta uma página do outro tipo (minissérie guardada como filme no RT, por exemplo) e o vínculo é pelo IMDb id, ela é aceita.
0. **Netflix, pelo código do título**: todo card da Netflix tem o código do título no link (`/browse?jbv=81040344`). O Wikidata, a base aberta da Wikipédia, liga esse código direto à página do RT (81040344 → `tv/squid_game`). É o caminho mais rápido e mais certeiro: não depende do nome, então não confunde homônimos nem remakes. Na medição, 7 em cada 10 títulos da Netflix foram resolvidos assim; os outros seguem pelo nome, nos passos abaixo. Se existir `data/nf-map.json` / `data/dp-map.json` (ver "Mapas offline"), o código é procurado ali antes de ir ao Wikidata. Pros títulos que seguem pelo nome, a extensão lê o tipo (filme ou série) na página pública do título da Netflix, pra não casar com um homônimo do tipo errado.
1. **TMDB (The Movie Database)** casa o nome que o streaming mostra (em português) com a obra certa. Cada candidato ganha pontos por nome exato (no título em português, no original ou no inglês), ano e tipo quando a página informa, e número de votos. Só passa quem tem confiança alta, então "Marvel" não vira "Ms. Marvel" e um homônimo obscuro não rouba o lugar da série famosa.
   Quando o TMDB não acha o nome do card, a extensão tenta variantes: sem ano entre parênteses, sem "Temporada N", sem "O Filme", sem prefixo de estúdio ("Marvel Studios'", "Disney/Pixar") e, por último, só o trecho antes de ":" (essa só vale se o título está no catálogo do serviço).
2. **Homônimos** (o filme "Animal Kingdom" e a série "Animal Kingdom", ou "Doctor Who" de 2005 e o de 2024): quando dois candidatos empatam, a extensão pergunta ao TMDB qual deles está de fato no catálogo da Netflix ou da Disney+ no Brasil e fica com esse.
3. Na mesma ida ao TMDB vêm o nome em inglês, o ano, o IMDb id e os nomes alternativos usados nos EUA e no Reino Unido.
4. **Rotten Tomatoes**, por dois caminhos ao mesmo tempo:
   - **Wikidata**: a base aberta da Wikipédia guarda, pra cada filme e série, o endereço exato da página no RT. Pelo IMDb id a extensão pega esse endereço direto, sem adivinhar nada (Round 6 → `tv/squid_game`). Resolve cerca de 9 em cada 10 títulos.
   - **Índice de busca do RT**: a mesma busca do topo do site, que devolve nome, apelidos (inclusive em português), tipo, ano e as duas notas de uma vez. Entra quando o Wikidata não conhece o título e confirma o que ele achou.
   - Se faltou alguma nota, a extensão abre a página do título no RT, que é a palavra final.
5. **Série longa sem nota de críticos** (Simpsons, NCIS, Family Guy): o RT não calcula a nota da série inteira, só a de cada temporada. A extensão faz a média das temporadas que têm nota, o mesmo critério do "Avg. Tomatometer" que o RT mostra nas séries em que calcula (conferido em 8 séries: no máximo 1 ponto de diferença). Essa nota aparece com um asterisco (🍅 85%*), e passar o mouse mostra de quantas temporadas ela veio.
6. **Reserva**: só quando o RT não tem nota nenhuma do título, o **OMDb** devolve a nota do IMDb (⭐), exigindo pelo menos 500 votos.
7. **Último recurso**: a nota de usuários do TMDB (★), exigindo pelo menos 20 votos.

### Quanto acerta (medição de outubro de 2026, versão 3.2)

As tabelas abaixo são da v3.2. A v4.0 ainda não foi medida ao vivo; pra medir, use o bench (ver "Testes") e anote o resultado aqui.

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
- O service worker (`background.js`) resolve até 8 títulos em paralelo pelo nome, dá prioridade ao detalhe que você abriu e deduplica pedidos repetidos. Cada host tem seu limite de pedidos simultâneos (RT 4, TMDB 6) e um disjuntor: três respostas 403/429 seguidas do RT pausam as leituras por 2 minutos, em vez de insistir e piorar o bloqueio.
- Dois caches: um **mapa** (título ou código → página do RT, 90 dias) e um de **nota por página** (compartilhado entre Netflix e Disney+, com validade pela idade do título: lançamento 2 dias, até 5 anos 7 dias, mais antigo 30 dias). Reserva IMDb/TMDB: 12 h pra lançamento, 3 dias até 5 anos, 14 dias pra mais antigo. Reserva **provisória** (o RT falhou na hora): 10 minutos, e a página tenta de novo sozinha. Sem nota em lugar nenhum, 1 dia; falha de rede, 15 minutos.
- Nota vencida aparece na hora e é atualizada em segundo plano; quando a nota nova chega, as abas abertas se atualizam sozinhas.
- No detalhe do título (que informa ano e tipo), a extensão refaz a busca com essas dicas se o card tinha sido casado só pelo nome.

O popup (`popup.html` + `popup.js`) grava as preferências em `chrome.storage.sync`; o content script escuta as mudanças e aplica na hora, sem recarregar a página. O filtro compara o corte com a nota de críticos (ou audiência na falta dela; IMDb e TMDB viram %, tipo 7,4 → 74). Quando a lógica de nota muda entre versões, o `CACHE_VERSION` no `background.js` é incrementado e o cache antigo é apagado sozinho.

## Diagnóstico (se um dia os badges sumirem)

Na aba da Netflix ou da Disney+, abra o console (Cmd+Option+J) e rode:

```js
localStorage.setItem("valeoplay:debug", "1")
```

Recarregue a página. O console passa a mostrar `[Vale o Play?] N cards detectados`. Se aparecer 0 cards, o site mudou a estrutura: o lugar pra ajustar é o objeto `NETFLIX` ou `DISNEY` no `content.js` (seletores `cardSelector`, `exclude` e a função `details`). Se os cards aparecem mas sem nota, o problema está nas fontes: `algoliaSearch` (índice de busca do RT), `wikidataRtPath`, `parseRtScores` e `parseRtSeasons` no `background.js`.

Pra desligar: `localStorage.removeItem("valeoplay:debug")`.

Pra saber **por que** um título ficou sem nota do RT: o popup mostra o resumo dos últimos dias (por motivo: `rt_absent` o RT não tem o título; `no_tmdb_match` o TMDB não achou; `rt_no_score` página sem avaliações; `transient` o RT não respondeu) e o botão "Copiar títulos sem nota do RT" copia a lista (site, título, fonte, motivo, código). O estado fica só no seu navegador (`chrome.storage.local`, chaves `vop:`), nada sai da máquina.

A billboard da Netflix (o título grande do topo) e o herói da Disney+ são detectados por heurística, porque o DOM deles só aparece logado. Se a linha de notas não aparecer lá, ligue o debug e ajuste `NETFLIX.hero()` / `DISNEY.details()` no `content.js`.

### Mapas offline (opcional)

```bash
node scripts/gerar-mapas.js
```

Consulta o Wikidata e grava `data/nf-map.json` e `data/dp-map.json` (código do título → página do RT). A extensão lê esses arquivos antes de consultar o Wikidata ao vivo. Rode uma vez, recarregue a extensão e repita de vez em quando. Sem os arquivos, tudo funciona igual, só com mais consultas.

### Correções manuais

Pelo cartão do badge ("Corrigir pelo link do RT") ou editando `overrides.json` no pacote. Formato: `{"nf:81040344": "tv/squid_game", "dp:<uuid>": "m/beauty_and_the_beast_1991", "t:disney:a bela e a fera": null}`. `null` quer dizer "sem RT, não insistir". As suas correções pelo cartão ficam em `vop:ovr` e valem antes do arquivo.

## Testes

### Checagem semanal automática

O repositório tem duas rotinas no GitHub Actions (pasta `.github/workflows`):

- **Testes**: roda os testes automáticos a cada envio pro GitHub.
- **Checagem semanal**: toda segunda de manhã, roda a extensão contra os serviços de verdade (Rotten Tomatoes, índice de busca do RT, Wikidata e TMDB) com 18 títulos conhecidos. Se o RT mudar a página, trocar a chave pública do índice ou o casamento começar a errar, a rotina falha e o GitHub manda um e-mail pra você. Dá pra rodar na hora pela aba **Actions** → **Checagem semanal** → **Run workflow**. Também roda no computador com `node tests/health.js` (mostra o status de cada fonte; se o RT recusar a sua rede, vira aviso, não falha).

### Testes automáticos

A pasta `tests/` tem testes automáticos dos dois scripts, com o HTML no formato real da Netflix, da Disney+ e do RT (capturado em outubro de 2026). Precisa de Node 18 ou mais novo:

```bash
cd tests
npm install
npm test
```

### Bench de cobertura (rede real)

`tools/titulos.json` lista títulos (nome do card, site, código opcional e, quando se sabe, a página certa do RT em `expect`). Dois jeitos de rodar:

- `node tests/bench/run.js` (no Terminal; `--json` pra comparar versões): mostra quantos saíram do RT, quantos caíram no IMDb (plano B) ou TMDB (plano C), quantos acharam a página certa e os motivos.
- `tools/bench.html`, aberto como página da própria extensão (`chrome-extension://<id>/tools/bench.html`, o id aparece em `chrome://extensions`): mede com o seu IP, o cache e o service worker de verdade.

Se o RT recusar a rede, `RT_alcancavel_pct` cai e o resultado diz mais da rede do que da extensão.

## Limitações

- O Rotten Tomatoes não tem API pública. A extensão usa o índice de busca que o próprio site publica e, quando falta nota, lê o HTML da página. Se o RT trocar a chave pública do índice, a extensão relê a chave nova na home do RT sozinha; se o índice cair de vez, volta pra busca HTML antiga. Se o layout da página mudar, o IMDb segura como reserva até o ajuste.
- Remake com o mesmo nome no mesmo serviço (A Bela e a Fera 1991 × 2017): no card, sem ano, fica a versão com mais votos; no detalhe do título a extensão usa o ano e acerta. Passar o mouse no badge mostra qual obra foi encontrada.
- Nota de críticos com asterisco é a média das temporadas que têm nota no RT. Quando só uma temporada tem nota (comum em série longa, em que os críticos avaliam só a estreia), a dica avisa e o troféu de aclamado não é dado.
- Título sem cadastro em lugar nenhum, ou com poucos votos (menos de 500 no IMDb e 20 no TMDB), fica sem badge.
- A chave do OMDb embutida é do plano FREE (1000 requisições por dia), mas agora ela quase não é usada: só quando o RT não tem o título. Se estourar, pegue outra grátis em [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) e troque `const OMDB_KEY` no `background.js`.

## Publicação (nota pra quem mantém)

Uso pessoal por enquanto: a distribuição é por este repositório, e o `vale-o-play-store.zip` está desatualizado (é da 3.1.0; refazer antes de qualquer publicação). Pra instalação de 1 clique, sem Modo do desenvolvedor, o caminho é a Chrome Web Store: conta de desenvolvedor (taxa única de US$5) e revisão do Google, que costuma levar de 1 a 3 dias. Dá pra publicar como "não listado", aí só instala quem tem o link. O pacote pronto pra loja é o `vale-o-play-store.zip` (sem testes nem arquivos da loja); os textos estão em `store/ficha-da-loja.md`.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` | Roda na Netflix e na Disney+: acha os cards, o detalhe e o billboard, pendura badges, estados, cartão de origem, filtro e linha de notas |
| `icons.js` | Ícones SVG próprios (tomate, pipoca, troféu), usados pela página e pelo popup |
| `background.js` | Casa no TMDB, acha o título no RT (Wikidata + índice de busca do RT), lê as notas, reserva no OMDb/TMDB, cache e fila |
| `popup.html` / `popup.js` | Menu da extensão: sites, tamanho, posição, filtro, cobertura, escondidos, legenda e limpar cache |
| `overrides.json` | Correções manuais fixas (título → página do RT) |
| `scripts/gerar-mapas.js` | Gera `data/nf-map.json` e `data/dp-map.json` a partir do Wikidata |
| `tools/` | Bench dentro da extensão (`bench.html`, `bench.js`) e a lista de títulos |
| `docs/PLANO-MELHORIAS.md` | Plano de melhorias por fases, com o progresso marcado |
| `styles.css` | Visual do badge, estados, cartão, linha de notas e filtro |
| `tests/` | Testes automáticos (não vão no pacote da loja) |

## Histórico

- **4.0.0** (nov/2026): a nota do RT passa a ser usada sempre que ele a tem, e o plano B/C só entra quando o RT realmente não tem. Falha temporária do RT vira reserva provisória de 10 minutos que se refaz sozinha (antes valia 1 dia); a página recebe a nota nova quando ela chega em segundo plano; reserva com validade pela idade do título. Disney+ pelo código do título (Wikidata P13902); Netflix com tipo (filme/série) lido da página pública; variantes de nome quando o TMDB não casa; endereço do Wikidata de outro tipo aceito quando o vínculo é pelo IMDb id; detalhe refaz o casamento com ano e tipo. Limite de pedidos por host e disjuntor do RT; cache em duas camadas (mapa + nota por página). Interface: ícones SVG próprios, estados do badge, cartão de origem com corrigir/esconder/avisar, nota na billboard da Netflix, selo "IMDb 7,8", acessibilidade por teclado e leitor de tela, filtro por tipo de nota com opção de esconder, popup com cobertura e legenda. Diagnóstico local (`via` e motivo por título), bench, mapas offline e correções manuais. Billboard da Netflix e herói da Disney+ sem teste ao vivo (detecção por heurística).
- **3.2.0** (out/2026): na Netflix, a nota vem pelo código do título no card (Wikidata), sem depender do nome: zero homônimo errado na Netflix na medição, e 7 em cada 10 títulos da Netflix sem passar pelo TMDB. Consultas em lote (Wikidata e índice do RT). Cache pela idade do título e nota vencida mostrada na hora enquanto atualiza. Página duplicada no RT (ex.: "X-Men" com e sem ano) não esconde mais a nota. Checagem semanal automática no GitHub e testes a cada envio.
- **3.1.0** (out/2026): mais títulos com nota do RT (de 89,5% pra 92,6%) e muito mais com as duas notas (de 71,4% pra 83,4%), medido em 458 títulos reais. Endereço exato do RT pelo Wikidata; índice de busca do próprio RT com apelidos em português; nomes alternativos dos EUA/RU; nota de críticos de série longa pela média das temporadas (com asterisco); desempate de homônimos pelo catálogo do serviço no Brasil; correção de filme e série com o mesmo endereço curto no RT; OMDb quase não é mais chamado.
- **3.0.0** (out/2026): a Netflix trocou a estrutura dos cards (agora `<a data-uia="standard-card" href="/browse?jbv=ID">`, sem `.title-card`) e a extensão parou de achar os títulos. Detecção reescrita sem depender de classe CSS; suporte à Disney+; busca no próprio RT (série deixa de depender de adivinhar URL); casamento no TMDB com pontuação e nome em inglês; OMDb só como reserva; carga só do que está na tela; card reciclado; cache que não guarda erro de rede por 1 dia; botão de limpar cache atualiza as abas; liga/desliga por site; testes automáticos.
- **2.3.0** (jul/2026): popup (tamanho, posição, filtro, limpar cache), troféu de aclamado, badges na busca e no preview, notas na sinopse.
- **2.2** a **1.0**: versões anteriores (RT via OMDb e raspagem da página, IMDb de reserva).

<plano_vale_o_play versao_doc="1" data="2026-11-15" base="v3.2.0 commit cf32b6c (main = origin/main, working tree limpo)">

<uso>
Guia de retomada pra outra conversa de IA implementar. Leitor = Claude. Bruno não lê código (modo CEO/CTO): falar com ele só do que dá pra ver, clicar ou decidir.
Convenções: [V] = verificado lendo o código ou rodando; [H] = hipótese, precisa de teste antes de implementar; [D] = decisão do Bruno pendente.
Refs no formato arquivo:linha valem pro commit cf32b6c. Se o arquivo mudou, localizar pelo nome da função.
Cada item tem ID estável (F2.3 etc). Ao concluir, marcar em <progresso> no fim deste arquivo.
</uso>

<objetivo_do_bruno>
1. Subir a % de títulos com nota do Rotten Tomatoes (RT) e cair o mínimo possível no plano B (IMDb via OMDb, badge ⭐) e no plano C (nota de usuários do TMDB, badge ★).
2. Melhorar experiência, usabilidade e interface (badge, detalhe, popup).
3. Ganhar eficiência (menos pedidos, nota mais rápida) e estabilidade.
</objetivo_do_bruno>

<estado_atual>
Produto: extensão Chrome MV3 "Vale o Play?". Badge com notas do RT (🍅 críticos, 🍿 audiência) nos cards da Netflix e Disney+. Distribuição hoje: repo github.com/bruno-l-rossi/vale-o-play (modo desenvolvedor). Ficha da Chrome Web Store pronta em store/ficha-da-loja.md, ainda sem publicação confirmada.
Arquivos: background.js (1232 linhas, pipeline de notas), content.js (721, adaptadores NETFLIX/DISNEY, badge, detalhe), popup.html/js, styles.css, tests/ (49 testes, jsdom + vm), .github/workflows (testes.yml, checagem-semanal.yml).

Pipeline (background.js):
0. Netflix: nfId do card (/browse?jbv=ID) -> Wikidata P1874 -> P1258 (endereço do RT). fetchByNetflixId :980. Resolve ~7 em 10 títulos da Netflix. Roda fora da fila.
1. Por nome: tmdbMatch :289 (search/multi pt-BR, pontuação, limiar 70, desempate por catálogo BR em disambiguate :266) -> tmdbInfo :310.
2. rtFind :885: Wikidata por IMDb id/TMDB id (wikidataRtPaths :649) em paralelo com índice Algolia do RT (algoliaSearch :739, pickAlgolia :780). Página do RT só se o índice não trouxe as 2 notas (rtScoresForPath :837). Série sem nota de críticos: média das temporadas (parseRtSeasons :486).
3. Índice fora: rtLegacyLookup :523 (busca HTML).
4. Plano B: omdbLookup :933 (Tomatometer do OMDb ou nota IMDb com >=500 votos).
5. Plano C: nota TMDB com >=20 votos.
Cache: chrome.storage.local, chave nf:ID ou nome|tipo|ano|site (cacheKey :1099), TTL por idade (ttlFor :1106), stale-while-revalidate (getScore :1163), CACHE_VERSION "v9".

Medição do README (out/2026, 458 títulos, sem cache): 92,6% com nota RT; 83,4% com as 2 notas; 34 títulos em IMDb/TMDB/sem nota; 5 obras erradas (remakes homônimos na Disney+). Tempo frio: p50 2,2 s, p90 7,2 s; 1.400 pedidos.
README afirma que os 34 foram conferidos um a um no RT: título ausente (animes, novelas, realities) ou sem avaliação (lançamentos, infantis).

Verificado nesta análise (15/nov/2026):
- [V] npm test em tests/: 49/49 passam.
- [V] Checagem semanal no GitHub Actions FALHOU nas 3 execuções desde que existe (26/out, 2/nov, 9/nov), ~20 s cada. Run mais recente: actions/runs/42711619351. Log exige login, causa não lida. Testes (push) passou em 21/out.
- [V] A lista dos 458 títulos e o script de medição NÃO estão no repo nem no histórico git. A medição não é reproduzível.
- [V] ctx.via é gravado (:993, :1013) e nunca lido nem salvo no cache. Não existe registro de por qual caminho cada nota veio nem do motivo de cada falha.
</estado_atual>

<leitura_estrategica>
No conjunto medido, o casamento por nome já está perto do teto: os 34 de fora não têm nota no RT. Então o ganho de cobertura RT vem de 4 lugares, nesta ordem de retorno provável:
A. Perdas de execução que a medição "sem cache, em lote" não enxerga: falha temporária que vira IMDb por 1 dia, card que fica sem badge até recarregar a página, lançamento preso em IMDb por 3 dias depois que o RT ganhou nota. Tudo [V] no código, tamanho real desconhecido.
B. Casos que a amostra de 458 não cobre (catálogo real da Netflix BR tem milhares): filtro de tipo no Wikidata, nome com sufixo/prefixo, Disney+ sem caminho por ID.
C. As 5 obras erradas e os ~30% da Netflix que ainda vão por nome sem ano nem tipo.
D. "2 notas" (83,4%): completar audiência/críticos que faltam.
Sem instrumentação (F1) não dá pra saber quanto cada um rende. Por isso F1 vem antes de mexer em casamento.
Teto real: título que o RT não tem ou não avaliou vai continuar em B/C. A meta honesta é "todo título que o RT tem com nota aparece com nota RT", medido como RT_alcançável.
</leitura_estrategica>

<restricoes_de_ambiente>
- Shell do computador do Bruno via Cowork (device_bash): SEM rede pra rottentomatoes.com, query.wikidata.org, TMDB, Algolia (proxy 403). npm registry funciona. Testes offline rodam; tests/health.js e qualquer benchmark ao vivo NÃO rodam ali.
- Onde rodar coisa com rede real: (a) GitHub Actions (workflow_dispatch), lembrando que hoje a checagem falha lá; (b) Terminal do Mac do Bruno, com ele colando 1 comando; (c) dentro da própria extensão no navegador (modo benchmark, F1.3). Preferir (c) pra medir, porque é o IP e o ambiente reais.
- Deletar arquivo e git commit no folder conectado exigem device_request_delete_permission (git mexe em .lock). Pedir 1 vez no início da sessão de implementação.
- Preferências do Bruno: responder em PT-BR, sem travessão, direto, AskUserQuestion pro que for ambíguo, apresentar plano e esperar OK antes de construir (skill vibe-coding). Entregáveis em OUTPUTS/vale-o-play/.
- Este arquivo está na raiz do repo e não é rastreado. Decidir em F0.3 se entra no git (sugestão: sim, em docs/) e garantir que fica fora do zip da loja.
</restricoes_de_ambiente>

<achados>

<bugs_e_vazamentos severidade="alta">
B1 [V] Falha temporária vira "sem badge" pelo resto da sessão. background responde {ok:true,value:null} quando a busca falhou por rede (valor null com cache de 15 min, refresh :1139). content.js requestScore :321 guarda null no memo (:343, só apaga se undefined) e loadCard :512 desiste (`if (!s) return`). Sessão da Netflix é SPA longa: o card fica sem nota até F5. Mesma coisa pro "sem nota" legítimo de lançamento: nunca reconsulta na sessão.
B2 [V] Falha temporária do RT vira IMDb/TMDB por 1 dia. Se a página do RT devolve 403/429/timeout, ctx.transient=true, rtFind devolve null, o pipeline segue pro OMDb e grava source "imdb" com FALLBACK_TTL = 1 dia (:51, ttlFor :1108). É a causa mais direta de "caiu no plano B sem precisar".
B3 [V] Reserva não transitória fica 3 dias (ttlFor :1108), sem olhar a idade do título. Lançamento da semana ganha nota no RT em horas ou dias e continua ⭐ IMDb.
B4 [V] Netflix: detalhe não corrige o card. cacheKey :1100 e o memo do content (:323) usam só nf:ID. Quando o título foi resolvido por nome (os ~30% fora do Wikidata), o modal de detalhe manda ano e tipo (:198-199) mas recebe a resposta em cache do card, que foi casada sem ano nem tipo. O README diz que "no detalhe a extensão acerta": vale pra Disney+, não vale mais pra Netflix desde a v3.2.
B5 [V] wikidataRtPaths :657 descarta endereço do RT cujo prefixo (m/ ou tv/) difere do tipo que o TMDB deu. O vínculo veio por IMDb id (identidade certa), então o filtro só joga fora acerto: minissérie, especial de stand-up, filme pra TV e documentário costumam ter tipo diferente entre TMDB e RT. pickAlgolia ainda pode salvar (regra de s>=120), mas só com nome exato e mesmo ano.
B6 [V] Checagem semanal falhando desde o 1º dia (ver estado_atual). Hipóteses [H]: RT ou Algolia bloqueiam IP de datacenter do GitHub; Wikidata recusa o User-Agent padrão do Node (o código manda Api-User-Agent, o Node manda User-Agent "node"); bug no próprio health.js. Enquanto falha sempre, o alarme não serve.
B7 [V] Sem limite por host nem recuo. O caminho da Netflix roda fora da fila (:1056-1066): 40 cards podem disparar até ~7 a 40 leituras de página do RT ao mesmo tempo (as que o índice não trouxe com 2 notas). Rolagem rápida multiplica. Risco de 403 do RT, que alimenta B2.
B8 [V] Nota vencida atualiza por trás (getScore :1172) mas a página aberta nunca recebe a nova. Só na próxima visita.
B9 [V] Mapeamento e nota dividem a mesma entrada de cache. Quando a nota vence, refaz tudo (TMDB search, info, Wikidata, índice) pra descobrir de novo um endereço do RT que não muda.
</bugs_e_vazamentos>

<cobertura_rt>
C1 [V] Sem variantes de nome. Se tmdbMatch não acha, só resta rtByShownTitle :912 (casamento exato e único) e depois null, sem nem B/C. Não existe limpeza de "Marvel Studios", "Disney", "LEGO", "(Dublado)", "Versão estendida", "Temporada N", "Parte N", "O Filme", nem tentativa com o trecho antes/depois de ":" ou " - ".
C2 [V] tmdbMatch usa só a página 1 de search/multi e não tenta search/movie + search/tv separados quando multi vem cheio de pessoas/coleções.
C3 [V] Disney+ não tem caminho por ID. O card traz entity-UUID (dpId, content.js:216) e ele só serve de chave de DOM. [H] Wikidata tem propriedades de ID da Disney+ (filme e série; os números P7595/P7596 são de memória, CONFIRMAR). [H] O formato pode ser o ID antigo e não bater com o entity-UUID atual. Se bater, resolve os 5 remakes errados e tira a Disney+ do casamento por nome.
C4 [V] As 5 obras erradas são remakes homônimos no mesmo serviço; o card não tem ano. Hoje ganha o de mais votos.
C5 [H] Netflix sem ano/tipo no card: dá pra buscar ano e tipo do título dentro da própria Netflix (mesma origem, pelo content script). Candidatos a testar no navegador: JSON-LD da página pública netflix.com/title/ID (schema.org Movie/TVSeries); dados que o modal de preview já carrega; endpoint interno de metadata (frágil, muda com build). Qualquer um que funcione dá ano+tipo pros ~30% que vão por nome.
C6 [V] parseRtSeasons :486 só calcula média de críticos. [H] Série sem audiência no nível da série pode ter audiência por temporada (no tile ou só na página da temporada). Testar no HTML real antes.
C7 [V] Não existe lista de correções manuais. Um overrides.json no pacote (nfId / entity-id Disney / nome normalizado -> endereço do RT, ou -> "sem RT") é o jeito mais barato de consertar título popular que falha e de fixar os 5 remakes.
C8 [H] Mapa estático nfId -> endereço RT (+ nome em inglês e ano) gerado do Wikidata por um workflow e embutido no pacote. Tira o SPARQL do caminho quente dos ~70% da Netflix (latência e 429) e deixa só 1 POST no índice. Tamanho estimado: dezenas de milhares de linhas, algumas centenas de KB (medir).
C9 [H] Consultar o índice Algolia direto pelo vanity (filtro ou busca restrita) em vez de buscar pelo rótulo em inglês e torcer pro hit vir entre os 10. Depende de o índice aceitar filtro por vanity. Testar com 1 chamada.
C10 [V] OMDb devolve Tomatometer; quando vem, o resultado já sai como source "rt" só com críticos (:1017). Mantém.
C11 Fora de alcance: anime, novela, reality que o RT não cadastra. Continuam em B/C. Não gastar esforço aí.
</cobertura_rt>

<ux_ui>
U1 [V] Badge não tem estado de "carregando", "falhou" nem "sem nota". Com p90 frio de 7 s, o usuário não distingue "ainda vem" de "não tem".
U2 [V] Ícones são emoji (content.js:379-402): desenho muda por sistema e 🟢 pra "podre" lê como "bom" fora do contexto do RT. ★ e ⭐ são quase iguais entre si.
U3 [V] A dica de qual obra foi encontrada usa atributo title (fillParts :434): demora ~1 s e, na Netflix, o hover abre o mini-modal por cima do card antes. Na prática quase ninguém vê.
U4 [V] Billboard (título gigante do topo da home) é excluído (NETFLIX.exclude :131). É o título mais visível da página e fica sem nota.
U5 [V] Badge é div com onclick: sem role, sem foco por teclado, sem aria-label.
U6 [V] Filtro de qualidade só esmaece e só compara críticos (effectiveScore :358). Faltam: escolher a nota (críticos, audiência, a menor das 2), esconder em vez de esmaecer, tratar título sem nota.
U7 [V] Popup (250 px): 5 blocos de configuração e nada de estado. Não mostra se está funcionando, quantos títulos têm nota, legenda dos ícones, nem caminho pra avisar "nota errada".
U8 [V] Sem tela de boas-vindas na instalação e sem legenda dos símbolos (🍅 🍿 🟢 🥤 ⭐ ★ 🏆 *).
U9 [V] Não dá pra corrigir/avisar casamento errado. O usuário vê a nota errada e não tem o que fazer.
U10 [V] Tudo fixo em pt-BR e Brasil: idioma do TMDB (:291), região do catálogo "BR" (:279), textos da interface. A ficha da loja propõe distribuir pra todos os países.
U11 [H] Colisão visual do badge no canto superior esquerdo com selos da Netflix (N de original, Top 10, "Novidade") e da Disney+. Conferir com print real nos 4 cantos e 3 tamanhos. As screenshots da loja ainda são da v2.
</ux_ui>

<eficiencia>
E1 = B9 (separar cache de mapeamento do cache de nota).
E2 = C8 (mapa estático).
E3 = B7 (limite por host + disjuntor).
E4 [V] scanCards (content.js:542) refaz querySelectorAll + closest(exclude com 16 seletores) + info() em todos os cards a cada mutação com debounce de 250 ms, mais um intervalo fixo de 5 s (:662). Funciona; custo cresce com a página. Ganho possível: pular host já tratado com mesmo href/aria-label antes do closest. Prioridade baixa, medir antes.
E5 [V] Service worker MV3 pode morrer com a atualização por trás em andamento (refresh sem await depois do sendResponse). Efeito: a nota vencida demora mais 1 visita pra atualizar. Baixa.
E6 [V] pruneCache só roda em onInstalled/onStartup. OK pro volume atual.
</eficiencia>

<publicacao_e_risco>
P1 [V] Chave OMDb FREE embutida: 1.000 pedidos/dia somados entre TODOS os usuários. Estimativa: usuário ativo gasta ~10 a 30/dia, então ~50 usuários esgotam. Estourou: ctx.transient (:939) e o título cai pro plano C. Antes de publicar aberto, resolver (ver D3).
P2 [V] TMDB exige atribuição visível ("This product uses the TMDB API but is not endorsed or certified by TMDB") e logo. Não existe no popup nem na ficha.
P3 [V] O RT não tem API pública; a extensão usa a chave pública de busca do site e lê HTML. Risco de quebra (já mitigado em parte) e de termos de uso. Publicar como "não listado" primeiro reduz exposição.
P4 [V] vale-o-play-store.zip está DEFASADO: contém manifest 3.1.0 e background.js diferente do repo (3.2.0). Zips são montados à mão (21/out 13:27, antes do commit da v3.2.0) e há cópias soltas em OUTPUTS/. Sem script de build. Quem subir esse zip na loja publica a versão velha.
P5 [V] Edge roda o mesmo pacote. Firefox pede ajustes de manifest. Não é prioridade.
</publicacao_e_risco>

</achados>

<fases>

<fase id="F0" nome="Arrumar a casa" esforco="1 sessão curta" depende="nada">
F0.1 Diagnosticar a checagem semanal. Pedir ao Bruno o log do run 42711619351 (aba Actions, colar o texto) ou rodar `node tests/health.js` no Terminal dele. Corrigir a causa. Se for bloqueio de IP de datacenter: manter no Actions só o que responde de lá (Wikidata, TMDB, Algolia) e mover a checagem do HTML do RT pro modo benchmark dentro da extensão (F1.3). Mandar User-Agent próprio em todos os pedidos do health.js.
  Aceite: 1 execução manual verde no Actions, ou decisão registrada de onde cada checagem roda.
F0.2 scripts/build.sh: gera os 2 zips a partir do git (git archive), excluindo tests/, store/, docs/, .github/, *.md que não sejam da loja. Apagar zips soltos de OUTPUTS/ (pedir permissão de deletar).
  Aceite: `sh scripts/build.sh` gera zip cujo manifest.version bate com o do repo.
F0.3 Mover este plano pra docs/PLANO-MELHORIAS.md e commitar.
</fase>

<fase id="F1" nome="Medir antes de mexer" esforco="1 a 2 sessões" depende="F0">
F1.1 Registrar caminho e motivo. Todo valor em cache ganha `via` (netflix-id | wikidata | rt-index | rt-search | omdb-rt | imdb | tmdb) e, quando não é RT com nota, `miss` com 1 código: no_tmdb_match | rt_absent (Wikidata e índice sem endereço) | rt_no_score (página existe, placar vazio) | rt_transient (403/429/5xx/timeout em fonte do RT) | ambiguous (rtByShownTitle achou mais de 1). Valor null passa a ser objeto {source:null, miss, transient} em vez de null puro (ajustar content.js e testes). Subir CACHE_VERSION.
  Aceite: teste novo por código de miss; nenhum teste antigo quebrado.
F1.2 Contadores locais (chrome.storage.local, nada sai da máquina): por dia e por site, quantos títulos por via/source/miss. Popup ganha linha "Hoje: 212 títulos · 94% RT · 4% IMDb · 2% sem nota" e botão "Exportar títulos sem RT" (JSON: nome exibido, nfId/entity-id, site, miss, obra casada). Atualizar politica-privacidade.md (continua sem coleta; só contagem local).
  Aceite: Bruno navega 10 min, abre o popup, vê os números e baixa o JSON.
F1.3 Benchmark reproduzível. tests/bench/titulos.json versionado (recriar a amostra: pedir ao Bruno a lista dos 458 se existir em outra conversa; senão, montar nova com nome exibido + nfId/entity-id + site, alimentada também pelo export de F1.2). Runner em 2 formas: node tests/bench/run.js (Terminal do Bruno) e página interna da extensão bench.html (roda no navegador real). Saída: tabela por via/miss, % RT, % 2 notas, p50/p90, pedidos, e diff contra a rodada anterior (tests/bench/resultados/AAAA-MM-DD.json).
  Aceite: 2 rodadas seguidas com diferença menor que 1 ponto em % RT.
F1.4 Definir a métrica-alvo RT_alcançável = títulos com nota RT / títulos que têm nota no RT (verdade conferida e anotada em titulos.json como rt_esperado: endereço ou null). Toda fase seguinte reporta essa métrica antes/depois.
</fase>

<fase id="F2" nome="Tapar os vazamentos de execução" esforco="2 sessões" depende="F1.1">
Maior retorno esperado pro objetivo "não cair em B/C sem precisar". Não muda casamento.
F2.1 (B2) Falha temporária numa fonte do RT não promove B/C como resposta definitiva. Regra: se miss = rt_transient, devolver a reserva marcada provisional:true com TTL de 10 min e reagendar. Nunca gravar 1 dia.
F2.2 (B1, B8) Canal de atualização pro content. Opção simples: background grava a chave atualizada e o content escuta storage.onChanged pras chaves que ele pediu; ou porta long-lived (chrome.runtime.connect). Ao chegar nota nova: troca o badge no lugar. O memo do content passa a expirar: provisional/transient em 30 s, 2 min, 10 min (máx 3 tentativas); "sem nota" legítimo em 30 min.
  Aceite: teste jsdom em que a 1ª resposta é provisória IMDb e a 2ª é RT; o badge muda sem recarregar.
F2.3 (B3) TTL da reserva pela idade: título do ano corrente ou anterior, ou sem ano: 12 h; até 5 anos: 3 dias; mais velho: 14 dias. rt_no_score de lançamento: 12 h.
F2.4 (B7) Limitador por host: no máx 4 leituras de página do RT em paralelo, 6 pro TMDB; fila única com prioridade (detalhe > card visível). Disjuntor: 3 respostas 403/429 seguidas do RT pausam leitura de página por 2 min (o índice continua). Incluir o caminho da Netflix na mesma fila de páginas.
F2.5 (B4) Detalhe melhora o card. Se a entrada nf:ID tem via diferente de netflix-id e o pedido atual traz ano ou tipo que o pedido original não tinha, refazer por nome com ano/tipo e sobrescrever nf:ID. Guardar no cache quais dicas (ano, tipo) foram usadas.
  Aceite: teste "card casa remake errado, abrir detalhe corrige, card passa a mostrar o certo".
F2.6 (B9, E1) 2 caches: map:<chave> -> {rtPath, tipo, ano, nome, via} com 90 dias; score:<rtPath> -> notas com TTL por idade. Renovar nota = 1 consulta ao índice ou 1 página. 2 cards que apontam pra mesma obra (Netflix e Disney+) dividem a nota.
Medir com F1.3 antes e depois. Esperado [H]: queda visível de imdb/tmdb/sem nota em uso real; pedidos por visita repetida caem bastante.
</fase>

<fase id="F3" nome="Subir a cobertura do RT" esforco="3 a 4 sessões" depende="F1, F2.6">
Ordem por custo/retorno. Cada item entra só se o benchmark mostrar ganho e zero obra errada nova.
F3.1 (B5) Aceitar endereço do Wikidata de tipo diferente quando o vínculo veio por IMDb id. Manter a ordem: mesmo tipo primeiro. Custo: 1 linha + teste.
F3.2 (C7) overrides.json no pacote + leitura no início de fetchScore. Formato: {"nf:81040344":"tv/squid_game","dp:<entity>":"m/beauty_and_the_beast_1991","t:disney:a bela e a fera":null}. null = "sem RT, não insistir". Começar pelos 5 remakes e pelo export de F1.2. Teste que valida formato e duplicatas.
F3.3 (C1, C2) Variantes de nome quando o TMDB não casa: tirar prefixos de marca, sufixos de edição/dublagem/temporada, tentar antes e depois de ":" e " - ", e search/movie + search/tv. Só aceitar variante com pontuação >= limiar + 10 e, se possível, confirmação pelo catálogo do serviço (watch/providers). Risco: obra errada. Guardar via "variant" pra auditar.
F3.4 (C3) Disney+ por ID. Passo 1 (pesquisa, 30 min): confirmar no Wikidata as propriedades de ID da Disney+, formato e contagem, e se batem com o entity-UUID dos cards atuais. Passo 2 se bater: content manda dpId; WD_PROPS ganha as chaves; fetchByDisneyId igual a fetchByNetflixId; cacheKey dp:ID. Se não bater: registrar e seguir pra F3.5.
F3.5 (C4, C5) Ano e tipo sem depender do card. Netflix: experimento no navegador com os 3 candidatos de C5; implementar o primeiro estável, só pros títulos que o Wikidata não resolveu, com cache por ID. Disney+: ler o ano no detalhe já funciona; avaliar se o href/alt do card traz algo a mais (inspecionar DOM real com o Bruno). Fallback sempre igual ao de hoje.
F3.6 (C6) Audiência por temporada. Só depois de olhar o HTML real de 5 séries sem audiência de série. Se o tile trouxer: média igual à de críticos, com asterisco próprio.
F3.7 (C8, E2) Mapa estático. Workflow semanal consulta o Wikidata (P1874 com P1258, + rótulo en + ano) e gera data/nf-map.json; build embute. Em runtime: mapa -> índice (1 POST). Wikidata ao vivo fica só pro que não está no mapa. Mesma ideia pra Disney+ se F3.4 der certo. Decidir tamanho máximo aceitável do pacote com o número medido.
F3.8 (C9) Teste de 1 chamada: filtro por vanity no índice. Se aceitar, usar em fetchByNetflixId/F3.7 no lugar da busca por rótulo.
Meta [D1]: RT_alcançável >= 99% e obra errada <= 1 na amostra; "% RT bruto" e "% 2 notas" reportados, sem promessa de número porque dependem do que o RT tem.
</fase>

<fase id="F4" nome="Experiência e interface" esforco="3 sessões" depende="F1.1, F2.2 (estados)" obs="fechar DESIGN.md e mostrar mockup ao Bruno antes de codar (skill vibe-coding / design)">
F4.1 (U1) Estados do badge: carregando (ponto discreto pulsando no canto, aparece só depois de 400 ms), provisório (reserva enquanto tenta RT de novo, opacidade menor), sem nota (nada por padrão; opção "mostrar traço em título sem nota"), falha (ícone pequeno com "tentar de novo").
F4.2 (U2) Ícones próprios em SVG inline (não copiar os do RT: são marca registrada), iguais em qualquer sistema. Fresco x podre por forma E cor. Reserva IMDb/TMDB com selo de texto ("IMDb 7,4") em vez de 2 estrelas parecidas.
F4.3 (U3, U9) Cartão de detalhe próprio no lugar do title: aparece no hover do badge com atraso de 150 ms, mostra fonte, obra casada (nome + ano), de onde veio a nota (ex.: "média de 12 temporadas"), link "abrir no RT" e "nota errada?". "Nota errada?" abre issue pré-preenchida no GitHub (nome, ID, obra casada, versão) e oferece "esconder nota deste título" (salvo em storage.sync). Na Netflix, pôr o mesmo conteúdo na linha do mini-modal, que é o que o hover realmente mostra.
F4.4 (U4) Nota no billboard da Netflix (linha compacta perto do logo/sinopse) e conferir o herói da Disney+.
F4.5 (U5) Badge vira button com aria-label ("Rotten Tomatoes: críticos 91%, audiência 92%. Abrir página"), foco visível e Enter.
F4.6 (U6) Filtro: escolher nota (críticos | audiência | a menor), ação (esmaecer | esconder), e o que fazer com título sem nota. Corte por slider de 5 em 5.
F4.7 (U7, U8) Popup novo: topo com estado ("Funcionando na Netflix · 212 títulos hoje · 94% com nota do RT"), legenda dos símbolos recolhível, configurações agrupadas em "Aparência" e "Filtro", rodapé com versão, atribuição TMDB (P2), "avisar problema" e "limpar cache". Página de boas-vindas no onInstalled (1 tela: o que cada símbolo quer dizer + 3 ajustes principais).
F4.8 (U11) Prints reais nos 4 cantos x 3 tamanhos na Netflix e Disney+; ajustar posição padrão se colidir. Refazer screenshots da loja com a v3.
F4.9 (E4) Só se a medição no Performance do Chrome mostrar varredura acima de ~8 ms por ciclo.
</fase>

<fase id="F5" nome="Publicação e expansão" esforco="2 sessões + decisões" depende="F2, F4.7">
F5.1 (P1) Resolver cota do OMDb conforme D3. F5.2 (P2) Atribuição TMDB no popup e na ficha. F5.3 (P4) Publicar como "não listado" primeiro; workflow de release que roda build.sh e anexa o zip na tag.
F5.4 (U10) Região e idioma configuráveis (padrão BR/pt-BR): language do TMDB, região do watch/providers, textos via chrome.i18n (pt-BR + en). Só se D4 = sim.
F5.5 (P5) Edge Add-ons com o mesmo zip. Firefox depois.
F5.6 Novos serviços: Prime Video e Max são os próximos adaptadores naturais (content.js já é 1 objeto por site). Cada um: seletor de card, info(), details(), provedores do TMDB, testes com HTML real. Só depois de F3 estável.
</fase>

</fases>

<ideias_descartadas>
- Servidor próprio ou snapshot diário de notas hospedado: redistribuir nota raspada do RT aumenta risco de termos de uso e cria custo fixo. Contraria "zero servidor".
- Raspagem da busca do IMDb pra fugir do OMDb: frágil e pior em termos de uso.
- Telemetria remota de falhas: quebraria a política de privacidade. O export manual (F1.2) cobre.
- Baixar o limiar de casamento (MATCH_THRESHOLD 70, dice 0,88) pra "casar mais": troca título sem nota por nota errada. Só via variantes controladas (F3.3).
</ideias_descartadas>

<decisoes_pendentes_bruno>
D1 Meta: aceita "todo título que o RT tem com nota aparece" (RT_alcançável >= 99%) como alvo, sabendo que anime/novela/reality seguem em IMDb?
D2 Existe em outra conversa a lista dos 458 títulos da medição de outubro? Se sim, trazer. Se não, monta-se nova.
D3 Cota do OMDb pra publicar: (a) campo opcional "sua chave OMDb" no popup e sem chave cai direto no TMDB; (b) pagar o plano do OMDb (~US$1/mês no Patreon, 100 mil/dia); (c) tirar o IMDb e ficar RT -> TMDB. Recomendo (b) + (a).
D4 Público: só Brasil ou abrir pra outros países (decide F5.4)?
D5 Publicar na loja agora (não listado) ou só depois de F2+F4?
D6 Ordem: recomendo F0 -> F1 -> F2 -> F3.1/F3.2 -> F4 -> resto de F3 -> F5. Se a prioridade for visual, F4.1 a F4.3 podem subir pra logo depois de F2.
</decisoes_pendentes_bruno>

<protocolo_de_retomada>
1. Ler ABOUT ME/ (regra do Bruno) e este arquivo inteiro.
2. `cd OUTPUTS/vale-o-play && git status && git log -3` e `cd tests && npm install && npm test` (esperado: 49+ passando).
3. Conferir <progresso> abaixo e perguntar ao Bruno as decisões D ainda abertas da fase que vai começar (AskUserQuestion, no máx 4 por vez).
4. Apresentar o recorte da sessão em linguagem de produto (o que ele vai ver de diferente) e esperar OK.
5. Implementar em commits pequenos por item (mensagem "F2.1: ..."). Toda mudança de lógica de nota: teste novo + subir CACHE_VERSION + rodar benchmark (quando F1.3 existir) e anotar antes/depois aqui.
6. Ao fim: atualizar README (seções "De onde vem a nota", "Quanto acerta", "Histórico"), manifest.version, politica-privacidade.md se mudou o que é lido/enviado/guardado, store/ficha-da-loja.md se mudou permissão.
Invariantes que não podem quebrar: nenhuma nota errada nova (preferir sem nota); nada de dado do usuário saindo da máquina; sem código remoto; detecção de card sem depender de classe CSS; permissões novas só com justificativa na ficha.
</protocolo_de_retomada>

<progresso>
Legenda: [x] feito e coberto por teste offline | [~] feito, falta validar ao vivo | [-] descartado ou adiado | [ ] aberto
Implementado na v4.0.0 (2026-11-17). Nada de RT/Wikidata/TMDB/Algolia foi chamado ao vivo na implementação (shell sem rede); validar com tests/health.js e tests/bench/run.js no Mac.
F0.1 [~] health.js com User-Agent próprio, status por fonte e RT bloqueado vira aviso. Causa real das 3 falhas do Actions segue sem leitura (log exige login).
F0.2 [-] loja e distribuição fora do escopo por ora (uso pessoal). vale-o-play-store.zip está desatualizado (3.1.0).
F0.3 [x] plano em docs/.
F1.1 [x] via e miss em cada entrada de cache e na resposta do getScore.
F1.2 [x] vop:stats e vop:misses locais; popup mostra cobertura e copia a lista de títulos sem RT.
F1.3 [~] tools/titulos.json + tests/bench/run.js (Node, rede real) + tools/bench.html (dentro da extensão). Falta rodar e anotar a 1ª linha do benchmark.
F1.4 [~] métrica RT_alcancavel_pct no bench (proxy: respostas sem falha temporária). Falta anotar rt_esperado nos títulos.
F2.1 [x] F2.2 [x] F2.3 [x] F2.4 [x] F2.5 [x] F2.6 [x]
F3.1 [x] F3.2 [x] (overrides.json + correção do usuário em vop:ovr, pelo cartão) F3.3 [x] F3.4 [x] (Disney+ por entity-UUID, P13902; ids antigos P7595/P7596)
F3.5 [x] (tipo da Netflix pelo JSON-LD da página pública; Disney+ ano/tipo pelo detalhe)
F3.6 [-] não feito (precisa olhar HTML real de séries sem audiência)
F3.7 [~] mapas por script local (scripts/gerar-mapas.js), não por workflow. Rodar uma vez no Mac.
F3.8 [-] não feito (teste de 1 chamada ao índice precisa de rede)
F4.1 [x] F4.2 [x] F4.3 [x] F4.5 [x] F4.6 [x] F4.7 [x]
F4.4 [~] billboard da Netflix por heurística (sem login não deu pra ver o DOM real); herói da Disney+ idem. Ligar localStorage valeoplay:debug pra ver o que a detecção achou.
F4.8 [ ] prints reais nos 4 cantos x 3 tamanhos
F4.9 [-] só se o Performance do Chrome mostrar varredura acima de ~8 ms
F5 [-] loja e distribuição, fora do escopo
Benchmark (preencher a cada rodada): data | versão | % RT | % 2 notas | RT_alcançável | erradas | p50 | p90 | pedidos
2026-10-21 | 3.2.0 | 92,6 | 83,4 | n/d | 5 | 2,2 s | 7,2 s | 1.400 (fonte: README, não reproduzido)
</progresso>

</plano_vale_o_play>

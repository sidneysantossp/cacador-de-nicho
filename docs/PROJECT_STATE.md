# Estado da operação — 22/09/2026

## Objetivo empresarial

O Caçadores de Nichos existe para encontrar, validar e transformar oportunidades de conteúdo em ativos capazes de gerar receita. A plataforma deve reduzir o trabalho do operador a decisões e produção, não a acionar manualmente cada ferramenta.

## Mercado e critérios

- Mercado monitorado: US.
- Conteúdo: English.
- Formato: long form, mínimo de 4 minutos.
- Gates rígidos do Radar: vídeo >= 500 mil views, idade < 72h, canal <= 20 vídeos, canal <= 180 dias e breakout sobre inscritos quando a contagem é pública.
- País e idioma ausentes/ambíguos são descartados; não são inferidos.
- Princípio operacional: outlier não é mercado. Demanda estrutural exige repetição em vídeos, criadores e momentos independentes.

## Implementado

- Next.js 16.3.5, React 19.3.0.
- Repositório privado GitHub: sidneysantossp/cacador-de-nicho, branch principal master.
- Deploy Vercel ativo no projeto cacador-de-nicho do scope imperiodosapps-7952.
- Radar estrito US + English + long form.
- Análise de Canal com Top 10, comentários públicos, weak sample recente, snapshots/velocity, Niche Lock, Topic Genome, sustentabilidade, sequência editorial, thumbnails e busca de canais pequenos similares.
- Opportunity Report com Curve Engine, validação estrutural, saturação/whitespace, Viral DNA, três transferências e blueprint de canal com 10 episódios.
- Mission Orchestrator com orçamento conservador por execução.
- Mission Control como home da operação, mostrando somente Production Ready, decisões humanas e bloqueios.
- OpenAI/YouTube armazenáveis em cofre Supabase ou fallback de ambiente.
- Autenticação privada por cookie assinado e proteção de origem.
- Jobs com exclusão mútua, lease e histórico de atividade.
- Erros de OpenAI tratados com causas acionáveis; módulos suplementares da Análise de Canal não apagam uma anatomia válida quando falham.
- Modelos de API permitidos: GPT-5.6 Luna, Terra e Sol.

## Mission Orchestrator

Uma missão manual autenticada executa, em ordem de prioridade:

1. Verifica saúde de YouTube e OpenAI.
2. Fecha primeiro uma Análise de Canal existente que ainda esteja sem Opportunity Report fresco.
3. Atualiza o Radar sem relaxar filtros.
4. Seleciona no máximo um novo candidato por breakout, depois views e recência.
5. Executa no máximo uma Análise de Canal profunda.
6. Gera no máximo um Opportunity Report por missão.
7. Recalcula a fila de produção e as decisões necessárias.
8. Persiste um Mission Brief diário em radar_analyses.

Production Ready exige validação estrutural, demanda/repetibilidade pelo menos médias, lacuna não baixa e saturação não alta. Curvas emergentes podem aparecer somente como decisão de piloto; hipóteses fracas permanecem fora da fila do operador.

## Segurança e custos

- Nenhuma recorrência do Mission Control é ativada automaticamente nesta etapa.
- A primeira missão deve ser validada manualmente em produção antes de configurar execução diária.
- Cada missão limita trabalho pesado para reduzir custo e risco de timeout.
- YOUTUBE_ANALYTICS_APPROVED não é usado como trava global da inteligência editorial.
- Segredos permanecem server-only.

## Estado de validação desta mudança

Branch de implementação: feat/mission-orchestrator.

Validação exigida antes de promoção:
- npm run typecheck
- npm test
- npm run build
- preview Vercel READY
- comparação com master sem divergência destrutiva

Depois da promoção, a primeira validação operacional é executar Mission Control uma vez com a sessão autenticada e confirmar o brief real gerado com as credenciais de produção.


## YouTube Quota Intelligence — 23/09/2026

Implementado controle persistente do bucket granular `search.list`:
- teto operacional: 100 buscas/dia;
- reset pelo calendário do Pacífico;
- reservas independentes para descoberta, resolução, análise de canal e similares;
- deduplicação de descoberta em janela de 6h;
- referências resolvidas progressivamente e sem poder bloquear o Radar principal;
- diferenciação entre quota dura e throttling temporário;
- modo quota-degraded preserva Opportunity Reports e análises já coletadas;
- orçamento visível no Mission Control;
- nenhuma migration de Supabase necessária.

Validação: CI completo passou no branch `feat/youtube-quota-intelligence`.


## Competitor Universe — primeira entrega

Implementado no branch `feat/competitor-universe`:
- novo módulo Universe na navegação;
- cards agrupados por cluster;
- resumo executivo do universo;
- busca e filtros por cluster/status;
- importação em lote por colagem, CSV ou TXT;
- armazenamento persistente sem migration nova;
- resolução direta de canais sem search.list;
- snapshot de uploads recentes;
- sinais iniciais de breakout/outlier/cadência;
- monitoramento hot/active/stable/dormant;
- ações de Anatomia, Atualizar e abrir YouTube;
- concorrentes separados da Gestão de Canais próprios.

Esta entrega não inventa Channel DNA ou Gap: quando essas engines ainda não rodaram, o card mostra explicitamente que a camada está pendente.


## Universe DNA + Signals Engine — 23/09/2026

Implementado:
- snapshots históricos resumidos por concorrente;
- sinais estruturados de breakout, outlier, repeat-hit, aceleração e cadência;
- Channel DNA estruturado em lotes de até 5 concorrentes;
- clustering enriquecido pelo DNA;
- prioridade automática sem score opaco;
- cadência hot/active/stable/dormant;
- botão "Rodar inteligência" no Universe;
- geração/atualização de DNA por card;
- Mission Control avança Universe automaticamente antes do Radar;
- resumo da missão mostra concorrentes, canais com sinais e canais com DNA;
- políticas de frequência/prioridade cobertas por testes.

Validação do branch `feat/universe-dna-signals`: typecheck, testes e build/CI concluídos com sucesso.


## Universe Curves + Gap Engine — 23/09/2026

Implementado:
- biblioteca derivada de curvas cross-channel;
- classificação hypothesis/emerging/structural por criadores independentes;
- Gap Engine com demandStatus validado no backend;
- sample saturation explicitamente restrita ao Universe analisado;
- amostragem diversificada entre clusters;
- views Competitors / Curves / Gaps;
- primeiros testes dos gaps sempre destinados ao público em inglês;
- atualização automática via Mission Control quando o DNA muda;
- contagem de curves/gaps no Mission Brief;
- regras de classificação, demanda e seleção cobertas por testes.

Validação: CI completo aprovado no branch `feat/universe-curves-gaps`.


## Universe Bootstrap — 228 concorrentes reais

Em 23/09/2026, os três arquivos de concorrentes fornecidos pelo operador foram consolidados em 228 canais únicos e inseridos no Supabase correto `Caçador de Nichos` como fila persistente.

Infraestrutura aplicada:
- `radar_managed_channels` criada no Supabase;
- `radar_universe_queue` criada com RLS e grants apenas para service_role;
- 228 itens inseridos inicialmente com status pending;
- processamento em lotes de até 25;
- progresso exposto no dashboard;
- Mission Control prioriza bootstrap do Universe antes do Radar externo.


## Universe Daily Cron — 24/09/2026

Configurado cron diário às 12:00 UTC para `/api/cron/universe`.
Objetivo: manter o bootstrap e Channel DNA avançando sem exigir clique do operador, com teto conservador de 25 imports e bootstrap de DNA em até 3 lotes de 5 por execução (máximo 15 canais / 120s para essa etapa).


- Cron Universe agora encadeia bootstrap → DNA → Curves/Gaps condicionalmente, apenas quando o DNA mudou. O DNA diário usa burst limitado, tenta cada canal no máximo uma vez por execução e recalcula Curves/Gaps somente depois dos lotes.

- Cron diário do Universe passa a registrar execução no Activity Ledger e respeitar a exclusão mútua dos jobs pesados.


## Universe → Mission Control — 24/09/2026

Implementado bridge operacional entre a inteligência cross-channel do Universe e o Mission Control:
- somente gaps ligados a curvas estruturais podem virar oportunidade acionável;
- gaps com demanda hypothesis ou saturação high ficam fora da fila acionável;
- demanda observed + saturação low/medium vira `PILOT READY`;
- demais gaps elegíveis ficam como `INVESTIGAR`;
- cada card mostra curva de origem, target, primeiro teste, razões verificáveis e riscos;
- oportunidades do Universe permanecem separadas de `Production Ready`, que continua exigindo Opportunity Report profundo;
- ordenação baseada em estados de evidência explícitos, sem score opaco.


## Vercel deployment governance — 24/09/2026

Após atingir `build-rate-limit`, o repositório passa a impedir deployments automáticos da Vercel em branches de desenvolvimento.
- `master` continua habilitada para deployment automático;
- demais branches não disparam deployment Vercel;
- validação de branches continua via GitHub CI (`typecheck`, testes e build);
- preview Vercel passa a ser exceção deliberada, não efeito colateral de cada push.

Motivo: preservar quota de deployments para produção e evitar que commits intermediários consumam o limite da conta.


## Gap-Directed DNA — 24/09/2026

Implementado direcionamento de parte do bootstrap de Channel DNA para validar gaps acionáveis do Universe:
- cada lote de 5 DNAs reserva até 2 vagas para canais capazes de validar gaps em estado `INVESTIGAR`;
- as demais vagas continuam usando a prioridade global existente, evitando starvation da descoberta;
- seleção dirigida usa descrição e títulos reais dos uploads recentes, não apenas o cluster bruto;
- match exige múltiplos termos relevantes ou combinação semântica explícita do target;
- famílias de evidência cobrem POV/vida animal e profissões em contexto histórico, mantendo o critério verificável;
- clusters ruidosos não são evidência suficiente;
- nenhum `search.list` adicional é consumido;
- resposta do bootstrap registra `targetedAttempts` para observabilidade.

Motivação observada no Universe real:
- canais como Dinzo, Zoozle, giblixy e Wildlife Professor contêm evidência direta para Animal POV Survival, mas estavam longe do topo da fila global de DNA;
- Historic Dave já possui DNA e evidência de medieval jobs; outros canais de história/profissões podem ampliar a independência do target;
- o Market Intelligence atual está defasado em relação ao número de DNAs persistidos, portanto acelerar a evidência dirigida reduz o tempo até uma nova classificação confiável.


## Universe Gap Evidence Resolver — 24/09/2026

Implementado resolver determinístico de evidência para a recomputação de Curves/Gaps:
- IDs sugeridos pela IA continuam aceitos apenas quando pertencem à amostra válida;
- o backend também procura corroboradores independentes nos títulos e descrições reais dos canais da amostra;
- correspondência usa os mesmos gates conservadores do Gap-Directed DNA;
- ruído de cluster não conta como evidência;
- IDs são deduplicados por criador antes de classificar demanda;
- `partial` só sobe para `observed` quando o backend confirma pelo menos 2 criadores independentes em uma curva estrutural;
- a evidência adicionada pelo backend é registrada em `demandEvidence` para auditoria.

Objetivo: impedir que um gap permaneça subestimado apenas porque o modelo omitiu um channelId que já contém evidência observável no próprio Universe.


## Universe Manual Cycle fallback — 24/09/2026

Preparado fallback operacional autenticado para executar manualmente exatamente o mesmo pipeline do cron diário:
- fila de imports (até 25);
- Channel DNA bootstrap (até 15 / 120s);
- recomputação condicional de Curves/Gaps;
- resumo final da fila.

Cron e ação manual passam a compartilhar `runUniverseCycle()`, evitando divergência entre o caminho automático e o caminho de contingência.
O botão `Executar ciclo completo` fica disponível no Competitor Universe apenas para a operação autenticada.
A ação permanece protegida pelo mesmo `runAiJob`/lease usado pelo cron, portanto não deve executar em paralelo com outro ciclo pesado.


## Self-hosted Universe cutover — 24/09/2026

O caminho crítico do Universe foi movido para o VPS:
- watcher GitHub → VPS restaurado e validado por blue/green;
- produção self-hosted promove apenas SHA que passa health + Supabase;
- a RPC `claim_radar_universe_queue` foi corrigida após erro real de coluna `status` ambígua;
- primeiro ciclo E2E no VPS concluiu: 223 concorrentes válidos, 5 referências inválidas terminais, 29 Channel DNAs;
- 5 referências 404/not-found não entram mais em retry;
- scripts de Universe/Market usam loopback para a porta de produção atual, sem colocar `CRON_SECRET` nos argumentos do processo;
- agendamento recorrente passa a ser `cacadores-universe-cycle.timer` no systemd;
- o cron Universe foi removido de `vercel.json`;
- Vercel deixa de ser dependência do scheduler operacional.

O Gap Evidence Resolver também foi endurecido: palavras genéricas e títulos propostos em `firstTests` não são usados como prova, e IDs sugeridos pela IA só contam como target evidence quando passam pela validação determinística do backend.


## Universe bootstrap terminal-state UX — 24/09/2026

A fila de bootstrap diferencia conclusão operacional de concorrentes válidos:
- `completed` continua significando concorrentes realmente importados;
- falhas 404/not-found com tentativas esgotadas são `terminalFailed`;
- `resolved = completed + terminalFailed`;
- o progresso chega a 100% quando não existe mais trabalho elegível, sem contabilizar entradas inválidas como concorrentes;
- o botão de próximo lote fica desabilitado quando não há pending nem retryable.


## Self-hosted timer guard — 24/09/2026

Hardening operacional aplicado e testado no VPS:
- `cacadores-health-watch` mantém `cacadores-auto-deploy.timer` e `cacadores-universe-cycle.timer` habilitados e ativos;
- teste controlado confirmou recuperação automática após ambos os timers serem parados;
- o Universe timer permanece `Persistent=false`, evitando catch-up pesado ao ser restaurado depois do horário diário;
- wrappers Universe/Market usam loopback para a porta promovida e carregam `CRON_SECRET` somente do ambiente;
- o guard de presença do `CRON_SECRET` foi corrigido;
- scripts e units em produção passam a ser espelhados em `ops/self-hosted/` no repositório.

Motivo: impedir que produção continue saudável em um SHA antigo enquanto o watcher de GitHub fica silenciosamente inativo.


## Gap evidence title-level cooccurrence — 24/09/2026

Após o ciclo manual elevar Channel DNA de 29 para 44, um gap doméstico chegou artificialmente a `observed` porque o resolver somava palavras genéricas espalhadas por descrições e títulos diferentes.

Hardening implementado:
- target evidence passa a considerar coocorrência dentro de um mesmo título recente;
- descrição do canal deixa de funcionar como prova de demanda do target;
- `old` é tratado como packaging genérico;
- singular/plural simples são normalizados (`houses/house`, `rooms/room`, `problems/problem`);
- semantic family matching também exige os sinais dentro do mesmo título;
- regressão real preserva Historic Dave e rejeita Silas Mercer, STUKALIN BUILD e Yakutia Survival Stories para o gap de história doméstica.


## Packaging terms are not target evidence — 24/09/2026

A recomputação pós-hardening revelou um falso `partial` em "Then and Now: Everyday Technology": dois canais de celebridades entraram apenas porque seus títulos continham `then` e `now`.

Correção:
- `then` e `now` passam a ser stop words do evidence resolver;
- títulos precisam conter termos de conteúdo do target, não apenas o formato/packaging;
- regressão garante que um canal de celebridades seja rejeitado e um título com `household + technology` continue elegível.


## Cluster-balanced Channel DNA — 24/09/2026

Auditoria após 44 DNAs revelou forte viés de cobertura nos clusters ainda não analisados:
- History 1/45;
- Education 0/32;
- Explained 0/31;
- Storytelling 0/16;
- Entertainment 0/15;
- Engineering 0/13;
- Animals 0/10.

A seleção de DNA passa a combinar três objetivos:
1. até 2 slots dirigidos a gaps em investigação;
2. cerca de 2/3 dos slots restantes para cobertura dos maiores clusters pendentes, distribuindo o lote entre clusters diferentes;
3. o restante preserva prioridade global por status, sinais, breakout e atividade.

A mesma seleção balanceada é usada no bootstrap diário e no botão/manual/mission de próximo lote DNA. O objetivo é aumentar representatividade sem perder sinais fortes.


## Source cluster + partial-cycle hardening — 24/09/2026

A rodada balanceada elevou Channel DNA de 44 para 59, porém revelou dois problemas operacionais:

1. `cluster` era usado tanto para o cluster de entrada quanto para o nicho refinado pelo DNA. Após gerar DNA, o cluster original era perdido; um refresh posterior podia ainda substituir novamente o refinamento.
2. O wrapper self-hosted encerrava a chamada do ciclo em ~295s. A rodada de 59 DNAs persistiu os 15 novos DNAs, mas a chamada terminou antes de concluir/rejeitar a recomputação de Market Intelligence, deixando o job inteiro como failed apesar do trabalho útil já salvo.

Correções:
- `sourceCluster` passa a guardar o cluster de entrada para cobertura/bootstrap;
- `cluster` permanece o cluster editorial refinado pelo DNA;
- refresh preserva `cluster` quando existe DNA e atualiza `sourceCluster` pela regra pública de ingestão;
- o seletor balanceado usa `sourceCluster`, com fallback para dados legados;
- endpoint autenticado `scope=source-clusters` permite backfill sem `search.list`;
- canais pendentes podem receber `sourceCluster` localmente; canais já com DNA são rechecados pelas APIs públicas de channels/uploads/videos;
- falha apenas na recomputação de Market não invalida bootstrap/DNA já concluídos; o ciclo retorna `marketError` e deixa o Market para retry posterior;
- timeout do wrapper sobe para 390s e o unit systemd para 7 minutos.


## Generic evidence token hardening — 24/09/2026

A recomputação com 59 DNAs revelou dois falsos `partial` em curvas estruturais:
- Wild Horizons validava um gap de caverna apenas por `day + earth`;
- Paint It Simple validava ferramentas de dentistas por `used + ancient` em um vídeo sobre armas.

Correção:
- termos genéricos de embalagem/contexto (`day`, `earth`, `used/use/using`, `ancient`, `iconic`, `greatest`, `strange`, `thing(s)`, `world`) deixam de contar como evidência lexical direta;
- regressões reais exigem termos substantivos do target, como `surviving + cave` ou `dentist + tool`;
- semantic-family rules existentes continuam cobrindo famílias explicitamente modeladas.


## Target-domain evidence contract — 24/09/2026

Depois de 59 Channel DNAs, o último falso `INVESTIGAR` veio de BrainCurious: o título "The Weird Side of Vladimir Putin!" validava indevidamente um gap sobre instituições cotidianas apenas por compartilhar `weird + side`.

Correção estrutural:
- todo novo gap recebe `targetSpace` em INGLÊS, limitado ao domínio de conteúdo do alvo;
- todo novo gap recebe `targetKeywords` com 3–8 substantivos/frases nominais específicos do domínio;
- `targetKeywords` exclui packaging, mecanismo e fórmulas de título;
- evidência lexical direta exige, no MESMO título, pelo menos 1 termo do domínio target e pelo menos 2 sinais relevantes no total;
- semantic-family rules explícitas continuam disponíveis para famílias já modeladas;
- IDs sugeridos pela IA continuam passando pelo mesmo backend validator;
- dados antigos sem `targetKeywords` continuam compatíveis via fallback para `targetSpace`.

Objetivo: separar definitivamente "o formato que chama atenção" do "assunto que comprova demanda no target".


## Phrase-aware target keywords — 24/09/2026

O primeiro Market com `targetKeywords` encontrou um novo falso positivo: War Zone validava `urban fire response` porque os termos internos de `fire engines` e `water pumps` eram quebrados em palavras soltas e coincidiam com um vídeo sobre `engine + fuel pump` de aviões da WW1.

Hardening:
- quando `targetKeywords` existe, cada keyword/frase é validada como sequência semântica dentro do mesmo título;
- `fire engines` não é satisfeito por `engine` isolado;
- `water pumps` não é satisfeito por `fuel pump`;
- singular/plural simples continuam normalizados;
- gaps legados sem `targetKeywords` mantêm o fallback lexical anterior;
- regressão real rejeita War Zone para resposta urbana a incêndio e preserva WhirlTales para `suspension bridges`.

Isso mantém packaging, palavras soltas e domínio-alvo como camadas separadas.


## Universe Market continuity — 24/09/2026

A expansão de 59 para 64 Channel DNAs revelou um problema de memória operacional: uma recomputação substituía integralmente o relatório `universe-market-intelligence:latest`. Um gap acionável podia desaparecer simplesmente porque a próxima amostra/saída da IA escolheu outras curvas, mesmo quando a evidência anterior continuava válida ou havia acabado de ganhar novos corroboradores.

Hardening:
- o Market passa a manter duas gerações persistentes: `latest` e `previous`;
- antes de sobrescrever `latest`, a versão atual é arquivada como `previous`;
- a nova execução reavalia oportunidades acionáveis de `latest` e `previous` contra todos os concorrentes que possuem DNA atual;
- a curva anterior só pode ser carregada se continuar estrutural por criadores independentes ainda válidos;
- o gap anterior só pode ser carregado se o Evidence Resolver atual confirmar demanda `partial` ou `observed`;
- saturação `high` nunca é carregada;
- gaps já presentes na nova execução não são duplicados;
- continuidade é explicitamente registrada em `demandEvidence` e `limitations`.

Caso real usado como regressão:
- `Every Type of Bridge Failure Explained` havia desaparecido da execução seguinte;
- WhirlTales já sustentava `suspension bridges`;
- após DNA dirigido, nknows passou a sustentar `bridge piers`;
- a continuidade deve revalidar os dois criadores independentes e elevar o target de `partial` para `observed`, tornando-o elegível a piloto pela regra existente.


## Target-space domain anchors — 24/09/2026

A primeira execução da continuidade revelou um falso `observed` em `occupational surnames`: Ink Story era aceito pelo fallback semântico de "profissão histórica" mesmo sem evidência de sobrenomes.

Correção:
- gaps com `targetKeywords` explícitos deixam de usar semantic-family como atalho;
- evidência direta pode ser validada por uma keyword/frase completa OU por pelo menos uma âncora lexical do `targetSpace`;
- a mesma unidade/título ainda precisa conter pelo menos dois sinais relevantes no total;
- gaps legados sem `targetKeywords` preservam o fallback semântico para compatibilidade;
- o detalhe persistido diferencia `domínio target`, `âncora do target` e `padrão semântico legado`.

Regressão real:
- `occupational surnames` + Historic Dave: `surname` + `job` no mesmo título continua válido;
- profissão histórica genérica sem `surname/family name/name origin` é rejeitada.


## Mission Control actionable count — 24/09/2026

O Market atual possui 7 gaps acionáveis, porém o Mission Control limitava a consulta a 5 itens e reutilizava o tamanho dessa lista como contador total. Isso fazia o status exibir 5 acionáveis mesmo existindo 7.

Correção:
- o backend calcula até 10 oportunidades acionáveis para obter o total real;
- `market.universeActionableGaps` recebe o total completo;
- a lista visual `universeOpportunities` continua limitada aos 5 melhores cards;
- a mesma regra é aplicada tanto ao Mission Brief recém-gerado quanto à hidratação live de `/api/radar`;
- regressão cobre 7 acionáveis, contador 7 e somente 5 cards renderizáveis.

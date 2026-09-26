# Estado da operação — atualização de 23/09/2026

## Colaboração e estúdio de vídeo

- O operador autorizou um estúdio próprio e exigiu leitura obrigatória, registro prévio, responsável, checklist e baixa para toda tarefa.
- O processo fica em `COLABORACAO.md`, `AGENTS.md`, `CLAUDE.md` e `TODO.md`; o registro desta entrega é `tasks/COLAB-001.json`.
- Durante a implementação, a `master` avançou de `ff17c95` até `d2fbf6dfa03e0d25cea1cd76a556e87a64b2053a`. Esses commits foram incorporados sem reverter os módulos Mission Control, Quota Intelligence ou Universe. O estado anterior abaixo foi preservado.
- `docs/estudio/MAPEAMENTO.md` contém o mapa de 54 recursos, 16 melhorias e fases M0–M4, auditado sobre `ff17c95`. É planejamento: os pontos de integração precisam ser reconferidos contra os módulos que chegaram depois. Próxima tarefa recomendada: essa reconferência e o contrato versionado de projeto/timeline do M0, com reserva prévia.
- Não há estúdio, worker de vídeo ou migração de vídeo implantados por COLAB-001. Provisionamento, quotas e orçamento do estúdio permanecem por definir; o estado real dos serviços não foi reauditado nesta tarefa.
- Na retomada, a conexão GitHub foi confirmada e a branch `task/COLAB-001-governanca-colaborativa` recebeu o registro prévio da tarefa. A base avançou novamente até `69dd27e` e foi incorporada. A validação local atual passou: 25 testes de colaboração, 30 testes da plataforma, typecheck e build. Consulte o PR da tarefa para o estado de CI/integração; isso não certifica deploy.
- A API confirmou `master` sem proteção e nenhuma ruleset em 23/09/2026. O conector não possui acesso administrativo à proteção de branch (403). A ativação das regras da seção 8 de `COLABORACAO.md` continua pendente; CI versionada não significa bloqueio obrigatório de merge.

## Estado integrado antes desta entrega

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


## Universe Opportunity Families — 24/09/2026

Com 64 Channel DNAs e continuidade habilitada, o Market atual expôs dois `PILOT READY` no mesmo domínio de pontes:
- `Every Type of Bridge Failure Explained`;
- `How History's Most Dangerous Bridges Failed`.

Os dois compartilham Sabin Civil Engineering e nknows como evidência central, mas usam curvas editoriais diferentes.

Correção:
- oportunidades acionáveis são agrupadas em famílias quando compartilham pelo menos 2 canais de evidência e ao menos 1 token substantivo de domínio;
- o card mais forte permanece como oportunidade principal;
- os demais são preservados como `alternateAngles`;
- `universeActionableGaps` passa a contar todas as famílias acionáveis, enquanto a UI continua limitada aos 5 melhores cards;
- apenas compartilhar um canal não agrupa targets distintos.

Resultado esperado no caso real: bridge engineering aparece como 1 família PILOT READY, com o ângulo histórico de falhas mostrado como alternativa editorial.


## Universe Pilot Decisions — 24/09/2026

A primeira família `PILOT READY` real do Universe revelou uma lacuna de workflow: o Mission Control conseguia recomendar um piloto, mas não havia ação persistente para o operador aprovar ou rejeitar esse teste.

Implementação:
- nova ação autenticada `universePilotDecision`;
- aprovação/rejeição só é aceita se o gap ainda estiver `PILOT READY` no Market atual;
- se a oportunidade deixar de ser acionável ou cair para `INVESTIGAR`, a API responde 409 e não grava aprovação;
- decisão é persistida no ledger `radar_decisions` com `kind: universe-pilot`;
- cada decisão registra snapshot do Market no momento da escolha: generatedAt, título, target, readiness, demand, saturação, criadores independentes, quantidade de evidências, primeiro teste e ângulos alternativos;
- o Mission Control exibe `Aprovar piloto` e `Não seguir` apenas nos cards `PILOT READY`;
- após a decisão, o card mostra o status e motivo persistidos;
- o histórico continua no ledger de decisões da operação.

A decisão continua humana: o backend apenas verifica se a evidência ainda satisfaz os gates antes de registrar a escolha.


## Gap-directed DNA candidate retrieval — 24/09/2026

Após o Evidence Resolver ficar mais conservador, o mesmo gate rígido ainda era usado para decidir quais canais pendentes mereciam Channel DNA. Isso reduzia eficiência de descoberta: um canal podia ser semanticamente promissor para investigação sem ainda satisfazer o padrão exigido para contar como evidência de demanda.

Separação implementada:
- `universeGapEvidenceMatch` continua sendo o único gate que pode alimentar `targetEvidenceChannelIds`, `partial`, `observed` e `PILOT READY`;
- novo `universeGapDnaCandidateMatch` é usado somente para escolher onde gastar slots de DNA;
- candidato pode entrar por uma keyword do target, âncora de targetSpace ou sobreposição lexical relevante, mesmo sem passar o gate final;
- candidatos que já passam o evidence gate continuam com prioridade máxima;
- depois vêm número de gaps relacionados, força do sinal candidato e prioridade global do canal;
- nenhuma seleção de candidato altera demanda ou evidência por si só.

Regressão real: um título com `shipwreck` pode ser investigado para `historic ocean liners`, mas continua fora da evidência determinística enquanto não houver sinais suficientes no mesmo título.


## Gap DNA candidate noise hardening — 24/09/2026

O primeiro lote real com candidate retrieval amplo gerou 5 DNAs e elevou o Universe de 64 para 69. A auditoria mostrou que os prováveis slots dirigidos foram contaminados por duas âncoras genéricas:
- The Seventh Key: `flood` em contexto mitológico;
- Timber Time: `coastal` em contexto de reforma de mansão.

Correção:
- uma keyword/frase completa de `targetKeywords` continua suficiente para selecionar um candidato de DNA;
- uma âncora isolada de `targetSpace` não é suficiente;
- âncoras passam a exigir combinação: >=2 âncoras no mesmo título ou 1 âncora + >=2 sinais lexicais relevantes;
- gaps legados continuam no matcher estrito;
- Evidence Resolver e gates de demanda permanecem inalterados.

Regressões reais:
- `Before the Flood` não é candidato para coastal flood defenses;
- `Luxury Coastal Retreat` não é candidato para coastal flood defenses;
- `shipwreck` continua candidato válido para investigar historic ocean liners, sem virar evidência automaticamente.


## Generic single-keyword candidate guard — 24/09/2026

O segundo lote de campo após o hardening elevou Channel DNA de 69 para 74 e revelou outro ruído nos dois primeiros slots dirigidos:
- The Mindful Path with Wisdom entrou por `kitchen`, mas seu DNA é Self Improvement / Japanese Lifestyle Habits;
- mesigugu entrou por `bathroom`, mas seu DNA é Short-Form Entertainment / Absurdist Micro-Sketches.

Correção:
- keywords unitárias genéricas de ambiente doméstico (`kitchen`, `bathroom`, `household`, `home`, `house`, `room`) deixam de ser suficientes isoladamente para gastar um slot de DNA;
- elas precisam coexistir com pelo menos outro sinal relevante no mesmo título;
- keywords multiword continuam fortes;
- keywords unitárias semanticamente específicas, como `shipwreck`, continuam suficientes para investigação;
- Evidence Resolver permanece inalterado.

Regressões reais:
- `Japanese Kitchen Rules` não vira candidato de domestic infrastructure;
- `boys bathroom` não vira candidato de domestic infrastructure;
- `Old Kitchen Plumbing ... Drain Systems` vira candidato;
- `shipwreck` continua candidato para historic ocean liners.


## Weak target-space anchor hardening — 24/09/2026

A recomputação com 79 DNAs revelou dois falsos `observed` causados por âncoras amplas do `targetSpace`:
- `abandoned railway stations`: gas/fire station e abandoned train/rails foram tratados como dois criadores do target;
- `medical history / plague doctors`: um título genérico com `doctor + medical + history` foi tratado como segunda evidência de plague doctors.

Correção:
- âncoras amplas/ambíguas (`station`, `medical`, `abandoned`, `historic`, `ocean`, `coastal`, `flood`, `household`, `domestic`, `infrastructure`, `object`, `urban`) não validam demanda sozinhas;
- uma frase completa de `targetKeywords` continua válida;
- âncoras substantivas específicas como `surname` e `bridge` continuam válidas quando têm apoio lexical no mesmo título;
- semantic-family fallback continua apenas para gaps legados sem targetKeywords.

Regressões reais:
- gas station e abandoned train não validam abandoned railway stations;
- doctor + medical/history não valida plague doctors;
- railway station explícita valida;
- surname + job e bridge + engineering continuam válidos.


## Universe Pilot Brief — 24/09/2026

O fluxo `PILOT READY` já exigia decisão humana, mas a aprovação terminava apenas no ledger `radar_decisions`. Não existia ainda um plano operacional persistente para transformar a decisão em um teste controlado.

Implementação:
- aprovação humana continua obrigatória; nenhuma oportunidade é aprovada automaticamente;
- a decisão `approved` passa a incluir atomicamente um `UniversePilotBrief` persistido no mesmo registro de decisão;
- rejeição continua sem criar brief;
- o brief congela o snapshot do Market usado na decisão: curve, gap, target evidence, demand status, saturation, supporting channels e demand evidence;
- registra hipótese de transferência, primeiro episódio, ângulos alternativos, riscos, mecanismo preservado e variável alterada;
- success gates não inventam CTR, retenção, views ou percentuais: exigem publicação controlada, comparação apenas contra baseline real do canal próprio quando disponível e feedback pós-publicação;
- stop gates impedem escala se revisão factual falhar, se não houver evidência real do canal próprio ou se o Market perder PILOT READY antes da produção;
- próximo gate explícito: `produce-one-pilot`;
- Mission Control mostra o Pilot Brief dentro do card depois da aprovação.

A persistência fica atômica porque decisão + brief são um único payload em `radar_decisions`, evitando decisão aprovada sem plano correspondente.


## Full-DNA gap evidence resolution — 24/09/2026

Com 109 Channel DNAs persistidos, a auditoria mostrou que curvas e gaps novos ainda compartilhavam a mesma amostra máxima de 40 canais. Isso era correto para extração de curvas, mas subutilizava a cobertura já existente ao validar demanda do target: um corroborador válido fora dos 40 canais podia não contar na primeira classificação do gap.

Correção:
- curvas continuam extraídas de uma amostra balanceada de até 40 canais para manter custo e prompt controlados;
- o Evidence Resolver de cada gap novo passa a revalidar target evidence contra TODOS os concorrentes que já possuem Channel DNA;
- IDs sugeridos pela IA continuam limitados à amostra recebida pelo modelo;
- corroboradores adicionais só entram se passarem pelo matcher determinístico atual;
- `sourceCompetitorIds` passa a incluir também target evidence válida encontrada fora da amostra;
- o relatório registra explicitamente o tamanho da amostra de curvas e o tamanho do pool completo de DNA usado para validar gaps;
- regressão cobre um segundo criador válido de bridge engineering fora da amostra de extração.

Objetivo: aumentar uso real dos DNAs já pagos/coletados sem aumentar o tamanho do prompt de Curves/Gaps e sem relaxar os gates conservadores de evidência.

## Deterministic Market evidence fallback — 24/09/2026

A recomputação do Market com 109 DNAs falhou externamente por HTTP 429 da OpenAI. O relatório anterior permaneceu íntegro, mas isso revelou que a atualização de confiança dos gaps ainda dependia desnecessariamente da IA.

Hardening:
- `UniverseMarketIntelligence` passa a separar `generatedAt` (quando curvas/gaps foram gerados por IA) de `evidenceRevalidatedAt` / `evidenceDnaCount` (quando a evidência foi rechecada deterministicamente);
- após cada bootstrap de Channel DNA, os gaps atuais são revalidados contra todos os canais que possuem DNA, sem chamada à OpenAI;
- essa revalidação pode promover `partial -> observed` ou rebaixar evidência que deixou de passar pelo matcher atual;
- curvas não são criadas, removidas ou reinterpretadas nessa etapa;
- `scope=market-evidence` permite executar somente a revalidação determinística;
- o cron `scope=market` continua tentando descobrir novas curvas/gaps por IA, mas se a chamada falhar executa o fallback determinístico e retorna `marketError` junto do Market revalidado;
- o timestamp original da geração por IA é preservado, portanto uma falha externa não é mascarada como recomputação completa;
- `shouldRefreshUniverseMarketIntelligence()` continua considerando a geração por IA, de modo que a descoberta completa será tentada novamente em execução futura.

Objetivo: manter Mission Control e os gates `INVESTIGAR/PILOT READY` atualizados com a evidência já coletada mesmo durante indisponibilidade, rate limit ou quota da OpenAI.

## Evidence anchor + audit hygiene — 24/09/2026

A primeira execução do fallback determinístico com 109 DNAs revelou um falso `INVESTIGAR`: `historic building details` foi sustentado por Webhead Lore, canal de Marvel, apenas porque seus títulos continham `detail`/`level detail`.

Correções:
- `building` e `detail` passam a ser âncoras fracas de `targetSpace`; isoladamente não validam demanda;
- frases completas de `targetKeywords`, como `historic buildings`, continuam elegíveis quando realmente aparecem no mesmo título;
- a revalidação determinística remove linhas antigas geradas pelo resolver (`Sugestão da IA validada...` e `Corroboração do backend...`) antes de inserir a evidência atual;
- contexto editorial original da análise permanece preservado;
- regressão real rejeita Webhead Lore para arquitetura histórica;
- regressão garante que um ID removido do evidence set também desapareça do texto auditável.

Objetivo: impedir que o ledger textual contradiga `targetEvidenceChannelIds` e evitar promoção baseada em palavras genéricas de embalagem.


## Universe Pilot → Content OS handoff — 24/09/2026

O Pilot Brief aprovado passa a ter um gate explícito de handoff para o pipeline de produção já existente.

Regras:
- nenhum handoff ocorre automaticamente ao aprovar o piloto;
- o operador escolhe explicitamente um canal próprio no Mission Control;
- o backend revalida que o gap continua `PILOT READY` no Market atual antes de criar qualquer artefato;
- canais `competitor` são rejeitados como destino;
- um mesmo `decisionId` gera no máximo um Content Project; retries/duplo clique reutilizam o projeto existente;
- o handoff cria um episódio `idea` e um Content Project `draft`;
- `opportunityId` do Content Project recebe o `decisionId`, garantindo provenance e idempotência;
- o brief recebe target, hipótese, mecanismo preservado, variável alterada, evidência e riscos do Universe Pilot Brief;
- `promise` permanece vazia para exigir revisão editorial do canal;
- um fact-check `unverified` é criado obrigatoriamente, bloqueando aprovação para roteiro até pesquisa/fonte rastreável;
- Script Engine, produção e publicação não são acionados pelo handoff;
- após o handoff, o Mission Control mostra o canal de destino e permite abrir diretamente a aba Content OS;
- a decisão persiste `pilotHandoff` com channelId, episodeId e contentProjectId.

Objetivo: conectar discovery → decisão humana → Content OS sem criar um pipeline paralelo e sem pular os gates já existentes de pesquisa, fact-check e aprovação.


## Assisted-manual operating model — 24/09/2026

Decisão operacional vigente:
- a plataforma permanece tecnicamente completa, com APIs, Supabase, GitHub, VPS, endpoints manuais e credenciais preservados;
- nenhuma inteligência editorial deve rodar autonomamente;
- nenhum Channel DNA, Market Intelligence, análise profunda, Opportunity Report, Pilot Brief, Content OS, Script Engine, produção, render, learning loop ou publicação é iniciado apenas por relógio;
- `cacadores-universe-cycle.timer` e `cacadores-market-intelligence.timer` ficam desabilitados;
- timers de sync dos workers de episode automation, closed loop, render e YouTube publish ficam desabilitados;
- os workers persistentes correspondentes ficam parados quando não estão sendo usados;
- continuam automáticos somente `cacadores-health-watch.timer`, `cacadores-auto-deploy.timer` e `cacadores-maintenance.timer`, além das rotinas normais do sistema operacional;
- o health-watch respeita o arquivo runtime `/srv/auditseo-deploy/state/cacador-de-nicho-operation-mode.json` e não pode religar Universe/Market quando `mode=assisted-manual`;
- a operação passa a ser conduzida pelo operador em conjunto com ChatGPT: ao receber comandos como “rode a operação da manhã/tarde/noite”, ChatGPT deve inspecionar o estado live, identificar o trabalho realmente necessário, executar somente os passos explicitamente úteis e retornar os achados para decisão conjunta;
- APIs de IA continuam disponíveis como ferramenta/fallback deliberado, mas nenhuma chamada paga deve ser disparada automaticamente;
- o gate humano de piloto permanece obrigatório e nenhuma decisão é tomada em nome do operador.

Motivação: preservar caixa enquanto os canais ainda não geram receita, aproveitar análise assistida sob demanda e eliminar gasto de IA causado apenas por cadência de scheduler.

## Source & Asset Intelligence — foundation / R2 + media providers — 24/09/2026

Objetivo aprovado antes do takeoff:
- transformar oportunidade aprovada em produção pesquisada, visualmente rica e rastreável;
- combinar material próprio, arquivo histórico, stock licenciado e geração por IA sem depender de uma única origem;
- construir um Asset Vault reutilizável como patrimônio da operação;
- manter integrações de bancos de imagem/vídeo e storage centralizadas em Configurações.

Fundação implementada nesta etapa:
- nova abstração híbrida media-storage;
- Cloudflare R2 passa a ser o storage preferencial para mídia nova quando configurado;
- caminhos R2 são persistidos com prefixo r2: para permitir resolução determinística;
- assets legados sem prefixo continuam sendo lidos/removidos pelo Supabase Storage cacadores-media;
- ausência de R2 configurado mantém o comportamento legado sem migração destrutiva;
- Asset Factory, Voice Engine, Audio Library, Media Library, Timeline, thumbnails de publicação, Render output e Production QA passam a resolver mídia pela mesma abstração;
- Render Worker lê fontes R2 e grava o MP4 final no R2 quando configurado;
- YouTube Publish Worker lê render/thumbnail tanto de R2 quanto do storage legado;
- credenciais de R2 ficam cifradas no Supabase Vault como cloudflare_r2_config; workers reutilizam o mesmo cofre, sem duplicar segredos em arquivos locais;
- Configurações recebe formulário de Cloudflare R2 com Account ID, Access Key ID, Secret Access Key, bucket e Public URL opcional;
- o teste de conexão usa o bucket real antes de salvar a configuração.

Stock Media:
- Pexels e Pixabay permanecem integrados e copiáveis para o storage privado com provenance/licença;
- Unsplash passa a estar configurável e pesquisável via API oficial;
- previews do Unsplash usam os URLs hotlinked retornados pela API e preservam autor/origem;
- nesta etapa, Unsplash é discovery-only: cópia automática para R2 fica bloqueada porque a API exige hotlink. O futuro External Asset Resolver deverá preservar hotlink, download tracking e atribuição antes de permitir uso produtivo;
- Videezy aparece em Configurações como fonte manual; não é feito scraping nem é presumida uma API oficial. Assets só devem entrar após conferência individual de licença/atribuição.

Princípio de produção:
- o sistema escalável é editorial, não um template de vídeo;
- cada episódio deve preservar pesquisa, narrativa original, variação visual e provenance;
- prioridade de sourcing: Asset Vault próprio → arquivos/open media → stock licenciado → geração por IA quando necessária;
- nenhum mix de stock/IA/narração é tratado como garantia de monetização ou imunidade a políticas de plataforma.

Compatibilidade e segurança:
- nenhuma migração destrutiva dos assets atuais;
- nenhum segredo de R2 é retornado ao navegador;
- modo assisted-manual permanece vigente;
- configurar R2 não habilita workers/timers automaticamente;
- nenhuma produção/publicação é disparada por esta implementação.

Validação:
- TypeScript: PASS;
- suíte: 268/268 PASS;
- Next.js production build: PASS;
- git diff --check: PASS.

## Source Intelligence + Research Pack — Content OS — 25/09/2026

Objetivo:
- transformar pesquisa assistida em um dossiê editorial estruturado antes do Script Engine;
- diferenciar fato sustentado, descoberta, contexto, evidência anedótica e lead visual;
- permitir Wikipedia, Reddit, arquivos, fontes institucionais e outras origens sem misturar seus papéis;
- preservar direitos/proveniência dos visuais desde a pesquisa, antes de chegar ao Scene/Asset pipeline.

Content OS:
- ContentResearchSource passa a registrar opcionalmente origin e role;
- origens suportadas: institucional, acadêmica, arquivo, Wikipedia, Reddit, notícia, referência e outra;
- papéis suportados: evidência, descoberta, contexto, anedótica e visual;
- novo Research Pack dentro do próprio Content Project, sem pipeline paralelo e sem migration destrutiva;
- Research Pack guarda:
  - pergunta de pesquisa;
  - ângulo narrativo;
  - entidades-chave;
  - cronologia com referências explícitas às fontes;
  - audience signals com fonte, tipo e notas;
  - leads visuais com provider, mídia, período, local, direitos, licença, atribuição e notas;
  - provenance opcional da pesquisa assistida.

Gates:
- referências quebradas entre Research Pack e fontes bloqueiam aprovação para roteiro;
- direitos visuais unknown são visíveis como alerta, mas não bloqueiam o pre-script gate porque o asset ainda é apenas candidato;
- Scene/Asset pipeline continua responsável pela aprovação do asset realmente usado;
- Reddit/comunidade permanece evidência anedótica/editorial por padrão;
- o Script Engine recebe Research Pack como contexto, mas continua autorizado a tratar como fato apenas claims sustentados pelo fact-check.

UI:
- Pesquisa & Fontes ganha classificação de origem e papel;
- nova aba Research Pack no Content OS;
- operador pode editar pergunta, ângulo, entidades, cronologia, sinais humanos e leads visuais;
- contador de referências quebradas e direitos visuais desconhecidos aparece no readiness do projeto.

Compatibilidade:
- research.pack é opcional; Content Projects anteriores continuam válidos;
- nenhum projeto é aprovado automaticamente;
- nenhuma pesquisa, script, produção ou publicação é iniciada por esta mudança;
- modo assisted-manual permanece intacto.

Validação:
- TypeScript: PASS;
- suíte: 271/271 PASS;
- Next.js production build: PASS (5,4 s compile);
- sem alteração de schema SQL.

## Source Intelligence + Research Pack + Asset Vault semântico — 25/09/2026

Objetivo:
- transformar oportunidade aprovada em dossiê editorial estruturado antes do roteiro;
- separar descoberta, contexto humano e evidência factual;
- tornar a Media Library um Asset Vault reutilizável entre canais;
- bloquear produção quando direitos/proveniência visual forem insuficientes ou a repetição for extrema.

Content OS / Source Intelligence:
- Content Project passa a aceitar research.pack estruturado;
- fontes ganham origin e role;
- origens suportadas: institutional, academic, archive, wikipedia, reddit, news, reference, other;
- papéis suportados: evidence, discovery, context, anecdotal, visual;
- Research Pack inclui pergunta de pesquisa, story angle, entidades, cronologia, audience signals, visual leads e provenance;
- cronologia e audience signals preservam referências por source ID;
- visual leads preservam provider, URL de origem, período, local, tipo de mídia, rights status, licença e atribuição;
- Script Engine recebe Research Pack como contexto editorial;
- audience signals entram explicitamente como sinais anedóticos, não como fatos;
- claims supported não podem depender somente de Reddit/Wikipedia ou fontes marcadas como anecdotal/discovery/context;
- pelo menos uma fonte de evidência forte deve sustentar um fact-check supported;
- referências quebradas do Research Pack bloqueiam aprovação do Content Project;
- direitos desconhecidos em visual leads são exibidos como risco pré-produção, mas não bloqueiam o roteiro.

Asset Vault:
- Media Library pode alternar entre Canal atual e Vault global;
- Vault global pesquisa assets prontos de todos os canais;
- cards preservam o canal de origem;
- metadados semânticos estruturados adicionados: subjects, locations, periods, shotTypes e moods;
- busca textual passa a consultar nome, canal, tags, prompt e todos os campos semânticos;
- metadata continua retrocompatível: clientes antigos podem omitir semantic;
- Supabase recebeu coluna radar_media_library_metadata.semantic jsonb;
- schema oficial foi atualizado de forma idempotente;
- radar_stock_searches foi atualizado para aceitar unsplash no ledger de buscas.

Production Authenticity Gate:
- cobertura visual continua blocker quando há buracos na Timeline;
- integridade/proveniência continua blocker quando asset não existe, não está ready ou diverge da cena/storage;
- novo check asset-rights bloqueia render com base de uso/licença ausente ou unknown;
- reutilização moderada continua warning;
- repetição extrema (>=8 clips e >=87,5% de duplicação) vira blocker;
- o gate não afirma monetização nem conformidade automática com políticas externas; ele mede sinais controláveis da nossa produção.

Arquitetura operacional:
- trabalho desenvolvido em worktree isolado para não competir com auto-deploy;
- nenhuma automação editorial/produção/publicação foi habilitada;
- modo assisted-manual continua sendo o modelo operacional.

## Vecteezy API — Stock Media não-IA — 25/09/2026

Correção de provider:
- a integração desejada é Vecteezy, não Videezy;
- o card manual do Videezy foi removido de Configurações;
- Vecteezy passa a ser provider real do Stock Media Engine.

Credenciais:
- Configurações recebe ID numérico da conta + Chave Secreta;
- a API V2 usa o ID no path e a Chave Secreta como Bearer token;
- a configuração é validada contra /v2/{account_id}/account/info antes de ser persistida;
- ID + secret são serializados como vecteezy_config e cifrados no Supabase Vault;
- o navegador nunca recebe a configuração de volta.

Busca:
- fotos e vídeos suportados;
- busca usa /v2/{account_id}/resources;
- ai_generated=false é enviado para priorizar exclusivamente conteúdo não gerado por IA;
- license_type=commercial e family_friendly=true são enviados;
- quota restante é lida do header X-QUOTA-REMAINING;
- previews são usados somente como resultados temporários, não persistidos como URLs permanentes.

Download e provenance:
- asset só é baixado quando o operador escolhe Usar nesta cena;
- o servidor reconsulta o resource ID e usa o endpoint oficial /download;
- URL assinada é usada imediatamente e não persistida;
- requires_attribution e required_attribution_url são registrados no metadata/licença;
- o arquivo selecionado é copiado para o storage privado, preferindo Cloudflare R2;
- o asset entra na cena com provider=vecteezy e source_type=stock.

Política operacional:
- Vecteezy não será usado para download em massa ou stockpiling;
- downloads devem estar vinculados a episódio/cena/projeto real ou iminente;
- Asset Vault preserva assets já usados em projetos, mas não serve para aspirar especulativamente a biblioteca Vecteezy;
- nenhuma automação editorial, render ou publicação foi habilitada.


## Visual Intelligence Engine — Segment-level media indexing — 25/09/2026

Objetivo:
- fazer o Asset Vault entender o conteúdo visual dentro de vídeos, não apenas nome/metadata do provider;
- indexar trechos temporais semanticamente úteis;
- permitir que Timeline/Render usem o trecho correto em vez de iniciar todo vídeo em 0s.

Modelo de dados:
- Asset = arquivo físico original preservado no R2;
- Segment = intervalo temporal semanticamente indexado dentro do Asset;
- Clip = trecho efetivamente escolhido para uma cena da Timeline.

Implementação:
- radar_asset_visual_analysis: estado/modelo/título enriquecido por asset;
- radar_asset_segments: segmentos com start/end, keyframe, título, resumo, confiança e semântica;
- detecção local de mudança de cena via FFmpeg;
- fallback divide trechos longos em janelas de até ~8s e limita análise a 24 segmentos por asset;
- 1 keyframe representativo por segmento;
- visão via Google AI/Gemini, acionada manualmente por asset;
- modelo é resolvido dinamicamente; em 25/09/2026 o teste real selecionou gemini-3.5-flash-lite;
- nenhuma análise automática/batch é ativada.

Semântica por segmento:
- subjects, locations, landmarks, activities, objects, environments;
- timeOfDay, weather, shotTypes, cameraMotion, moods, visualStyle, periods;
- confidence.

Asset Vault:
- análise agrega tags/semântica úteis ao metadata existente;
- busca normal passa a encontrar vídeos pelo que aparece dentro deles;
- card do vídeo usa asset_title enriquecido quando a análise está concluída;
- detalhe do vídeo mostra segmentos e timecodes;
- botão Analisar frames é manual e pode reanalisar o asset.

Timeline:
- TimelineVisualAssetRef aceita sourceStartSeconds/sourceEndSeconds;
- na criação de uma nova Timeline, vídeo selecionado com segmentos analisados é comparado com narração + intenção visual + prompt;
- matcher escolhe o melhor segmento;
- clip nasce com o source trim correspondente;
- arquivo original permanece inteiro no R2;
- Render Engine já respeitava sourceStart/sourceEnd, então não há duplicação física do vídeo.

Teste real:
- asset Vecteezy: 6259f327-bc5b-4db7-bda9-42836e86f8c2;
- arquivo: 17.916667s / 1920x1080 / ~126 MB;
- Visual Intelligence criou 3 segmentos:
  1. 0.00–5.97 — night highway driving / traffic;
  2. 5.97–11.94 — night expressway driving;
  3. 11.94–17.92 — empty highway / minimal traffic / distant lights;
- título agregado: Highway — Driving — Night;
- busca do Vault encontrou o asset por night, traffic, highway, driving e pov;
- query de cena “almost empty highway at night with minimal traffic and distant glowing lights” selecionou segmento 3;
- para cena de 5s retornou source trim 11.94 → 16.94, score 0.779.

Validação:
- TypeScript PASS;
- 280/280 testes PASS;
- Next.js production build PASS;
- git diff --check PASS.

Escopo futuro:
- embeddings vetoriais podem complementar o matcher lexical;
- batch/worker de ingestão só deve ser implementado após provar necessidade e orçamento;
- exact-location / viewpoint matching para Then & Now permanece próxima camada especializada, sem inferir landmarks sem evidência visual.

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

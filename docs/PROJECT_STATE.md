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

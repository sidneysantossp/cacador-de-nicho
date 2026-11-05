# Incident Ledger — recuperação segura (piloto de 05/11/2026)

## Objetivo
Dar contexto de projeto, diagnosticar execuções abandonadas sem falsos positivos e evitar que o operador marque um problema como resolvido sem evidência. **Sem reativar automação global, reiniciar renders ou fechar incidentes automaticamente.**

## Diagnósticos de leitura
- `running` ou `active` com atualização há pelo menos 2 horas **e sem lease vivo**: `stale` (suspeita operacional; confirmar worker antes de agir).
- `running` ou `active` com lease válido: `leased`, não rotular como abandonado.
- `waiting`: uma espera por condição, mídia ou aprovação, **não** um job abandonado.
- `completed`: execução terminou, mas o incidente não é encerrado automaticamente.
- Nomes dos projetos são lidos de `radar_managed_channels.payload.name`; diagnósticos de execuções vêm de `radar_episode_automation_runs`.
- A associação é feita por `entity_id=run.id` **e** `channel_id` coincidente para evitar misturar projetos.

## Encerramento protegido
- Para incidentes de `episode-automation`, `Resolver` no frontend só é habilitado se o run estiver `completed`, não possuir lease vivo e a atualização do run for igual ou posterior à última ocorrência do incidente.
- O backend **repete independentemente** a mesma validação, retornando HTTP 409 se a recuperação não estiver comprovada.
- Para outros subsistemas, mantém-se o mecanismo anterior de resolução manual, agora com confirmação explícita no frontend.
- `Ignorar` exige confirmação visual e apenas altera o estado do registro; não corrige o problema nem reinicia um job.
- Nenhuma ação reativa automaticamente o Control Plane.

## Base observada em 05/11/2026 — consulta somente leitura
- 6 incidentes no ledger: 5 abertos (1 crítico) e 1 resolvido. Nenhum pertence ao Elétrico em Movimento.
- `Metropolis Mechanics`: `waiting/visual-assets` (mapa autêntico ainda não selecionado).
- `GTA VI — Intelligence Lab`: `waiting/packaging` (erros antigos de disco e reserva de variantes).
- `Car Electrical Doctor — PILOTO`: `running/render` desde 07/10 sem lease válido (**stale**, não retomar automaticamente).
- `Crescendo com a Ketlyn — E2E`: `completed/done` (possível revisão de encerramento, somente após revisar evidência QA).
- `Then & Now Lab`: `active/quality` desde 28/09 sem lease válido (**stale**, não retomar automaticamente); incidente de PNG/JPEG já foi resolvido.
- Pausa global permanece ativa. Nenhum dos incidentes teve nova ocorrência nas 24h anteriores à auditoria.

## Procedimento do operador
1. Verificar o projeto, o status/etapa do run e a data da última ocorrência.
2. Para `stale`: inspecionar worker, event log e leases. Decidir o tratamento apropriado antes de qualquer transição manual.
3. Para `waiting`: resolver o requisito editorial/visual/infra; não forçar `resolved` enquanto o run estiver incompleto.
4. Para `completed`: validar relatório Production QA, arquivos/hashes e ausência de novos problemas; só então usar `Resolver`.
5. Não usar `Ignorar` para ocultar falhas não investigadas.

## Validação
```powershell
npm run typecheck
node_modules\.bin\tsx.cmd --test tests\autopilot-incident-diagnostics.test.ts tests\autopilot-control.test.ts tests\episode-automation.test.ts
npm run build
```

A melhoria é de observabilidade e encerramento seguro; **não implementa retry automático de mídia, render ou geração**. Essas mudanças devem ter PRs dedicados e testes de integração próprios.

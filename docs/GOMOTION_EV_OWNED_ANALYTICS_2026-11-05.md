# Elétrico em Movimento — métricas proprietárias por API (read-only)

## Escopo

A rota `GET /api/gomotion-youtube/analytics` é exclusiva de `UCVqoM3LGRS2nrfKk2CzeXjQ`. Exige o mesmo header privado da ponte já implantada. Não possui métodos de escrita, acesso a upload, edição, publicação ou criação de jobs.

1. Verifica segredo, ID configurado, vínculo do projeto, conexão principal e escopo `yt-analytics.readonly`.
2. Carrega/renova o token **apenas em memória no backend** e confirma a identidade pelo `channels.list?mine=true`.
3. Consulta `reports.query` do YouTube Analytics para dois períodos completos de 7 e 28 dias, encerrados na data UTC de ontem. O YouTube pode consolidar métricas com atraso; datas solicitadas não garantem completude.
4. Consulta `channels.list` / `playlistItems.list` para obter até 5 IDs/títulos/datas de vídeos recentes **do próprio canal**.
5. Retorna somente campos permitidos. Não inclui token, e-mail, refresh token, receita, CTR ou impressões. Não grava banco.

## Semântica

- `windows[].status=available`: a API devolveu uma linha. Métricas numéricas são exibidas como retornadas.
- `windows[].status=no-rows` e `metrics=null`: não há dados para aquele intervalo; **não** apresentar como zero views.
- `latestVideos` pode ter menos de cinco itens se o canal tiver menos vídeos.
- A partir de 2026-11-05, o projeto Caçadores tem 0 episódios e 0 observações de performance persistidos. Esta rota não inventa links com episódios nem força backfill.
- Formato de resposta: `gomotion-owned-channel-analytics-v1`; validação de origem e do `youtubeChannelId` obrigatória no consumidor.

## Segurança e homologação

- Manter `Autopilot=paused`, jobs diários desligados e `publicationAuthorized=false` no GoMotion.
- Sem segredo: HTTP 401. Segredo ausente no servidor: HTTP 503. Canal errado, escopo ausente ou token de outro canal: HTTP 409.
- Se o Google rejeitar a API: HTTP 502 com erro genérico; não escrever resposta da Google nem tokens nos logs.
- Validar em Docker Linux e contêiner temporário. Somente depois fazer deploy blue/green com rollback, preservando timers.
- As métricas não autorizam produção automaticamente: decisões de título/thumbnail, revisão factual e QA permanecem gates independentes.

## Testes

```
npm run typecheck
npx tsx --test tests/gomotion-owned-analytics.test.ts tests/gomotion-youtube-bridge.test.ts
npm run build
```

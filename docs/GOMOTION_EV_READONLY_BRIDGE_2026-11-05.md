# Elétrico em Movimento — Ponte Caçadores → GoMotionStudio somente leitura

## Escopo

Piloto exclusivo do canal YouTube **Elétrico em Movimento**: `UCVqoM3LGRS2nrfKk2CzeXjQ`.

Esta versão inclui **apenas** `GET /api/gomotion-youtube` e política de escopo/secreto. Não inclui `POST`, edição de vídeos, geração de uploads, alteração de título/descrição, ativação de jobs ou publicação. O PR #258 permanece separado para revisão futura da edição humana.

## Pré-requisitos

- A conta Google deve ser autorizada dentro do projeto Caçadores `Elétrico em Movimento`, com confirmação na interface após OAuth. A identidade retornada **deve ser** `UCVqoM3LGRS2nrfKk2CzeXjQ`. Não confirmar `UC2DFMulDl9YpjDoM0iZf3Pw` (`Guia das Bancas`).
- O canal deve estar com status `connected` em `radar_youtube_channels`.
- O segredo compartilhado deve ter ao menos 32 caracteres, aleatório, exclusivo, protegido por permissões de arquivo e nunca persistido em logs ou Git.

## Configuração privada

Caçadores na VPS:
- `GOMOTION_BRIDGE_SECRET`: segredo aleatório exclusivo.
- `GOMOTION_BRIDGE_YOUTUBE_CHANNEL_ID=UCVqoM3LGRS2nrfKk2CzeXjQ`

GoMotionStudio no Windows:
- `CACADORES_BRIDGE_BASE_URL=https://cacadores.159.198.40.98.sslip.io`
- `GOMOTION_BRIDGE_SECRET`: mesmo segredo.
- `CACADORES_YOUTUBE_CHANNEL_ID=UCVqoM3LGRS2nrfKk2CzeXjQ`

O GoMotion só acessa o endpoint via HTTPS e valida a identidade devolvida. Não aceita fallback para qualquer outro canal.

## Leitura e proveniência

`GET /api/gomotion-youtube` devolve `connected`, informações de identificação, escopos concedidos, no máximo 12 snapshots armazenados de YouTube Analytics e 12 jobs existentes. **Não busca dados novos no Google**, nem retorna OAuth, refresh token ou credenciais de publicação.

Se o canal exato não estiver vinculado, o endpoint devolve `connected:false` com `reason:'channel-not-linked-in-cacadores'`; isso é resultado esperado enquanto o consentimento correto estiver pendente.

## Gates de segurança

- Implementar e testar em branch separada, sem tocar o PR #258.
- Manter `Autopilot` global pausado e publicação automática desativada.
- Testar em Linux (Docker, TypeScript, testes), validar `GET` sem autorização (401) e com segredo correto (200 + `connected:false`, até vincular o canal).
- Nunca registrar segredos em respostas ou relatórios.
- Não usar o comando `cacadores-promote` sem proteção adicional: o fluxo padrão reinicia timers. Adotar blue/green controlado com rollback.

## Evidências de 05/11/2026

O PostgreSQL de produção ainda tinha somente `Grug Explains Money` e `Crescendo com a Ketlyn` vinculados. A última pendência do projeto Elétrico em Movimento retornou **Guia das Bancas**, não o ID esperado. Não confirmar essa pendência. Nenhum vídeo foi alterado ou publicado.

## Validação

```
npm run typecheck
npm test
npm run build
```

Após a implantação, validar `GET /api/integrations/cacadores-youtube/status` no GoMotionStudio e comparar seu `youtubeChannelId` ao ID canônico antes de consumir métricas.

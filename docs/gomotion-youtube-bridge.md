# Ponte GoMotionStudio ↔ Caçadores de Nichos (somente leitura)

Esta ponte aproveita **o OAuth do YouTube já existente no Caçadores de Nichos**. Não cria um segundo cliente Google, não duplica refresh tokens e não altera os endpoints de OAuth/publisher.

## Premissas
- O Caçadores já implementa `/api/youtube-oauth/start`, `/api/youtube-oauth/callback`, `/api/youtube-channels`, `/api/performance-analyst` e `/api/youtube-publisher`.
- O OAuth precisa estar configurado no ambiente do Caçadores, e o canal **deve ter sido autorizado e confirmado** ali. A autenticação do vidIQ/ChatGPT é independente; ela **não conecta** automaticamente o canal ao Caçadores.
- O worker de publicação está intencionalmente desativado no modo assistido-manual e necessita Publication Package aprovado. Esta ponte não enfileira nem publica vídeos.

## Ambiente do Caçadores (servidor/Vercel)
Após revisão do código e testes, configurar com valores privados no provedor de ambiente:

- `GOMOTION_BRIDGE_SECRET`: segredo exclusivo para a ponte, aleatório, no mínimo 32 caracteres, **distinto** de `AGENT_OPERATOR_SECRET`, de senhas, e de qualquer segredo OAuth.
- `GOMOTION_BRIDGE_YOUTUBE_CHANNEL_ID`: ID exato do canal YouTube autorizado (começa com `UC`).

As credenciais OAuth **já existentes** no Caçadores permanecem intactas. Não cadastrar as chaves Google novamente no GoMotionStudio.

## Ambiente do GoMotionStudio (servidor local)
Configurar de forma privada, preferivelmente no gerenciador de segredos/ambiente do Windows, sem registrar em repositório:

- `CACADORES_BRIDGE_BASE_URL`: URL base HTTPS do Caçadores em produção, sem caminho/query.
- `GOMOTION_BRIDGE_SECRET`: exatamente o mesmo segredo dedicado da ponte no Caçadores.
- `CACADORES_YOUTUBE_CHANNEL_ID`: o mesmo ID do canal YouTube.

A rota local de leitura é:
`GET http://127.0.0.1:8877/api/integrations/cacadores-youtube/status`

A rota remota é:
`GET https://<dominio-do-cacadores>/api/gomotion-youtube`
com o header privado `x-gomotion-bridge-secret`, enviado apenas do servidor GoMotion.

## Limites e segurança
- Somente **GET**: status de canal, verificações de escopo, até 12 snapshots já persistidos e até 12 estados de upload. Não oferece tokens, refresh tokens ou Publication Packages completos.
- A rota verifica a credencial com comparação resistente a timing e limita o resultado ao ID de canal configurado no servidor; outras contas/canais não são expostos.
- Retorna `Cache-Control: no-store`. A URL do Caçadores deve ser HTTPS; exceção somente para loopback em desenvolvimento.
- Os snapshots representam métricas **já coletadas**, não um download em tempo real de novas estatísticas. Leitura atualizada depende de um job do Analytics existente ou da integração vidIQ.
- Não há rota de upload pela ponte. O envio do MP4 local para o armazenamento do Caçadores e sua associação a um Publication Package exigem uma etapa separada e testes de ponta a ponta.
- Nova autorização de escopos exige consentimento Google quando necessário. Em modo de teste, o refresh token pode expirar rapidamente.
- Nunca salvar segredos no Git, logs, UI, ou texto do ChatGPT.

## Validação
- `npm test` (ou `npx tsx --test tests/gomotion-youtube-bridge.test.ts`) valida política e escopo.
- No GoMotionStudio: `npm run youtube:bridge:test`.
- Somente após instalar a versão revisada no servidor e configurar os dois ambientes, validar GET local e a identidade do canal.
- Nenhuma implantação ou publicação deve ocorrer automaticamente ao mesclar este código.

Status: implementação em branch de revisão; precisa configurar ambientes e validar um canal real antes de declarar conexão operacional.

## Edição de vídeos existentes (novo)
- Rota `GET /api/gomotion-youtube/video?videoId=...` consulta metadados do **canal exato autorizado**; não aceita vídeo de outro canal.
- Rota `POST /api/gomotion-youtube/video` aceita somente `action=preview` e `action=apply`.
- Preview valida mudanças exclusivamente em `title`, `description` e `tags`, preserva `categoryId` e `defaultLanguage`, e emite token HMAC vinculado ao vídeo, ao canal e ao hash dos metadados anteriores, com expiração em 10 minutos.
- Apply exige token íntegro e vigente, vídeo sem mudanças desde a prévia e confirmação literal `CONFIRMO_ALTERAR_VIDEO`. Só chama `videos.update(part=snippet)`; nunca inclui `status`, `publishAt`, thumbnail, vídeo ou configuração infantil.
- `youtube.force-ssl` é obrigatório; se faltante, a API pede reconexão OAuth com o consentimento correto.
- O GoMotionStudio disponibiliza painel local `http://127.0.0.1:8877/youtube-control` com comparação antes/depois e confirmação adicional. A interface nunca recebe a credencial de ponte.
- **Não habilitar em produção sem revisar o PR, configuração segura do segredo e teste com o vídeo escolhido.** A primeira alteração real requer aprovação específica do usuário, que deve conferir o título/descrição/tags.
- Alteração de thumbnail será uma etapa distinta, usando API YouTube thumbnails.set e autorização explícita; não está implementada aqui.

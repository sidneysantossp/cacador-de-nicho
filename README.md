# Caçadores de Nichos

Plataforma de inteligência editorial: radar de canais, evidências, anatomia, cinco perspectivas, memória e rascunhos de roteiro. Mercado sempre inglês; interface em português.

## Estado da entrega

Prévia: https://cacadores-de-nichos.vercel.app

A interface demonstrativa funciona sem credenciais. Os três canais e seus números são fictícios e identificados. Decisões e contextos da demonstração ficam somente no navegador, sem migração automática para a operação real.

O backend possui integração YouTube Data API, pesquisa OpenAI com web search, três etapas de análise, roteiros, armazenamento privado Supabase, sessões assinadas e rotinas protegidas. Integrações reais ainda não foram executadas. Consulte `docs/PROJECT_STATE.md` para pendências específicas.

## Instalação

1. `npm ci`.
2. Copiar `.env.example` para `.env.local` e configurar as variáveis sem publicar segredos.
3. Revisar `docs/schema.sql` e aplicar em projeto Supabase dedicado aprovado pelo operador.
4. `npm run typecheck`, `npm test`, `npm run build`.
5. `npm run dev` após configurar o ambiente.

Para Vercel, configurar as mesmas variáveis em Settings > Environment Variables e fazer novo deploy. O projeto já está vinculado na máquina de criação; a pasta `.vercel` não vai para Git.

## Ativação do radar

Configurar banco, senha privada, SESSION_SECRET, YOUTUBE_API_KEY e OPENAI_API_KEY. Primeiro verificar leitura/escrita privadas, uma pesquisa controlada e uma análise com limite de custo. `YOUTUBE_ANALYTICS_APPROVED` só pode ser verdadeiro após aceitação aplicável do caso de analytics pelo YouTube.

Depois de validar, configurar Vercel Cron para `/api/cron` e definir CRON_SECRET. O endpoint exige autenticação; a opção habilitar rotina precisa estar ligada no banco. Não há agendador ativo nesta entrega. O login usa limitação persistente no banco.

## Limites conhecidos

- Descoberta amostral, até cinco buscas por rodada, sem promessa de cobrir todo o YouTube.
- Idioma de busca é inglês; idioma ausente nos metadados ainda precisa de confirmação.
- Não há RPM, CTR, retenção privada ou transcrição automática de concorrentes.
- Anatomia parcial, apoiada em metadados e pesquisa web. Não é inspeção audiovisual.
- Roteiros são rascunhos com verificação factual pendente.
- Modelo definido por OPENAI_MODEL; chamadas e limites devem ser validados na conta antes da ativação.
- Rotinas têm exclusão mútua, limite de jobs e retries, mas precisam de scheduler para retomada após interrupção.

Fontes e detalhes técnicos: `docs/backend.md`.

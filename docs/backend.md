# Operação do backend

Esta versão é de operador único. Sem senha de 16 caracteres, segredo de sessão de 32 caracteres e login válido, `/api/radar` só entrega a demonstração. Chaves de serviço ficam exclusivamente no servidor. Não há políticas públicas de leitura ou escrita no banco.

Aplicar `docs/schema.sql` em projeto Supabase dedicado depois de revisar; preencher `.env.local` a partir de `.env.example`. O schema não foi executado em nenhum projeto remoto. Login usa cookie assinado de 12 horas, HttpOnly, SameSite Strict e Secure em produção. Rotacionar SESSION_SECRET revoga sessões. A limitação de login é persistente no Supabase: cinco tentativas por origem a cada 15 minutos, identificada por hash. O acesso falha fechado se o banco ou a função de limitação estiverem indisponíveis.

## Contrato

- `GET /api/radar`: RadarData; nenhum dado privado para sessão ausente.
- `POST /api/auth`: `{password}`. `DELETE /api/auth`: logout. Origin exata obrigatória.
- `POST /api/actions`: `{action, channelId?, opportunityId?, decision?, reason?, title?, content?, settings?}`; resposta `{message}`. Refazer GET após sucesso. As ações exigem sessão e Origin exata.
- `GET /api/cron`: `Authorization: Bearer CRON_SECRET`; rotina apenas se settings.enabled. Sem agendamento automático no repositório.

Descoberta: até 5 buscas, 25 resultados cada, 20 canais acompanhados por rodada, 10 uploads por canal, lotes de 50 vídeos. A rotação de canais é diária; a base lida é limitada a 100 canais. Isto é cobertura amostral, não indexação completa do YouTube. O sinal corresponde a uma observação feita antes do limite, nunca a uma estimativa de quando um marco foi atingido. Formato, nicho e idioma desconhecidos permanecem explícitos. Nenhuma chamada de API paga é feita na instalação ou demonstração.

Jobs persistem no Supabase, têm chave diária (cron) ou janela de cinco minutos (manual), exclusão mútua, lease de 15 minutos e até 3 tentativas. Uma falha pode ser retomada repetindo a chamada; etapas de descoberta podem repetir e análises já salvas são reutilizadas. Não há worker autônomo nem promessa de execução após timeout: configurar agendador e retries no provedor, com duração disponível de 300s ou mais. Até duas análises automáticas por rodada. Uma análise executa pesquisa web e três chamadas estruturadas: anatomia, cinco conceitos e crítica. Roteiro usa pesquisa web e uma chamada estruturada. A crítica fica visível e não representa validação factual. Todas as ações pesadas compartilham exclusão mútua; o banco limita a 20 jobs distintos por dia. Esse limite de jobs não substitui limites monetários da conta OpenAI.

Mercado fixado em inglês pelo operador. A API rejeita configurações de outro idioma. A busca pode retornar vídeos sem idioma declarado, que ficam por confirmar; metadados declaradamente não ingleses são excluídos. OPENAI_MODEL é configurável. Responses API usa saída estruturada e store:false. Dados externos são tratados como conteúdo não confiável. Anatomia é parcial: sem transcrição nem inspeção audiovisual. Roteiros exigem oportunidade aprovada e saem como rascunho com verificação factual pendente. Há pesquisa web com URLs extraídas das citações da resposta. Essas fontes não equivalem a inspeção audiovisual; é necessária validação real com credenciais.

`YOUTUBE_ANALYTICS_APPROVED` bloqueia análises derivadas até aceitação real aplicável. Não habilitar apenas para liberar o botão. Limpeza ocorre antes de leitura live e rodadas: metadados, análises e roteiros expiram em 30 dias; snapshots em 30 dias ou 36 meses com aceitação. Contextos e decisões do operador permanecem como memória própria; não inserir neles cópias de metadados para contornar retenção. Para garantir limpeza mesmo sem acessos, configurar chamada diária do cron. Requisitos adicionais de remoção de dados e política do YouTube devem ser revisados antes do lançamento público.

Testes locais cobrem sessão, falsificação, expiração, origem e janela de observação. Integração real, permissões do schema e APIs dependem de credenciais; não foram validadas com chamadas pagas ou banco remoto.

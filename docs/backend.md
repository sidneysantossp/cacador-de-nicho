# Operação do backend

Esta versão é de operador único. Sem senha de 16 caracteres, segredo de sessão de 32 caracteres e login válido, `/api/radar` só entrega a demonstração. Chaves de serviço ficam exclusivamente no servidor. Não há políticas públicas de leitura ou escrita no banco.

Aplicar `docs/schema.sql` em projeto Supabase dedicado depois de revisar; preencher `.env.local` a partir de `.env.example`. O schema não foi executado em nenhum projeto remoto. Login usa cookie assinado de 12 horas, HttpOnly, SameSite Strict e Secure em produção. Rotacionar SESSION_SECRET revoga sessões. A limitação de login é persistente no Supabase: cinco tentativas por origem a cada 15 minutos, identificada por hash. O acesso falha fechado se o banco ou a função de limitação estiverem indisponíveis.

## Contrato

- `GET /api/radar`: RadarData; nenhum dado privado para sessão ausente.
- `POST /api/auth`: `{password}`. `DELETE /api/auth`: logout. Origin exata obrigatória.
- `POST /api/actions`: `{action, channelId?, opportunityId?, decision?, reason?, title?, content?, settings?, managedChannel?}`; resposta `{message}`. A ação `managedChannel` cria ou atualiza um canal do portfólio, incluindo nicho, formato, estágio, prioridade e vínculo opcional com uma oportunidade. Refazer GET após sucesso. As ações exigem sessão e Origin exata.
- `GET /api/cron`: `Authorization: Bearer CRON_SECRET`; rotina de Radar apenas se settings.enabled. A automação recorrente do Mission Control permanece deliberadamente desligada até a primeira missão manual ser validada em produção.

Descoberta: até 5 buscas, 25 resultados cada, 20 canais acompanhados por rodada, 10 uploads por canal, lotes de 50 vídeos. A rotação de canais é diária; a base lida é limitada a 100 canais. Isto é cobertura amostral, não indexação completa do YouTube. O sinal corresponde a uma observação feita antes do limite, nunca a uma estimativa de quando um marco foi atingido. Formato, nicho e idioma desconhecidos permanecem explícitos. Nenhuma chamada de API paga é feita na instalação ou demonstração.

Jobs persistem no Supabase, usam exclusão mútua, lease de 15 minutos e até 3 tentativas por chave. Uma falha pode ser retomada repetindo a chamada; etapas de descoberta podem repetir e análises já salvas são reutilizadas. Ações pesadas compartilham exclusão mútua. O Mission Orchestrator executa uma missão manual com orçamento conservador: fecha no máximo 1 Opportunity Report pendente, atualiza o Radar, aprofunda no máximo 1 novo canal e gera no máximo 1 Opportunity Report por missão. Não há recorrência automática do Mission Control habilitada por padrão.

Mercado fixado em inglês pelo operador. A API rejeita configurações de outro idioma. A busca pode retornar vídeos sem idioma declarado, que ficam por confirmar; metadados declaradamente não ingleses são excluídos. Os modelos de análise e roteiro são escolhidos separadamente na tela de Configurações. Responses API usa saída estruturada e store:false. Dados externos são tratados como conteúdo não confiável. Anatomia é parcial: sem transcrição nem inspeção audiovisual. Roteiros exigem oportunidade aprovada e saem como rascunho com verificação factual pendente. Há pesquisa web com URLs extraídas das citações da resposta. Essas fontes não equivalem a inspeção audiovisual; é necessária validação real com credenciais.

OpenAI e YouTube podem ser cadastrados pelo operador autenticado. A chave é validada contra o provedor antes da gravação e fica cifrada no Supabase Vault; a API só devolve estado, origem e os quatro caracteres finais. As funções de cofre em `docs/schema.sql` aceitam apenas esses dois nomes, são executáveis somente por `service_role` e mantêm `anon` e `authenticated` revogados. `OPENAI_API_KEY` e `YOUTUBE_API_KEY` continuam disponíveis como fallback de servidor. Supabase, senha de acesso, segredo de sessão e cron permanecem na hospedagem porque são necessários antes que a tela segura possa funcionar.

`YOUTUBE_ANALYTICS_APPROVED` não bloqueia a inteligência editorial global. Ele permanece restrito ao tratamento de retenção/funcionalidades que realmente dependam desse enquadramento. Não habilitar apenas para liberar recursos. Limpeza ocorre antes de leitura live e rodadas: metadados, análises e roteiros expiram em 30 dias; snapshots em 30 dias ou 36 meses com aceitação. Contextos e decisões do operador permanecem como memória própria; não inserir neles cópias de metadados para contornar retenção. Para garantir limpeza mesmo sem acessos, configurar chamada diária do cron. Requisitos adicionais de remoção de dados e política do YouTube devem ser revisados antes do lançamento público.

Testes locais cobrem sessão, falsificação, expiração, origem e janela de observação. Integração real, permissões do schema e APIs dependem de credenciais; não foram validadas com chamadas pagas ou banco remoto.


## Mission Control

A tela inicial da operação é o Mission Control. A missão empresarial é encontrar, validar e transformar oportunidades de conteúdo em ativos capazes de gerar receita. O operador pode executar uma missão manual autenticada por `POST /api/actions` com `{action:"mission"}`.

A missão não relaxa os gates do Radar. Ela prioriza trabalho próximo de produção, atualiza o mercado, aprofunda no máximo um novo candidato e grava um `mission-brief` em `radar_analyses`. O brief mostra somente fila pronta para produção, decisões humanas necessárias e bloqueios reais. Uma oportunidade só entra em Production Ready quando a curva é estrutural e os sinais mínimos de demanda, repetibilidade, lacuna e saturação passam pelas regras determinísticas em `src/lib/mission.ts`.


## YouTube Quota Intelligence

Desde junho de 2026, `search.list` usa um bucket granular próprio. O projeto adota um teto operacional de 100 buscas/dia, alinhado à alocação padrão atual, com reset pelo dia do Pacífico.

O orçamento é dividido por finalidade:
- reference-resolution: 4
- radar-discovery: 48
- channel-resolution: 8
- channel-study: 16
- similar-channels: 24

O estado diário é persistido em `radar_analyses` como `kind: youtube-search-budget`, portanto não exige migration adicional. Buscas de descoberta e resolução de referências são deduplicadas em janelas de 6 horas. O Radar não pode consumir a reserva de investigação.

Quando o orçamento de uma finalidade se esgota, somente essa finalidade para. Quando o teto global ou uma quota externa dura é atingida, novas buscas são pausadas e o Mission Control continua trabalhando com dados já coletados. Limites temporários 429 não marcam automaticamente o dia inteiro como esgotado.

O Mission Control exibe consumo total, saldo restante, uso por finalidade e quantas buscas redundantes foram evitadas.

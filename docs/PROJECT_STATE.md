# Estado da operação — 22/09/2026

## Decisões do operador

- Sempre inglês no mercado monitorado e conteúdo produzido; interface e análise em português.
- Stack solicitada: GitHub + Vercel + Supabase + YouTube API + OpenAI.
- Descoberta proativa, exemplos de sinal: canal recente, poucos vídeos, 500 mil views observadas em menos de 72 horas.
- Produção audiovisual já existe fora da plataforma; foco aqui em pesquisa, inteligência e roteiros.

## Implementado

- Next.js 16.3.5, React 19.3.0; dependências fixadas e lockfile.
- UI responsiva: radar, filtros, dossiê, propostas, memória, roteiros, atividade, configuração.
- Demonstração explícita com atlas original de três conceitos, sem dados reais.
- API privada com cookie assinado, proteção de origem e limitação de login via Supabase.
- SQL com RLS e acesso só service_role, jobs e retenção de dados.
- Coleta YouTube limitada, análise OpenAI em etapas com pesquisa web, exportação de dossiê/roteiro.
- Mercado inglês imposto no schema de configurações.
- Central de credenciais para OpenAI e YouTube, com validação antes da gravação, máscara de quatro caracteres e remoção.
- Supabase Vault preparado para cifrar as chaves; modelos de análise e roteiro escolhidos separadamente na interface.

## Infraestrutura

Vercel projeto criado: cacadores-de-nichos, equipe auditseo.
Project ID: prj_cF9scWeWLDSuM8RIplNBJDN4Fc1s.
URL: https://cacadores-de-nichos.vercel.app
Git local iniciado. Repositório remoto GitHub ainda não criado: conector não oferece criação e credencial CLI indisponível. Não foi feita publicação no GitHub.
Supabase: nenhum projeto novo criado e nenhum SQL executado. Pergunta pendente ao operador sobre usar organização AUDITSEO PLATAFORM (qbrwkkrxqosocbwbjbnz) para projeto dedicado. Custo retornado no momento da consulta: US$ 0/mês. Não reutilizar bancos de outros projetos.
Chaves YouTube/OpenAI e banco privado ainda ausentes. Não houve pesquisa ou chamada paga real. A nova central permanece bloqueada até Supabase e acesso privado serem provisionados.

## Próximo passo

Confirmar organização do Supabase na pergunta pendente, criar banco dedicado conforme retorno de custo e instruções da ferramenta. Validar SQL real e políticas. Configurar segredos via ambiente seguro Vercel, nunca em contexto editorial ou Git. Verificar APIs reais com custos limitados; concluir enquadramento analytics antes de habilitar análises derivadas. Criar/conectar repositório privado quando houver acesso de criação. Só então ativar agendamento.

## Verificação

Primeiro build local e deploy passaram. Testes cobrem assinatura/expiração/origem, janela temporal e limites de configuração. Navegador confirmou radar e abertura de anatomia/cinco propostas. A gestão de canais adiciona cadastro, estágios, prioridade e conversão de perspectivas em iniciativas de portfólio; a tabela `radar_managed_channels` precisa estar aplicada no Supabase para persistência fora do modo demonstração. Alterações subsequentes precisam de build/deploy final registrado no encerramento desta tarefa.

Verificação final: build local passou, 4 testes passaram e deploy da central de configuração READY (dpl_4QZPhfu8XeyMhg5BGnwt1qjKSNn9). Desktop e celular inspecionados. A rota de credenciais retorna 401 sem sessão, e o radar público não expõe padrões de segredo. O deploy anterior foi dpl_HAz2hccdMH83hgdk1VWuhFGxRGVR. Nenhum banco real ou chamada OpenAI/YouTube foi validado.

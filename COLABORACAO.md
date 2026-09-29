# Protocolo obrigatório de colaboração

Versão 1 — 23/09/2026. Aplica-se a humanos, Codex, Claude Code e qualquer outra ferramenta que altere este repositório.

**Nenhuma implementação começa sem uma tarefa registrada, um responsável e uma reserva de escopo integrada à `master`. Ao terminar, o responsável atualiza o checklist, registra a validação e dá baixa na tarefa.** Isso vale também para documentação, correções, dependências, migrações e mudanças no próprio processo.

## 1. Leitura antes de trabalhar

Leia este documento inteiro, `AGENTS.md`, `TODO.md`, `docs/PROJECT_STATE.md` e as tarefas ativas. Para backend/infraestrutura, leia também `docs/backend.md`; para o estúdio, `docs/estudio/MAPEAMENTO.md`. Instruções de subdiretórios continuam aplicáveis.

Inspeções para entender o pedido, leitura, testes sem efeitos externos e criação/atualização do próprio registro são a preparação da tarefa. Não exigem outra tarefa recursiva. Alterar o produto, escrever implementação ou executar ações externas exige a reserva prévia.

No início da sessão, informe ao operador: ID da tarefa, responsável, objetivo e escopo reservado. Ao retomar uma sessão, consulte o Git; a memória do chat não é o quadro de trabalho.

## 2. Onde cada informação fica

| Arquivo | Função |
| --- | --- |
| `COLABORACAO.md` | Regras obrigatórias e procedimento completo. |
| `AGENTS.md` | Instruções de entrada para agentes e regras do produto. |
| `CLAUDE.md` | Entrada do Claude Code, importando as mesmas regras. |
| `TODO.md` | Como consultar, criar, reservar e encerrar tarefas. |
| `tasks/ID.json` | Registro individual: responsável, branch, escopo, checklist, aceite e evidências. |
| `docs/PROJECT_STATE.md` | Estado integrado e pendências da plataforma. |

Há um arquivo por tarefa para evitar que todos editem a mesma lista. **A versão em `origin/master`, após `git fetch origin`, é o quadro compartilhado oficial.** Um arquivo local, uma Issue ou um PR aberto ainda não é uma reserva confirmada.

## 3. Estados e responsabilidade

| Estado | Significado | Reserva arquivos? |
| --- | --- | --- |
| `planned` | Trabalho proposto; ainda não pode começar. | Não |
| `in_progress` | Responsável definido e execução autorizada após integração da reserva. | Sim |
| `blocked` | Impedimento registrado em `notes`; não marcar como concluído. | Sim |
| `in_review` | Implementação concluída, checklist e validações prontos para revisão. | Sim |
| `done` | Checklist e aceite completos, evidências aprovadas e resultado registrado. | Até este estado ser integrado à `master` |
| `cancelled` | Trabalho cancelado com justificativa em `result`. | Até a integração do cancelamento |

O responsável identifica pessoa e executor/sessão, por exemplo `sidneysantossp / Claude Code / sessão 2026-09-24-A`. Duas sessões do mesmo modelo são executores diferentes. Não assumir tarefa alheia nem apagar seu histórico. Troca de responsável exige passagem de contexto registrada em `notes` e um PR apenas do registro, integrado antes de continuar.

Uma tarefa bloqueada não expira automaticamente. Para liberar seus arquivos, documente o cancelamento ou a redução do escopo em PR próprio. Para trabalho adicional depois de `done`/`cancelled`, crie outro ID; registros encerrados são imutáveis.

## 4. Reserva antes da implementação

1. Atualize as referências com `git fetch origin`. Confira a árvore local com `git status` e liste as tarefas de `origin/master` com `npm run tasks:list -- --ref origin/master`.
2. Crie uma branch `task/ID-descricao` a partir de `origin/master`. Use um clone ou worktree exclusivo por executor. Não compartilhe a mesma pasta de trabalho com duas IAs.
3. Crie `tasks/ID.json` com `npm run tasks:new -- ...` conforme `TODO.md`. Use ID ainda livre, responsável, escopo mínimo, checklist e critérios de aceite concretos. O comando não confirma a reserva no GitHub.
4. Faça um commit **somente desse registro** e abra um PR de reserva. A CI rejeita sobreposição com tarefas ativas e dependências não concluídas. Aguarde a integração desse PR à `master`.
5. Atualize sua branch com `git fetch origin` e `git merge origin/master`. Confirme que `git show origin/master:tasks/ID.json` contém sua reserva e seu responsável. Só então implemente.

Exemplo: `src/lib/video/` reserva todo esse diretório; `src/lib/types.ts` reserva apenas esse arquivo. Use caminhos relativos exatos ou diretórios terminados em `/`; curingas, caminhos absolutos, `..` e reserva de toda a raiz são proibidos. O próprio `tasks/ID.json` é implicitamente editável pela tarefa.

Se duas reservas tentarem ocupar o mesmo arquivo, a primeira integrada vence. A segunda deve atualizar a base e passar novamente nas verificações. Para isso funcionar, a proteção da `master` precisa exigir branch atualizada antes do merge, além dos checks obrigatórios da seção 8.

Arquivos centrais — `package.json`, lockfile, schema, tipos compartilhados e o dashboard — têm um responsável por vez. Divida por arquivos quando possível. Se duas mudanças forem inseparáveis, reúna-as na mesma tarefa e mantenha um único executor responsável pela integração.

## 5. Durante a execução

- Trabalhe apenas no escopo reservado. Ampliar/reduzir escopo, trocar responsável ou branch e mudar dependências exige PR só do registro, integrado antes de usar a nova reserva.
- Preserve alterações alheias. Não use `reset --hard`, limpeza destrutiva, force push ou resolução de conflito por sobrescrita para eliminar trabalho de outro executor.
- Atualize checklist, notas de decisões e impedimentos. Antes de cada sessão e antes do PR final, atualize `origin/master` e execute `npm run tasks:check`.
- Mudanças de contrato compartilhado precisam explicar compatibilidade e dependências. Conflitos semânticos podem existir mesmo quando os arquivos são diferentes; revisão continua necessária.
- Não implemente a mesma tarefa em duas branches. Ao transferir, registre commit de retomada, arquivos em andamento, testes, riscos e próximo passo.
- Falta de credenciais, acesso, orçamento ou decisão de produto deve ser registrada como impedimento. Nunca invente sucesso de integração ou teste.
- Autorização para implementar não substitui autorizações aplicáveis de custo, produção, banco ou APIs. Preserve todas as regras de `AGENTS.md`.

## 6. Conclusão e baixa

1. Revise o diff e confirme que todos os arquivos alterados pertencem à reserva publicada.
2. Execute `npm run tasks:check`, `npm run test:collaboration`, `npm run typecheck`, `npm test` e `npm run build`. Registre comandos e resultados reais em `validation`; use `blocked` ou `failed` quando aplicável. Não marque `passed` por inferência.
3. Complete cada item de `checklist` e `acceptance` apenas depois de verificá-lo. Preencha `result`, `updated_at` e `completed_at` com data UTC real. Estado `done` exige validações com resultado `passed`.
4. Inclua a baixa no mesmo PR da implementação. O validador de PR exige `done`. Durante o desenvolvimento, commits com `in_progress` são permitidos pelo hook local; um PR de implementação incompleto fica reprovado até ser finalizado.
5. Use o modelo de PR, explique comportamento, testes e limitações. Integre somente com CI aprovada e a base atualizada. O responsável pela integração é o mantenedor designado; inicialmente, Sidney.
6. Confira a integração na `master` e comunique ID, resultado e pendências. **`done` apenas na branch significa conclusão proposta, ainda não integrada. A reserva compartilhada só é liberada com o merge.** Publicação/deploy é um estado separado e deve ser relatado como tal.

Tarefas operacionais que não alterem arquivos de implementação também precisam de reserva anterior, checklist e evidências. Nesses casos, a baixa pode alterar apenas o registro, com resultado verificável da operação. Não cancele uma tarefa apenas para ocultar trabalho já executado.

Se uma validação obrigatória não puder executar, mantenha `blocked`, registre o motivo e prepare o diff para revisão. Não simule a baixa. O PR de registro do impedimento pode ser integrado separadamente, preservando a reserva.

## 7. Verificações locais

Depois de clonar, execute `npm run tasks:setup` para instalar o hook de pre-commit versionado. Node.js 22 ou superior é suficiente para as ferramentas de colaboração; elas não dependem de `npm ci`. O instalador não substitui outro `core.hooksPath` existente.

O hook confere o conteúdo efetivamente staged, incluindo exclusões e os dois lados de renomes. `npm run tasks:check` também inclui mudanças ainda não staged e arquivos novos não ignorados. Um snapshot inválido não pode ser disfarçado por uma correção presente apenas fora do stage.

Não use `--no-verify` para contornar o protocolo. Hooks são uma ajuda local e podem ser desativados pelo usuário; a barreira compartilhada é a proteção de branch com CI obrigatória.

## 8. Proteção necessária no GitHub

O código não ativa configurações administrativas do GitHub. O mantenedor precisa aplicar e verificar em **Settings → Branches/Rulesets** para `master`:

- Exigir pull request para integrar mudanças e bloquear push direto.
- Exigir os checks **`collaboration`** e **`verify`**, usando GitHub Actions como origem esperada quando disponível.
- Exigir branch atualizada antes de integrar (`Require branches to be up to date before merging`).
- Impedir bypass das regras, force push e exclusão da branch principal.
- Exigir resolução de conversas. Quando houver outro revisor disponível, exigir uma aprovação independente; um autor não consegue aprovar o próprio PR.

Não há merge queue configurada neste fluxo. Antes de adotar uma, adapte a verificação de múltiplas tarefas e o evento `merge_group`.

`AGENTS.md`/`CLAUDE.md` orientam ferramentas compatíveis; nenhum Markdown comprova leitura, impede edição no computador ou garante obediência de qualquer IA. As verificações detectam registros inválidos, mudanças fora do escopo e conflitos declarados. Não provam a identidade escrita em `owner`, a qualidade dos testes nem a ausência de conflitos de arquitetura. Proteção remota e revisão completam o processo. Não declare essas proteções ativas sem verificar o GitHub.

Referências: [proteção de branches no GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) e [instruções/importações do Claude Code](https://code.claude.com/docs/en/memory).

## 9. Implantação inicial

`COLAB-001` é a única implantação inicial: o registro foi feito em um commit anterior à implementação, ancorado em `ff17c95baba26ef058e94d947aabcf1ab96fd8d8`, que ainda não continha este protocolo. Durante o trabalho, a `master` avançou com outras entregas; elas foram incorporadas. A verificação aceita esse bootstrap somente para `COLAB-001`, com a âncora original e uma base dessa linhagem ainda sem o protocolo e sem registros de tarefas. Depois da primeira integração, novas implementações obrigatoriamente usam a reserva prévia compartilhada. Não há parâmetro de CLI para dispensar essa regra.

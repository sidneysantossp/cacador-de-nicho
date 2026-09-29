# Tarefas do projeto

Leitura obrigatória: [COLABORACAO.md](COLABORACAO.md). O quadro oficial são os arquivos individuais em [`tasks/`](tasks/) na `origin/master` atualizada. Esta página é um guia, não uma segunda lista de status.

## Consultar

```sh
git fetch origin
npm run tasks:list -- --ref origin/master
npm run tasks:list
```

O primeiro comando de listagem mostra o quadro compartilhado; o segundo mostra a cópia local. Consulte o JSON da tarefa para ver cada item e suas evidências.

## Criar e reservar

Exemplo de uma tarefa nova; ajuste o ID, a descrição e o escopo ao trabalho real:

```sh
git fetch origin
git worktree add ../cacador-ESTUDIO-001 -b task/ESTUDIO-001-contrato origin/master
cd ../cacador-ESTUDIO-001
npm run tasks:setup
npm run tasks:new -- ESTUDIO-001 \
  --title "Definir o contrato versionado do projeto de vídeo" \
  --owner "sidneysantossp / Codex / sessao-2026-09-24-A" \
  --scope src/lib/video/ \
  --scope tests/video-project.test.ts \
  --step "Definir tipos e validação do manifesto" \
  --step "Testar invariantes de tempo e referências de assets" \
  --accept "Manifestos incompatíveis são rejeitados com erro explícito"
npm run tasks:check
git add tasks/ESTUDIO-001.json
git commit -m "[ESTUDIO-001] Reservar contrato do projeto de video"
git push -u origin task/ESTUDIO-001-contrato
```

Abra o PR **somente da reserva**. Depois de integrado:

```sh
git fetch origin
git merge origin/master
git show origin/master:tasks/ESTUDIO-001.json
```

Confirme responsável/escopo e implemente. Se o ID já existir como `planned`, edite esse registro, preencha responsável/branch/base/checklist e mude para `in_progress` no PR de reserva. Não recrie um arquivo existente. O exemplo não significa que `ESTUDIO-001` esteja reservado.

Cada `--scope`, `--step`, `--accept` e `--depends` pode aparecer várias vezes. Dependências precisam estar `done` na base compartilhada antes da reserva. O comando cria `in_progress` local; a reserva só vale depois do merge.

## Atualizar e encerrar

Edite `tasks/ID.json`: marque `done: true` item a item, adicione evidências reais a `validation`, preencha `result`, `updated_at` e `completed_at` em UTC e defina `status: "done"`. Exemplo de evidência:

```json
{
  "command": "npm run test:collaboration",
  "result": "passed",
  "details": "Informar os testes executados e o resultado observado."
}
```

Use `failed`/`blocked` quando necessário e mantenha a tarefa aberta. `notes` guarda impedimentos, decisões e passagem de contexto. Não remova tarefas concluídas. O PR de implementação precisa conter a baixa; sua integração libera a reserva.

```sh
npm run tasks:check
npm run test:collaboration
npm run typecheck
npm test
npm run build
```

## Próxima frente de desenvolvimento

O mapa funcional e a sequência M0–M4 estão em [docs/estudio/MAPEAMENTO.md](docs/estudio/MAPEAMENTO.md). A próxima tarefa recomendada é reconferir a integração contra a `master` atual e definir o contrato versionado de projeto/timeline do M0, com unidades de tempo, referências a assets e validação. Mission Control e Universe chegaram depois da base auditada no mapa. A tarefa deve ser criada e reservada pelo executor que assumir o trabalho. Infraestrutura real, limites de uso e orçamento continuam sujeitos às pendências registradas; o exemplo acima não provisiona serviços.

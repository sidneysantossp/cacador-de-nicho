import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_BASE, validScope, overlaps, validateCatalog, validateChanges, readTasks } from '../scripts/task-workflow.mjs';

const BASE = 'a'.repeat(40);
function task(overrides = {}) {
  return {
    id: 'VIDEO-001', title: 'Contrato do projeto', status: 'in_progress', owner: 'Sidney / Codex / sessão A',
    branch: 'task/VIDEO-001-contrato', created_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:01:00Z',
    base_commit: BASE, depends_on: [], scope: ['src/video/', 'tests/video.test.ts'],
    checklist: [{ text: 'Implementar contrato', done: false }],
    acceptance: [{ text: 'Rejeitar manifesto inválido', done: false }], validation: [], result: '', notes: [],
    ...overrides,
  };
}
function done(overrides = {}) {
  return task({ status: 'done', checklist: [{ text: 'Implementar contrato', done: true }],
    acceptance: [{ text: 'Rejeitar manifesto inválido', done: true }],
    validation: [{ command: 'npm test', result: 'passed', details: 'Teste de manifesto passou.' }],
    completed_at: '2026-09-23T10:01:00Z', result: 'Contrato validado.', ...overrides });
}
function change(overrides = {}) {
  return validateChanges({ baseTasks: [task()], tasks: [done()], changed: ['tasks/VIDEO-001.json', 'src/video/project.ts'],
    branch: 'task/VIDEO-001-contrato', baseSha: BASE, ci: true, ...overrides });
}

test('uma implementação com reserva anterior e baixa válida passa', () => {
  assert.deepEqual(change(), []);
});

test('a reserva separada pode entrar antes da implementação', () => {
  assert.deepEqual(change({ baseTasks: [], tasks: [task()], changed: ['tasks/VIDEO-001.json'] }), []);
});

test('criar tarefa no mesmo PR do código não equivale a reserva prévia', () => {
  assert.match(change({ baseTasks: [] }).join('\n'), /previamente integrada/);
});

test('código sem atualização do registro da tarefa é rejeitado', () => {
  assert.match(change({ changed: ['src/video/project.ts'] }).join('\n'), /exatamente um registro/);
});

test('escopo exato distingue arquivos, diretórios e prefixos parecidos', () => {
  assert.equal(overlaps('src/video/', 'src/video/project.ts'), true);
  assert.equal(overlaps('src/video/', 'src/videos/project.ts'), false);
  assert.equal(overlaps('package.json', 'package.json'), true);
  for (const scope of ['/', '.', './src/', '../src/', 'src/../tests/', 'src/**', '/src/', 'C:\\src', 'src//', '.git/config']) assert.equal(validScope(scope), false, scope);
  for (const scope of ['.github/', 'src/video/', 'package-lock.json']) assert.equal(validScope(scope), true, scope);
});

test('o catálogo bloqueia sobreposição inclusive com tarefa bloqueada/em revisão', () => {
  for (const state of ['in_progress', 'blocked', 'in_review']) {
    const other = done({ id: 'VIDEO-002', branch: 'task/VIDEO-002-outro', status: state, notes: ['Aguardando decisão.'] });
    assert.match(validateCatalog([task(), other]).join('\n'), /reservas sobrepostas/);
  }
});

test('duas reservas concorrentes: a segunda falha após atualizar a base', () => {
  const other = task({ id: 'VIDEO-002', branch: 'task/VIDEO-002-render' });
  const proposal = { baseTasks: [], tasks: [other], changed: ['tasks/VIDEO-002.json'], branch: other.branch };
  assert.deepEqual(change(proposal), []);
  assert.match(change({ ...proposal, baseTasks: [task()], tasks: [task(), other] }).join('\n'), /sobrepostas/);
});

test('alterar escopo ou responsável junto com código exige PR anterior', () => {
  assert.match(change({ tasks: [done({ scope: ['src/'] })] }).join('\n'), /altere scope em PR só de registro/);
  assert.match(change({ tasks: [done({ owner: 'Outra sessão' })] }).join('\n'), /altere owner em PR só de registro/);
});

test('arquivos fora da reserva e caminhos antigos de renomes são rejeitados', () => {
  assert.match(change({ changed: ['tasks/VIDEO-001.json', 'src/other.ts', 'src/video/project.ts'] }).join('\n'), /fora da reserva publicada: src\/other.ts/);
});

test('encerramento exige checklist, aceite, validação e data reais', () => {
  for (const overrides of [
    { checklist: [{ text: 'Pendente', done: false }] },
    { acceptance: [{ text: 'Pendente', done: false }] },
    { validation: [] }, { validation: [{ command: 'npm test', result: 'blocked', details: 'Sem dependências.' }] },
    { result: '' }, { completed_at: undefined }, { completed_at: '2026-09-24T00:00:00Z' },
  ]) assert.ok(validateCatalog([done(overrides)]).length > 0, JSON.stringify(overrides));
});

test('catálogo malformado gera erros e não aceita conclusão', () => {
  for (const overrides of [{ validation: 'passed' }, { checklist: null }, { acceptance: {} }, { scope: ['../'] }, { status: 'constructor' }, { status: 'blocked', notes: 'motivo' }]) {
    assert.ok(validateCatalog([done(overrides)]).length > 0);
  }
});

test('commit intermediário é permitido; PR de implementação exige baixa', () => {
  assert.deepEqual(change({ tasks: [task()], ci: false }), []);
  assert.match(change({ tasks: [task()] }).join('\n'), /PR de implementação exige/);
});

test('tarefa encerrada não pode ser apagada, reaberta nem reescrita', () => {
  assert.match(change({ baseTasks: [done()], tasks: [] }).join('\n'), /não apague/);
  assert.match(change({ baseTasks: [done()], tasks: [task()] }).join('\n'), /imutável/);
  assert.match(change({ baseTasks: [done()], tasks: [done({ result: 'Outro resultado' })] }).join('\n'), /imutável/);
});

test('dependências precisam existir, estar concluídas e não formar ciclo', () => {
  assert.match(validateCatalog([task({ depends_on: ['VIDEO-002'] })]).join('\n'), /inexistente/);
  const dependency = task({ id: 'BASE-001', branch: 'task/BASE-001-modelo', scope: ['src/base/'], status: 'planned' });
  assert.match(validateCatalog([dependency, task({ depends_on: ['BASE-001'] })]).join('\n'), /não concluída/);
  assert.match(validateCatalog([
    { ...dependency, depends_on: ['VIDEO-001'] }, task({ status: 'planned', depends_on: ['BASE-001'] }),
  ]).join('\n'), /ciclo/);
});

test('retomada de tarefa bloqueada exige atualizar a reserva primeiro', () => {
  assert.match(change({ baseTasks: [task({ status: 'blocked', notes: ['Impedimento'] })] }).join('\n'), /previamente integrada|transição/);
  assert.deepEqual(change({ baseTasks: [task({ status: 'blocked', notes: ['Impedimento'] })], tasks: [task()], changed: ['tasks/VIDEO-001.json'] }), []);
});

test('baixa apenas de registro suporta tarefa operacional com reserva anterior', () => {
  assert.deepEqual(change({ changed: ['tasks/VIDEO-001.json'] }), []);
  assert.match(change({ baseTasks: [], changed: ['tasks/VIDEO-001.json'] }).join('\n'), /nova tarefa/);
});

test('branch tem de corresponder à tarefa', () => {
  assert.match(change({ branch: 'task/VIDEO-002-outro' }).join('\n'), /branch atual/);
});

test('bootstrap exige COLAB-001 ancorada e base sem protocolo/tarefas', () => {
  const setup = done({ id: 'COLAB-001', branch: 'task/COLAB-001-processo', base_commit: INITIAL_BASE, scope: ['COLABORACAO.md'] });
  const input = { baseTasks: [], tasks: [setup], changed: ['tasks/COLAB-001.json', 'COLABORACAO.md'], branch: setup.branch, baseSha: INITIAL_BASE, baseHasProtocol: false };
  assert.deepEqual(change(input), []);
  assert.match(change({ ...input, baseSha: BASE }).join('\n'), /previamente integrada/);
  assert.match(change({ ...input, baseHasProtocol: true }).join('\n'), /previamente integrada/);
  assert.deepEqual(change({ ...input, baseSha: BASE, initialBaseInHistory: true }), []);
  assert.match(change({ ...input, baseSha: BASE, initialBaseInHistory: true, baseHasProtocol: true }).join('\n'), /previamente integrada/);
});

const cli = fileURLToPath(new URL('../scripts/task-workflow.mjs', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'nicho-tasks-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, contents) => {
    mkdirSync(resolve(cwd, path, '..'), { recursive: true });
    writeFileSync(resolve(cwd, path), contents);
  };
  const save = value => write(`tasks/${value.id}.json`, `${JSON.stringify(value, null, 2)}\n`);
  const check = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TASK_BASE: 'master', TASK_BRANCH: '' } });
  git('init', '-b', 'master');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', resolve(cwd, 'no-hooks'));
  write('COLABORACAO.md', 'Protocolo\n');
  write('src/other.ts', 'export const x = 1;\n');
  save(task());
  git('add', '.');
  git('commit', '-m', 'Reserva previamente integrada');
  git('switch', '-c', 'task/VIDEO-001-contrato');
  return { cwd, git, write, save, check };
}

test('CLI inclui arquivos novos fora do escopo na verificação local', t => {
  const f = fixture(t);
  f.save(done());
  f.write('src/unreserved.ts', 'export {};\n');
  assert.throws(() => f.check('check'), /fora da reserva publicada/);
});

test('hook inspeciona o stage, mesmo que o arquivo local pareça válido', t => {
  const f = fixture(t);
  f.save(done({ acceptance: [{ text: 'Ainda falta', done: false }] }));
  f.write('src/video/project.ts', 'export {};\n');
  f.git('add', '.');
  f.save(done());
  assert.doesNotThrow(() => f.check('check'));
  assert.throws(() => f.check('check', '--staged'), /acceptance ainda tem pendências/);
  f.git('add', 'tasks/VIDEO-001.json');
  assert.doesNotThrow(() => f.check('check', '--staged'));
});

test('CLI considera origem e destino de renome', t => {
  const f = fixture(t);
  f.save(done());
  mkdirSync(resolve(f.cwd, 'src/video'), { recursive: true });
  f.git('mv', 'src/other.ts', 'src/video/other.ts');
  assert.throws(() => f.check('check'), /fora da reserva publicada: src\/other.ts/);
});

test('CI aceita snapshot final commitado com reserva na base', t => {
  const f = fixture(t);
  f.save(done());
  f.write('src/video/project.ts', 'export {};\n');
  f.git('add', '.');
  f.git('commit', '-m', 'Implementação e baixa');
  assert.doesNotThrow(() => f.check('check', '--ci'));
});

test('CLI cria reserva sem sobrescrever registro existente', t => {
  const f = fixture(t);
  f.git('switch', '-c', 'task/VIDEO-002-render');
  const args = ['new', 'VIDEO-002', '--title', 'Render', '--owner', 'Sidney / Claude / B', '--scope', 'worker/', '--step', 'Definir worker', '--accept', 'Contrato validado'];
  assert.doesNotThrow(() => f.check(...args));
  assert.equal(readTasks(f.cwd).find(value => value.id === 'VIDEO-002').status, 'in_progress');
  assert.throws(() => f.check(...args), /já existe/);
});

test('instalador preserva hook existente', t => {
  const f = fixture(t);
  assert.throws(() => f.check('setup'), /já definido/);
});

test('base avançada exige integração antes de comparar os arquivos', t => {
  const f = fixture(t);
  f.git('switch', 'master');
  f.write('src/another-developer.ts', 'export {};\n');
  f.git('add', '.');
  f.git('commit', '-m', 'Outra tarefa integrada');
  f.git('switch', 'task/VIDEO-001-contrato');
  assert.throws(() => f.check('check'), /A base avançou ou divergiu/);
});

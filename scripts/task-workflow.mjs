import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INITIAL_BASE = 'ff17c95baba26ef058e94d947aabcf1ab96fd8d8';
const ID = /^[A-Z][A-Z0-9]*-\d{3,}$/;
const TASK_PATH = /^tasks\/([A-Z][A-Z0-9]*-\d{3,})\.json$/;
const ACTIVE = new Set(['in_progress', 'blocked', 'in_review']);
const CLOSED = new Set(['done', 'cancelled']);
const TRANSITIONS = {
  planned: ['planned', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'blocked', 'in_review', 'done', 'cancelled'],
  blocked: ['blocked', 'in_progress', 'cancelled'],
  in_review: ['in_review', 'in_progress', 'blocked', 'done', 'cancelled'],
  done: ['done'],
  cancelled: ['cancelled'],
};
const text = value => typeof value === 'string' && value.trim().length > 0;
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const taskPath = task => `tasks/${task.id}.json`;

export function validScope(value) {
  if (!text(value) || value.trim() !== value || /[\\*?\[\]{}\s:]/.test(value) || value.startsWith('/')) return false;
  const pieces = value.replace(/\/$/, '').split('/');
  return pieces.every(part => part && part !== '.' && part !== '..' && part !== '.git');
}

export function covers(scope, path) {
  return scope.endsWith('/') ? path.startsWith(scope) : path === scope;
}

export function overlaps(a, b) {
  return a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}

export function validateCatalog(tasks) {
  const errors = [];
  const ids = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      errors.push('Registro de tarefa precisa ser um objeto.');
      continue;
    }
    const label = task.id || '(sem ID)';
    const fail = message => errors.push(`${label}: ${message}`);
    if (!ID.test(task.id)) fail('ID inválido. Use PREFIXO-001.');
    if (ids.has(task.id)) fail('ID duplicado.');
    ids.add(task.id);
    for (const key of ['title', 'owner', 'branch']) if (!text(task[key])) fail(`${key} obrigatório.`);
    if (!Object.hasOwn(TRANSITIONS, task.status)) fail('status inválido.');
    if (typeof task.branch !== 'string' || !task.branch.startsWith(`task/${task.id}-`) || !/^task\/[A-Z][A-Z0-9]*-\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.branch)) fail('branch deve ser task/ID-descricao-em-minusculas.');
    if (!/^[a-f0-9]{40}$/.test(task.base_commit)) fail('base_commit precisa ser um SHA completo.');
    if (!isoDate(task.created_at) || !isoDate(task.updated_at) || Date.parse(task.updated_at) < Date.parse(task.created_at)) fail('created_at/updated_at inválidos.');
    if (!Array.isArray(task.scope) || !task.scope.length || task.scope.some(s => !validScope(s))) fail('scope exige caminhos relativos exatos ou diretórios com /.');
    if (!Array.isArray(task.depends_on) || task.depends_on.some(dep => !ID.test(dep) || dep === task.id) || new Set(task.depends_on).size !== task.depends_on.length) fail('depends_on inválido.');
    for (const key of ['checklist', 'acceptance']) {
      if (!Array.isArray(task[key]) || !task[key].length || task[key].some(item => !item || !text(item.text) || typeof item.done !== 'boolean')) fail(`${key} exige itens {text, done}.`);
    }
    if (!Array.isArray(task.notes) || task.notes.some(note => !text(note))) fail('notes precisa ser uma lista de textos.');
    if (!Array.isArray(task.validation) || task.validation.some(v => !v || !text(v.command) || !text(v.details) || !['passed', 'failed', 'blocked'].includes(v.result))) fail('validation exige command, result e details.');
    if (typeof task.result !== 'string') fail('result precisa ser texto.');
    if (task.status === 'blocked' && (!Array.isArray(task.notes) || !task.notes.some(text))) fail('tarefa bloqueada exige motivo em notes.');
    if (['in_review', 'done'].includes(task.status)) {
      for (const key of ['checklist', 'acceptance']) if (!Array.isArray(task[key]) || task[key].some(item => item?.done !== true)) fail(`${key} ainda tem pendências.`);
      if (!Array.isArray(task.validation) || !task.validation.length || task.validation.some(v => v?.result !== 'passed')) fail('conclusão/revisão exige validações aprovadas.');
      if (!text(task.result)) fail('conclusão/revisão exige resultado.');
    }
    if (CLOSED.has(task.status) && (!isoDate(task.completed_at) || Date.parse(task.completed_at) < Date.parse(task.created_at) || Date.parse(task.completed_at) > Date.parse(task.updated_at))) fail('encerramento exige completed_at válido, entre created_at e updated_at.');
    if (task.status === 'cancelled' && !text(task.result)) fail('cancelamento exige justificativa em result.');
  }
  if (errors.length) return errors;
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (!byId.has(dep)) errors.push(`${task.id}: dependência ${dep} inexistente.`);
      else if ((ACTIVE.has(task.status) || task.status === 'done') && byId.get(dep).status !== 'done') errors.push(`${task.id}: dependência ${dep} ainda não concluída.`);
    }
  }
  // Detect cycles even among planned tasks, before anyone reserves them.
  const visited = new Set();
  const visiting = new Set();
  function visit(task) {
    if (visiting.has(task.id)) { errors.push(`${task.id}: ciclo de dependências.`); return; }
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dep of task.depends_on) if (byId.has(dep)) visit(byId.get(dep));
    visiting.delete(task.id);
    visited.add(task.id);
  }
  tasks.forEach(visit);
  const active = tasks.filter(task => ACTIVE.has(task.status));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i];
      const right = active[j];
      const conflict = [...left.scope, taskPath(left)].find(a => [...right.scope, taskPath(right)].some(b => overlaps(a, b)));
      if (conflict) errors.push(`${left.id} x ${right.id}: reservas sobrepostas em ${conflict}.`);
    }
  }
  return errors;
}

export function validateChanges({ baseTasks, tasks, changed, branch, baseSha, baseHasProtocol = true, initialBaseInHistory = false, ci = false }) {
  const errors = validateCatalog(tasks);
  if (errors.length) return errors;
  const base = new Map(baseTasks.map(task => [task.id, task]));
  const current = new Map(tasks.map(task => [task.id, task]));
  const records = changed.filter(path => TASK_PATH.test(path));
  const implementation = changed.filter(path => !TASK_PATH.test(path));
  for (const path of changed.filter(path => path.startsWith('tasks/') && !TASK_PATH.test(path))) errors.push(`${path}: tasks/ aceita apenas registros ID.json.`);
  for (const old of baseTasks) {
    const next = current.get(old.id);
    if (!next) { errors.push(`${old.id}: não apague o histórico da tarefa.`); continue; }
    if (CLOSED.has(old.status) && !same(old, next)) errors.push(`${old.id}: tarefa encerrada é imutável; crie outro ID.`);
    if (!TRANSITIONS[old.status]?.includes(next.status)) errors.push(`${old.id}: transição ${old.status} → ${next.status} proibida.`);
    if (next.created_at !== old.created_at || Date.parse(next.updated_at) < Date.parse(old.updated_at)) errors.push(`${old.id}: datas do histórico não podem retroceder.`);
  }
  if (!changed.length) return errors;
  if (records.length !== 1) {
    errors.push('Cada mudança/PR deve atualizar exatamente um registro tasks/ID.json.');
    return errors;
  }
  const id = records[0].match(TASK_PATH)[1];
  const task = current.get(id);
  if (!task) return [...errors, `${id}: registro removido.`];
  if (branch !== task.branch) errors.push(`${id}: branch atual ${branch || '(detached)'} difere de ${task.branch}.`);
  const old = base.get(id);
  // The initial claim stays anchored, even if unrelated pre-protocol work advances master.
  // Once the protocol or any reservation reaches master this exception cannot apply.
  const bootstrap = (baseSha === INITIAL_BASE || initialBaseInHistory) && !baseHasProtocol && !baseTasks.length && id === 'COLAB-001' && task.base_commit === INITIAL_BASE;
  if (!old && !bootstrap && !['planned', 'in_progress'].includes(task.status)) errors.push(`${id}: nova tarefa só pode iniciar como planned ou in_progress.`);
  if (ACTIVE.has(task.status) || implementation.length) {
    for (const dep of task.depends_on) if (base.get(dep)?.status !== 'done') errors.push(`${id}: dependência ${dep} precisa estar done na base compartilhada.`);
    // A base reservation cannot be released merely by editing another task in this PR.
    for (const other of baseTasks.filter(t => t.id !== id && ACTIVE.has(t.status))) {
      if ([...task.scope, taskPath(task)].some(a => [...other.scope, taskPath(other)].some(b => overlaps(a, b)))) errors.push(`${id}: escopo ainda reservado por ${other.id} na base compartilhada.`);
    }
  }
  if (!implementation.length) {
    return errors;
  }
  if (!bootstrap && (!old || !['in_progress', 'in_review'].includes(old.status))) errors.push(`${id}: implementação exige reserva ativa previamente integrada à master.`);
  if (old) {
    for (const field of ['owner', 'branch', 'scope', 'depends_on', 'base_commit']) if (!same(task[field], old[field])) errors.push(`${id}: altere ${field} em PR só de registro antes da implementação.`);
  }
  if (!['in_progress', 'in_review', 'done'].includes(task.status)) errors.push(`${id}: estado ${task.status} não permite implementação.`);
  if (ci && task.status !== 'done') errors.push(`${id}: PR de implementação exige checklist completo e baixa (done).`);
  const reserved = bootstrap ? task.scope : (old?.scope || []);
  for (const path of implementation) if (!reserved.some(scope => covers(scope, path))) errors.push(`${id}: arquivo fora da reserva publicada: ${path}.`);
  return errors;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function resolveRef(ref, cwd) {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], cwd);
}

export function readTasks(cwd, ref) {
  let paths;
  if (ref) paths = git(ref === ':' ? ['ls-files', '-z', '--', 'tasks/'] : ['ls-tree', '-r', '--name-only', '-z', ref, '--', 'tasks/'], cwd).split('\0').filter(Boolean);
  else paths = existsSync(resolve(cwd, 'tasks')) ? readdirSync(resolve(cwd, 'tasks')).map(name => `tasks/${name}`) : [];
  return paths.map(path => {
    const match = path.match(TASK_PATH);
    if (!match) throw new Error(`Arquivo inesperado: ${path}; use tasks/ID.json.`);
    if (!ref && !lstatSync(resolve(cwd, path)).isFile()) throw new Error(`${path}: registro deve ser arquivo normal.`);
    if (ref) {
      const metadata = git(ref === ':' ? ['ls-files', '--stage', '--', path] : ['ls-tree', ref, '--', path], cwd);
      if (!metadata.startsWith('100644 ')) throw new Error(`${path}: registro deve ser arquivo normal, modo 100644.`);
    }
    const contents = ref ? git(['show', ref === ':' ? `:${path}` : `${ref}:${path}`], cwd) : readFileSync(resolve(cwd, path), 'utf8');
    const task = JSON.parse(contents);
    if (task?.id !== match[1]) throw new Error(`${path}: ID interno não corresponde ao arquivo.`);
    return task;
  });
}

function option(args, name, fallback) {
  const position = args.indexOf(name);
  if (position < 0) return fallback;
  if (!args[position + 1] || args[position + 1].startsWith('--')) throw new Error(`Falta valor para ${name}.`);
  return args[position + 1];
}

function options(args, name) {
  return args.flatMap((arg, index) => arg === name ? [option(args.slice(index), name)] : []);
}

function assertValid(errors) {
  if (errors.length) throw new Error(errors.join('\n'));
}

export function run(args, cwd = process.cwd()) {
  const [command = 'list', ...flags] = args;
  cwd = git(['rev-parse', '--show-toplevel'], cwd);
  if (command === 'list') {
    const ref = option(flags, '--ref');
    const tasks = readTasks(cwd, ref ? resolveRef(ref, cwd) : undefined);
    assertValid(validateCatalog(tasks));
    console.log(`Quadro: ${ref || 'cópia local'} (atualize origin com git fetch antes de consultar)`);
    for (const task of tasks) console.log(`${task.id}\t${task.status}\t${task.owner}\t${task.title}\n  escopo: ${task.scope.join(', ')}`);
    return;
  }
  if (command === 'setup') {
    let current = '';
    try { current = git(['config', '--get', 'core.hooksPath'], cwd); } catch (error) { if (error.status !== 1) throw error; }
    if (current && current !== '.githooks') throw new Error(`core.hooksPath já definido como ${current}; integre manualmente o hook sem sobrescrever o existente.`);
    chmodSync(resolve(cwd, '.githooks/pre-commit'), 0o755);
    git(['config', '--local', 'core.hooksPath', '.githooks'], cwd);
    console.log('Hook pre-commit instalado. Leia COLABORACAO.md; proteção remota exige configuração no GitHub.');
    return;
  }
  const baseRef = option(flags, '--base', process.env.TASK_BASE || 'origin/master');
  if (command === 'new') {
    const id = flags[0];
    if (!ID.test(id)) throw new Error('Uso: new ID --title TEXTO --owner TEXTO --scope CAMINHO --step TEXTO --accept TEXTO');
    const path = resolve(cwd, `tasks/${id}.json`);
    if (existsSync(path)) throw new Error(`${id} já existe. Atualize seu registro ou escolha outro ID.`);
    const now = new Date().toISOString();
    const task = {
      id, title: option(flags, '--title'), status: 'in_progress', owner: option(flags, '--owner'),
      branch: git(['branch', '--show-current'], cwd), created_at: now, updated_at: now,
      base_commit: resolveRef(baseRef, cwd), depends_on: options(flags, '--depends'), scope: options(flags, '--scope'),
      checklist: options(flags, '--step').map(value => ({ text: value, done: false })),
      acceptance: options(flags, '--accept').map(value => ({ text: value, done: false })),
      validation: [], result: '', notes: [],
    };
    const baseTasks = readTasks(cwd, task.base_commit);
    if (baseTasks.some(item => item.id === id)) throw new Error(`${id} já existe na base compartilhada.`);
    const tasks = [...readTasks(cwd), task];
    assertValid(validateChanges({ baseTasks, tasks, changed: [taskPath(task)], branch: task.branch, baseSha: task.base_commit }));
    mkdirSync(resolve(cwd, 'tasks'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(task, null, 2)}\n`, { flag: 'wx' });
    console.log(`${taskPath(task)} criado. Integre primeiro um PR somente da reserva; depois implemente.`);
    return;
  }
  if (command !== 'check') throw new Error('Comandos: list, new, setup, check. Consulte TODO.md.');
  const staged = flags.includes('--staged');
  const ci = flags.includes('--ci');
  const tasks = readTasks(cwd, staged ? ':' : ci ? 'HEAD' : undefined);
  if (flags.includes('--catalog')) {
    assertValid(validateCatalog(tasks));
    console.log(`Catálogo válido: ${tasks.length} tarefa(s).`);
    return;
  }
  const baseSha = resolveRef(baseRef, cwd);
  try { git(['merge-base', '--is-ancestor', baseSha, 'HEAD'], cwd); }
  catch { throw new Error('A base avançou ou divergiu. Integre origin/master à sua branch antes de validar, preservando alterações alheias.'); }
  const baseTasks = readTasks(cwd, baseSha);
  const diffArgs = ['diff', '--name-only', '--no-renames', '-z', ...(staged ? ['--cached'] : []), baseSha, ...(ci ? ['HEAD'] : []), '--'];
  const changed = git(diffArgs, cwd).split('\0').filter(Boolean);
  if (!staged && !ci) changed.push(...git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0').filter(Boolean));
  const branch = process.env.TASK_BRANCH || git(['branch', '--show-current'], cwd);
  const baseHasProtocol = Boolean(git(['ls-tree', '--name-only', baseSha, '--', 'COLABORACAO.md'], cwd));
  let initialBaseInHistory = false;
  if (!baseHasProtocol && !baseTasks.length) {
    try { git(['merge-base', '--is-ancestor', INITIAL_BASE, baseSha], cwd); initialBaseInHistory = true; } catch { /* Not the initial repository lineage. */ }
  }
  assertValid(validateChanges({ baseTasks, tasks, changed: [...new Set(changed)], branch, baseSha, baseHasProtocol, initialBaseInHistory, ci }));
  console.log(`Fluxo válido: ${changed.length} arquivo(s), base ${baseSha.slice(0, 7)}${staged ? ', snapshot staged' : ''}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)); }
  catch (error) {
    console.error(`Protocolo de colaboração: ${error.message}`);
    process.exitCode = 1;
  }
}

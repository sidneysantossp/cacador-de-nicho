import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Video Edit history listing stays payload-free and versions load lazily',()=>{
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/video-editor.ts'),'utf8');
  const listStart=server.indexOf('export async function loadVideoEditHistory(');
  const versionStart=server.indexOf('export async function loadVideoEditHistoryVersion(',listStart);
  const eligibleStart=server.indexOf('async function eligibleContext(',versionStart);
  assert.ok(listStart>=0&&versionStart>listStart&&eligibleStart>versionStart);

  const listBlock=server.slice(listStart,versionStart);
  assert.match(listBlock,/select\('version,status,created_at'\)/);
  assert.doesNotMatch(listBlock,/select\([^\n]*payload/);
  assert.doesNotMatch(listBlock,/upgradeVideoEditPayload/);

  const versionBlock=server.slice(versionStart,eligibleStart);
  assert.match(versionBlock,/select\('version,status,payload,created_at'\)/);
  assert.match(versionBlock,/upgradeVideoEditPayload/);

  const route=readFileSync(resolve(process.cwd(),'src/app/api/video-editor/route.ts'),'utf8');
  assert.match(route,/historyVersion/);
  assert.match(route,/loadVideoEditHistoryVersion/);

  const ui=readFileSync(resolve(process.cwd(),'src/components/video-editor-workspace.tsx'),'utf8');
  assert.match(ui,/async function loadHistoryVersion/);
  assert.match(ui,/payload carregado somente sob demanda/);
});

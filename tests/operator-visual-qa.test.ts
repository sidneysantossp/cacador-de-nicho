import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');

test('operator visual QA is a narrow fallback for blocked automated review',()=>{
  const preflight=read('src/lib/server/visual-asset-preflight.ts');
  const route=read('src/app/api/asset-factory/route.ts');
  assert.match(preflight,/recordOperatorSceneAssetVisualQa/);
  assert.match(preflight,/prior\.status!=='blocked'/);
  assert.match(preflight,/model:'operator-manual-review'/);
  assert.match(preflight,/reason:'automated-reviewer-unavailable'/);
  assert.match(preflight,/visualQaHistory/);
  assert.match(route,/action:z\.literal\('operatorVisualQa'\)/);
  assert.match(route,/relevance:z\.number\(\)\.min\(\.50\)\.max\(1\)/);
  assert.match(route,/recordOperatorSceneAssetVisualQa\(body\)/);
});

test('operator fallback cannot approve an unready asset or low review scores',()=>{
  const preflight=read('src/lib/server/visual-asset-preflight.ts');
  assert.match(preflight,/row\.status!=='ready'/);
  assert.match(preflight,/value<\.50\|\|value>1/);
});

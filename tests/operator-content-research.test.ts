import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('operator can explicitly generate research for one Content Project without global AI autorun',()=>{
  const auth=read('src/lib/server/auth.ts');
  const helper=read('ops/self-hosted/bin/cacadores-agent-api');
  const route=read('src/app/api/content-research/route.ts');
  assert.match(auth,/\/api\/content-research/);
  assert.match(helper,/\/api\/content-research/);
  assert.match(route,/requireOperator\(request\)/);
  assert.match(route,/generateContentResearchForProject/);
  assert.doesNotMatch(route,/providerAiAutorun|CACADORES_AI_AUTORUN/);
  assert.match(route,/supportedClaims/);
  assert.match(route,/hasResearchPack/);
});

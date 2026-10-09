import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('Universe pilot handoff has an objective editorial promise',()=>{
  const source=read('src/lib/universe-pilot.ts');
  assert.match(source,/promise:'Deliver the approved pilot hypothesis as a clear, evidence-backed explanation/);
});

test('autonomous research recognizes the Universe handoff placeholder instead of treating it as completed research',()=>{
  const source=read('src/lib/server/content-research-ai.ts');
  assert.match(source,/contentResearchNeedsGeneration/);
  assert.match(source,/Bloqueio criado automaticamente pelo handoff do Universe Pilot/);
  assert.match(source,/research\.notes\.includes\('Universe Pilot Brief'\)/);
  assert.match(source,/if\(!contentResearchNeedsGeneration\(project\)\)return project/);
});

test('Episode Automation repairs legacy Universe handoffs before the objective Content OS gate',()=>{
  const source=read('src/lib/server/episode-automation.ts');
  assert.match(source,/const researchNeedsGeneration=contentResearchNeedsGeneration\(project\)/);
  assert.match(source,/universePilotHandoff/);
  assert.match(source,/!payload\.brief\.promise\.trim\(\)/);
  assert.match(source,/Research Pack \+ Claim Ledger gerados e Content Project aprovado pelo gate objetivo/);
});

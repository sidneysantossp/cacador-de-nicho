import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('agent Episode Automation RPC is bodyless and limited to safe run transitions',()=>{
  const source=readFileSync(
    resolve(process.cwd(),'src/app/api/episode-automation/agent/route.ts'),
    'utf8'
  );
  assert.match(source,/requireOperator\(request\)/);
  assert.match(source,/z\.enum\(\['reconcile','advance','resume','armFactory','drain'\]\)/);
  assert.match(source,/url\.searchParams\.get\('action'\)/);
  assert.match(source,/url\.searchParams\.get\('runId'\)/);
  assert.doesNotMatch(source,/request\.json\(\)/);
  assert.match(source,/advanceEpisodeAutomationRun/);
  assert.match(source,/armOperatorFactoryAutomationRun/);
  assert.match(source,/drainEpisodeAutomationRun/);
  assert.match(source,/resumeEpisodeAutomationRun/);
  assert.match(source,/reconcileEpisodeAutomationRun/);
});

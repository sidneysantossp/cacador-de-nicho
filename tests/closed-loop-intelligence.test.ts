import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  channelAutopilotLearningEnabled, channelLearningWindows,
  defaultChannelAutopilot, effectiveChannelAutopilot
} from '../src/lib/channel-autopilot-policy';

test('Closed Loop defaults are evidence-first and bounded',()=>{
  const settings=effectiveChannelAutopilot({});
  assert.equal(settings.learningLoopEnabled,true);
  assert.deepEqual(settings.learningWindowsHours,[24,72,168]);
  assert.equal(settings.autoApprovePerformance,true);
  assert.equal(settings.autoAnalyzeAudience,true);
  assert.equal(settings.autoApproveAudience,true);
  assert.equal(channelAutopilotLearningEnabled({}),false);
});

test('Closed Loop windows dedupe, sort and reject unsafe horizons',()=>{
  assert.deepEqual(channelLearningWindows({
    autopilot:{
      ...defaultChannelAutopilot,
      enabled:true,
      learningWindowsHours:[168,24,72,24,720,0,721]
    }
  }),[24,72,168,720]);
});

test('Closed Loop worker is valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/closed-loop-worker.mjs'],{stdio:'pipe'});
});

test('YouTube performance collection exposes deterministic observation id support',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile('src/lib/server/performance-analyst.ts','utf8');
  assert.match(source,/options:\{observationId\?:string\}/);
  assert.match(source,/id:options\.observationId\?\?crypto\.randomUUID\(\)/);
});

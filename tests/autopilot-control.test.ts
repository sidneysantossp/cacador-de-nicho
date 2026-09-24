import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPILOT_CONCURRENCY_MAX, AUTOPILOT_CONCURRENCY_MIN,
  autopilotControlCanRun, autopilotControlStatusLabel,
  boundedAutopilotConcurrency, defaultAutopilotControl,
  normalizeAutopilotControlPayload
} from '../src/lib/autopilot-control-policy';

const now='2026-09-24T03:00:00.000Z';

test('Autopilot Control Plane defaults fail closed',()=>{
  const control=defaultAutopilotControl(now);
  assert.equal(control.status,'paused');
  assert.equal(control.maxConcurrentAutomationRuns,1);
  assert.equal(control.maxConcurrentLearningJobs,1);
  assert.equal(control.updatedBy,'system');
  assert.ok(control.pauseReason.length>0);
  assert.equal(autopilotControlCanRun({status:control.status}),false);
});

test('Autopilot concurrency is bounded between safe limits',()=>{
  assert.equal(AUTOPILOT_CONCURRENCY_MIN,1);
  assert.equal(AUTOPILOT_CONCURRENCY_MAX,10);
  assert.equal(boundedAutopilotConcurrency(-9),1);
  assert.equal(boundedAutopilotConcurrency(0),1);
  assert.equal(boundedAutopilotConcurrency(3.4),3);
  assert.equal(boundedAutopilotConcurrency(99),10);
  assert.equal(boundedAutopilotConcurrency(Number.NaN),1);
});

test('Autopilot Control normalization trims reason and bounds concurrency',()=>{
  const payload=normalizeAutopilotControlPayload({
    ...defaultAutopilotControl(now),
    status:'running',
    pauseReason:'  maintenance window  ',
    maxConcurrentAutomationRuns:99,
    maxConcurrentLearningJobs:-5,
    updatedBy:'operator'
  });
  assert.equal(payload.id,'global');
  assert.equal(payload.status,'running');
  assert.equal(payload.pauseReason,'maintenance window');
  assert.equal(payload.maxConcurrentAutomationRuns,10);
  assert.equal(payload.maxConcurrentLearningJobs,1);
  assert.equal(payload.updatedBy,'operator');
});

test('Autopilot Control running state is explicit',()=>{
  const paused={...defaultAutopilotControl(now),version:1};
  const running={...paused,status:'running' as const};
  assert.equal(autopilotControlCanRun({status:paused.status}),false);
  assert.equal(autopilotControlCanRun({status:running.status}),true);
  assert.equal(autopilotControlStatusLabel('paused'),'Paused');
  assert.equal(autopilotControlStatusLabel('running'),'Running');
});

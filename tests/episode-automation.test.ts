import test from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodeAutomationStepState } from '../src/lib/types';
import {
  assistedAutomationPolicy, autonomousAutomationPolicy,
  automationHttpErrorShouldHold, inspectAutomationSteps
} from '../src/lib/episode-automation-policy';

function step(
  step:EpisodeAutomationStepState['step'],
  status:EpisodeAutomationStepState['status'],
  options:Partial<EpisodeAutomationStepState>={}
):EpisodeAutomationStepState{
  return {
    step,status,label:String(step),requiresOperator:false,...options
  };
}

test('Assisted Automation starts with every automatic action disabled',()=>{
  assert.equal(Object.values(assistedAutomationPolicy).every(value=>value===false),true);
});

test('Autonomous Automation enables production but keeps publishing human-controlled',()=>{
  assert.equal(autonomousAutomationPolicy.autoGenerateScript,true);
  assert.equal(autonomousAutomationPolicy.autoGenerateVoice,true);
  assert.equal(autonomousAutomationPolicy.autoGenerateVisualAssets,true);
  assert.equal(autonomousAutomationPolicy.autoRender,true);
  assert.equal(autonomousAutomationPolicy.autoRunQuality,true);
  assert.equal(autonomousAutomationPolicy.autoCreatePackage,true);
  assert.equal(autonomousAutomationPolicy.autoPublish,false);
});

test('Automation inspection picks first unfinished step and marks ready work active',()=>{
  const result=inspectAutomationSteps([
    step('content','completed'),
    step('script','ready',{reason:'Roteiro pode ser gerado.'}),
    step('voice','pending')
  ]);
  assert.equal(result.currentStep,'script');
  assert.equal(result.status,'active');
  assert.equal(result.lastDecision,'Roteiro pode ser gerado.');
  assert.deepEqual(result.blockers,[]);
});

test('Automation inspection reports running external work without advancing past it',()=>{
  const result=inspectAutomationSteps([
    step('content','completed'),
    step('render','running',{reason:'rendering · 72%'}),
    step('quality','pending')
  ]);
  assert.equal(result.currentStep,'render');
  assert.equal(result.status,'running');
  assert.equal(result.lastDecision,'rendering · 72%');
});

test('Operator gates and blockers keep the run waiting',()=>{
  const operator=inspectAutomationSteps([
    step('content','completed'),
    step('packaging','waiting',{requiresOperator:true,reason:'Revisar thumbnail e compliance.'})
  ]);
  assert.equal(operator.currentStep,'packaging');
  assert.equal(operator.status,'waiting');

  const blocked=inspectAutomationSteps([
    step('voice','blocked',{requiresOperator:true,reason:'Production DNA sem voiceId.'})
  ]);
  assert.equal(blocked.status,'waiting');
  assert.deepEqual(blocked.blockers,['voice: Production DNA sem voiceId.']);
});

test('Failed step marks the run failed and completed line becomes done',()=>{
  const failed=inspectAutomationSteps([
    step('render','failed',{reason:'FFmpeg failed.'})
  ]);
  assert.equal(failed.status,'failed');
  assert.equal(failed.currentStep,'render');
  assert.deepEqual(failed.blockers,['render: FFmpeg failed.']);

  const done=inspectAutomationSteps([
    step('content','completed'),
    step('publish','completed')
  ]);
  assert.equal(done.currentStep,'done');
  assert.equal(done.status,'completed');
  assert.equal(done.lastDecision,'Episódio concluiu toda a linha de produção.');
});

test('Recoverable HTTP errors become durable Automation holds',()=>{
  for(const status of [400,409,422,429,503]){
    assert.equal(automationHttpErrorShouldHold(status),true,status+' should hold');
  }
  for(const status of [401,403,404,500,502,504]){
    assert.equal(automationHttpErrorShouldHold(status),false,status+' should fail');
  }
});

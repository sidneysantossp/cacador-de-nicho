import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { EpisodeAutomationStepState } from '../src/lib/types';
import {
  assistedAutomationPolicy, autonomousAutomationPolicy,
  automationHttpErrorShouldHold, automationPackageSnapshotIssues,
  automationPublishSnapshotIssues, automationQualitySnapshotIssues, automationRenderSnapshotIssues,
  automationTimelineSnapshotIssues, automationVideoEditSnapshotIssues, inspectAutomationSteps
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


test('Episode Automation worker is valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/episode-automation-worker.mjs'],{stdio:'pipe'});
});


test('Automation detects stale Timeline asset selection and upstream versions',()=>{
  const payload={
    scenePlanVersion:2,
    visualPromptSetVersion:3,
    tracks:[{
      type:'visual',
      clips:[{sceneId:'scene-1',assetId:'asset-old'}]
    }]
  };
  const issues=automationTimelineSnapshotIssues({
    payload,
    scenePlanVersion:2,
    visualPromptSetVersion:3,
    selectedAssets:[{sceneId:'scene-1',assetId:'asset-new'}]
  });
  assert.deepEqual(issues,['scene-asset-selection-changed']);
});

test('Automation detects Video Edit built from an older Timeline version',()=>{
  const issues=automationVideoEditSnapshotIssues({
    payload:{
      timelineId:'timeline-1',
      timelineVersion:2,
      transcriptId:'transcript-1',
      transcriptVersion:4
    },
    timelineId:'timeline-1',
    timelineVersion:3,
    transcriptId:'transcript-1',
    transcriptVersion:4
  });
  assert.deepEqual(issues,['stale-timeline-version']);
});

test('Automation does not reuse a completed render from an older edit snapshot',()=>{
  const issues=automationRenderSnapshotIssues({
    payload:{
      manifest:{
        videoEditId:'edit-1',
        videoEditVersion:2,
        timelineId:'timeline-1',
        timelineVersion:2,
        transcriptId:'transcript-1',
        transcriptVersion:4
      }
    },
    videoEditId:'edit-1',
    videoEditVersion:3,
    timelineId:'timeline-1',
    timelineVersion:3,
    transcriptId:'transcript-1',
    transcriptVersion:4
  });
  assert.ok(issues.includes('stale-video-edit-version'));
  assert.ok(issues.includes('stale-timeline-version'));
});


test('Automation invalidates QA package and publish when upstream identity changes',()=>{
  assert.deepEqual(automationQualitySnapshotIssues({
    payload:{renderJobId:'render-old',videoEditId:'edit-1',videoEditVersion:2},
    renderJobId:'render-new',
    videoEditId:'edit-1',
    videoEditVersion:3
  }),['stale-render-job','stale-video-edit-version']);

  assert.deepEqual(automationPackageSnapshotIssues({
    payload:{qualityReportId:'qa-old',qualityReportVersion:1,renderJobId:'render-old'},
    qualityReportId:'qa-new',
    qualityReportVersion:2,
    renderJobId:'render-new'
  }),['stale-quality-report','stale-render-job']);

  assert.deepEqual(automationPublishSnapshotIssues({
    payload:{packageId:'pkg-1',packageVersion:1},
    packageId:'pkg-1',
    packageVersion:2
  }),['stale-publication-package']);
});

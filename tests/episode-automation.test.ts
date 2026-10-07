import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { EpisodeAutomationStepState } from '../src/lib/types';
import {
  assistedAutomationPolicy, autonomousAutomationPolicy,
  automationDrainStopReason, automationHttpErrorShouldHold, automationPackageSnapshotIssues,
  automationPublishSnapshotIssues, automationQualitySnapshotIssues, automationRenderSnapshotIssues,
  automationTargetReached, automationTimelineSnapshotIssues,
  automationVideoEditSnapshotIssues, inspectAutomationSteps,
  operatorFactoryAutomationPolicy, visualAssetBatchPlan
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

test('Operator Factory automates deterministic production but keeps creative authoring and publishing explicit',()=>{
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateResearch,false);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateScript,false);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVisualPrompts,false);
  assert.equal(operatorFactoryAutomationPolicy.autoApproveObjectiveGates,true);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVoice,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateTranscript,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateScenes,true);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVisualAssets,true);
  assert.equal(operatorFactoryAutomationPolicy.autoBuildTimeline,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateVideoEdit,true);
  assert.equal(operatorFactoryAutomationPolicy.autoRender,true);
  assert.equal(operatorFactoryAutomationPolicy.autoRunQuality,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreatePackage,false);
  assert.equal(operatorFactoryAutomationPolicy.autoPublish,false);
});

test('Golden Path drain stops on external work, operator input, or target completion',()=>{
  const running=[step('visual-assets','running',{reason:'stock processing'})];
  assert.equal(automationDrainStopReason({
    status:'running',currentStep:'visual-assets',steps:running,target:'master'
  }),'external-work-running');

  const operator=[step('script','ready',{requiresOperator:true,reason:'ChatGPT script required'})];
  assert.equal(automationDrainStopReason({
    status:'waiting',currentStep:'script',steps:operator,target:'master'
  }),'operator-input-required');

  const passed=[
    step('render','completed'),
    step('quality','completed'),
    step('packaging','ready',{requiresOperator:true})
  ];
  assert.equal(automationTargetReached(passed,'master'),true);
  assert.equal(automationTargetReached(passed,'package'),false);
  assert.equal(automationDrainStopReason({
    status:'waiting',currentStep:'packaging',steps:passed,target:'master'
  }),'target-reached');
});

test('Operator Factory policy automates deterministic production through QA but never packaging or publish',()=>{
  assert.equal(operatorFactoryAutomationPolicy.autoApproveObjectiveGates,true);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVoice,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateTranscript,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateScenes,true);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVisualAssets,true);
  assert.equal(operatorFactoryAutomationPolicy.autoBuildTimeline,true);
  assert.equal(operatorFactoryAutomationPolicy.autoCreateVideoEdit,true);
  assert.equal(operatorFactoryAutomationPolicy.autoRender,true);
  assert.equal(operatorFactoryAutomationPolicy.autoRunQuality,true);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateResearch,false);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateScript,false);
  assert.equal(operatorFactoryAutomationPolicy.autoGenerateVisualPrompts,false);
  assert.equal(operatorFactoryAutomationPolicy.autoCreatePackage,false);
  assert.equal(operatorFactoryAutomationPolicy.autoPublish,false);
});

test('Golden Path drain stops at approved master before packaging',()=>{
  const steps=[
    step('quality','completed'),
    step('packaging','ready'),
    step('publish','pending')
  ];
  assert.equal(automationDrainStopReason({
    status:'active',
    currentStep:'packaging',
    steps,
    target:'master'
  }),'target-reached');
});

test('Golden Path drain waits for async work and genuine operator input',()=>{
  assert.equal(automationDrainStopReason({
    status:'running',
    currentStep:'visual-assets',
    steps:[step('visual-assets','running',{reason:'stock jobs processing'})],
    target:'master'
  }),'external-work-running');

  assert.equal(automationDrainStopReason({
    status:'waiting',
    currentStep:'script',
    steps:[step('script','ready',{requiresOperator:true,reason:'Import ChatGPT script'})],
    target:'master'
  }),'operator-input-required');
});

test('Golden Path drain keeps deterministic ready work actionable',()=>{
  assert.equal(automationDrainStopReason({
    status:'active',
    currentStep:'timeline',
    steps:[step('timeline','ready',{requiresOperator:false})],
    target:'master'
  }),null);
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



test('Episode Automation worker prefers self-hosted database credentials',()=>{
  const source=readFileSync('scripts/episode-automation-worker.mjs','utf8');
  assert.match(source,/process\.env\.DATABASE_API_URL\|\|process\.env\.SUPABASE_URL/);
  assert.match(source,/process\.env\.DATABASE_SERVICE_ROLE_KEY\|\|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source,/DATABASE_URL\+'\/rest\/v1\/rpc\/'/);
  assert.doesNotMatch(source,/SUPABASE_URL\+'\/rest\/v1\/rpc\/'/);
});

test('Operator Golden Path exposes bounded arm and drain API without enabling global autopilot',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  const route=readFileSync('src/app/api/episode-automation/route.ts','utf8');
  const agent=readFileSync('src/app/api/episode-automation/agent/route.ts','utf8');
  assert.match(source,/export async function armOperatorFactoryAutomationRun/);
  assert.match(source,/export async function drainEpisodeAutomationRun/);
  assert.match(source,/const operatorToken=await acquireOperatorAutomationLease\(input\.runId\)/);
  assert.match(source,/advanceEpisodeAutomationRunUnderLease/);
  assert.match(source,/maxTransitions=Math\.max\(1,Math\.min\(100/);
  assert.match(source,/maxDurationMs=Math\.max\(5000,Math\.min\(280000/);
  assert.match(route,/action:z\.literal\('armFactory'\)/);
  assert.match(route,/action:z\.literal\('drain'\)/);
  assert.match(agent,/armFactory/);
  assert.match(agent,/drain/);
  assert.doesNotMatch(source,/armOperatorFactoryAutomationRun[\s\S]{0,1200}assertAutopilotControlRunning/);
});

test('Assisted Automation serializes direct advances with an exclusive operator lease',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/async function acquireOperatorAutomationLease/);
  assert.match(source,/const operatorToken=crypto\.randomUUID\(\)/);
  assert.match(source,/\.is\('worker_token',null\)/);
  assert.match(source,/lease_until:new Date\(now\.getTime\(\)\+300000\)\.toISOString\(\)/);
  assert.match(source,/Automation Run já está sendo processado por outro executor/);
  assert.match(source,/const operatorToken=workerToken\?null:await acquireOperatorAutomationLease\(runId\)/);
  assert.match(source,/if\(operatorToken\)await releaseAutomationLease\(runId,operatorToken\)\.catch\(\(\)=>\{\}\)/);
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


test('Visual asset batching skips covered and already-running stock scenes without starvation',()=>{
  const result=visualAssetBatchPlan({
    sceneIds:['s1','s2','s3','s4','s5','s6'],
    selectedReadySceneIds:['s1'],
    activeStockSceneIds:['s2','s3'],
    batchSize:2
  });
  assert.deepEqual(result.missing,['s2','s3','s4','s5','s6']);
  assert.deepEqual(result.waiting,['s2','s3']);
  assert.deepEqual(result.eligible,['s4','s5','s6']);
  assert.deepEqual(result.targets,['s4','s5']);
});

test('Visual asset batching preserves scene order, deduplicates ids, and clamps batch size',()=>{
  const result=visualAssetBatchPlan({
    sceneIds:['s1','s1','s2','s3','s4'],
    selectedReadySceneIds:[],
    activeStockSceneIds:[],
    batchSize:999
  });
  assert.deepEqual(result.missing,['s1','s2','s3','s4']);
  assert.deepEqual(result.targets,['s1','s2','s3','s4']);
});

test('Visual asset batching reports waiting-only state without creating duplicate targets',()=>{
  const result=visualAssetBatchPlan({
    sceneIds:['s1','s2','s3'],
    selectedReadySceneIds:['s1'],
    activeStockSceneIds:['s2','s3'],
    batchSize:4
  });
  assert.deepEqual(result.missing,['s2','s3']);
  assert.deepEqual(result.waiting,['s2','s3']);
  assert.deepEqual(result.targets,[]);
});


test('Automation worker drains ready backlog without the idle poll delay',()=>{
  const source=readFileSync('scripts/episode-automation-worker.mjs','utf8');
  assert.match(source,/AUTOMATION_WORKER_BACKLOG_YIELD_MS/);
  assert.match(source,/Math\.max\(50,Math\.min\(2000/);
  assert.match(source,/await sleep\(BACKLOG_YIELD_MS\)/);
  assert.match(source,/if\(!claimed\)[\s\S]*await sleep\(POLL_MS\)/);
  assert.match(source,/episode-automation-step-error[\s\S]*await sleep\(Math\.max\(POLL_MS,5000\)\)/);
});


test('Visual-assets automation snapshot stays lightweight across repeated batches',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  const start=source.indexOf('async function visualAssetSourceSnapshot');
  const end=source.indexOf('async function sourceSnapshot',start);
  assert.ok(start>=0&&end>start,'lightweight visual snapshot helper missing');
  const block=source.slice(start,end);
  for(const view of [
    'radar_episode_script_list',
    'radar_voice_asset_list',
    'radar_transcript_list'
  ]){
    assert.match(block,new RegExp(view));
  }
  assert.match(block,/radar_scene_plans/);
  assert.match(block,/radar_visual_prompt_sets/);
  assert.match(block,/asset_kind/);
  assert.doesNotMatch(block,/radar_timelines|radar_video_edits|radar_render_jobs|radar_production_quality_reports|radar_publication_packages/);
  assert.match(block,/timeline:null/);
  assert.match(block,/videoEdit:null/);
  assert.match(block,/render:null/);
});


test('Automation advances Visual Prompt AI in bounded resumable batches',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/AUTOMATION_VISUAL_PROMPT_BATCH_SIZE/);
  assert.match(source,/Math\.max\(1,Math\.min\(40/);
  assert.match(source,/aiPlanningIncomplete/);
  assert.match(source,/generateVisualPromptDrafts\(created\.id,\{[\s\S]*maxScenes:VISUAL_PROMPT_BATCH_SIZE/);
});


test('Automation keeps resumable Script generation actionable until all sections exist',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/scriptGenerationIncomplete/);
  assert.match(source,/generation\.completedSections/);
  assert.match(source,/generation\.totalSections/);
  assert.match(source,/generateScriptForProject\(run\.contentProjectId\)/);
});

test('Episode Automation cannot call provider AI in operator-first mode',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/process\.env\.CACADORES_AI_AUTORUN==='1'/);
  assert.match(source,/requiresOperator:!providerAiAutorun\(\)\|\|!run\.policy\.autoGenerateScript/);
  assert.match(source,/requiresOperator:!providerAiAutorun\(\)\|\|!run\.policy\.autoGenerateVisualPrompts/);
  assert.match(source,/Operator-first ativo: importe o roteiro produzido pelo ChatGPT/);
  assert.match(source,/Operator-first ativo: importe as direções visuais produzidas pelo ChatGPT/);
});


test('Automation visual coverage excludes assets from an older prompt version',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/select\('id,scene_id,asset_kind,status,selected,payload,updated_at'\)/);
  assert.match(source,/promptSetVersion\?:unknown/);
  assert.match(source,/Number\(promptSet\?\.version\?\?0\)/);
});


test('Episode Automation self-hosted worker joins the infra network',()=>{
  const sync=readFileSync('ops/self-hosted/bin/cacadores-episode-automation-worker-sync','utf8');
  assert.match(sync,/--network cacadores-infra/);
});


test('Visual-assets automation accepts only motion-compatible route coverage',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/applyDocumentarySourcePolicy/);
  assert.match(source,/sourceRouteForScene\(scene,prompt\?\.direction\)/);
  assert.match(source,/motionRouteAssetSatisfied/);
  assert.match(source,/assetKind:asset\.assetKind,payload:asset/);
});



test('Automation reconcile accepts explicit exhausted-video still fallbacks',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/select\('id,scene_id,asset_kind,status,selected,payload,updated_at'\)/);
  assert.match(source,/sourceRouteForScene\(scene,prompt\?\.direction\)/);
  assert.match(source,/dnaDetail\.research\?\.documentaryMode===true/);
  assert.match(source,/motionRouteAssetSatisfied\(\{route,assetKind:String\(item\.asset_kind\?\?''\),payload:item\.payload\}\)/);
});



test('Operator Golden Path drain holds one exclusive lease across bounded transitions',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/export async function armOperatorFactoryAutomationRun/);
  assert.match(source,/operatorFactoryAutomationPolicy/);
  assert.match(source,/export async function drainEpisodeAutomationRun/);
  assert.match(source,/const operatorToken=await acquireOperatorAutomationLease\(input\.runId\)/);
  assert.match(source,/while\(transitions<maxTransitions\)/);
  assert.match(source,/advanceEpisodeAutomationRunUnderLease\(run\.id\)/);
  assert.match(source,/await releaseAutomationLease\(input\.runId,operatorToken\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf('export async function drainEpisodeAutomationRun'),source.indexOf('export async function advanceClaimedEpisodeAutomationRun')),
    /advanceEpisodeAutomationRun\(run\.id\)/
  );
});

test('Episode Automation API exposes Golden Path arm and drain without enabling publish',()=>{
  const route=readFileSync('src/app/api/episode-automation/route.ts','utf8');
  assert.match(route,/action:z\.literal\('armFactory'\)/);
  assert.match(route,/action:z\.literal\('drain'\)/);
  assert.match(route,/target:z\.enum\(\['master','package','publish'\]\)/);
  assert.match(route,/drainEpisodeAutomationRun\(body\)/);
});

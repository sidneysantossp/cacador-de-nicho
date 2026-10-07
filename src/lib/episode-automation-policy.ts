import type {
  EpisodeAutomationPolicy, EpisodeAutomationStatus, EpisodeAutomationStep,
  EpisodeAutomationStepState
} from './types';

export const assistedAutomationPolicy:EpisodeAutomationPolicy={
  autoGenerateResearch:false,
  autoGenerateScript:false,
  autoApproveObjectiveGates:false,
  autoGenerateVoice:false,
  autoCreateTranscript:false,
  autoCreateScenes:false,
  autoGenerateVisualPrompts:false,
  autoGenerateVisualAssets:false,
  autoBuildTimeline:false,
  autoCreateVideoEdit:false,
  autoRender:false,
  autoRunQuality:false,
  autoCreatePackage:false,
  autoPublish:false
};

export const autonomousAutomationPolicy:EpisodeAutomationPolicy={
  autoGenerateResearch:true,
  autoGenerateScript:true,
  autoApproveObjectiveGates:true,
  autoGenerateVoice:true,
  autoCreateTranscript:true,
  autoCreateScenes:true,
  autoGenerateVisualPrompts:true,
  autoGenerateVisualAssets:true,
  autoBuildTimeline:true,
  autoCreateVideoEdit:true,
  autoRender:true,
  autoRunQuality:true,
  autoCreatePackage:true,
  autoPublish:false
};

/**
 * Golden Path policy for a ChatGPT/operator-owned production run.
 *
 * Creative authoring remains operator-first (research/script/visual prompt writing)
 * while every deterministic production step after those inputs is allowed to
 * advance without repetitive approvals. Publishing and packaging stay explicit;
 * the default production target is the QA-approved master.
 */
export const operatorFactoryAutomationPolicy:EpisodeAutomationPolicy={
  autoGenerateResearch:false,
  autoGenerateScript:false,
  autoApproveObjectiveGates:true,
  autoGenerateVoice:true,
  autoCreateTranscript:true,
  autoCreateScenes:true,
  autoGenerateVisualPrompts:false,
  autoGenerateVisualAssets:true,
  autoBuildTimeline:true,
  autoCreateVideoEdit:true,
  autoRender:true,
  autoRunQuality:true,
  autoCreatePackage:false,
  autoPublish:false
};

export type OperatorDrainTarget='master'|'package'|'publish';

export function automationTargetReached(
  steps:EpisodeAutomationStepState[],
  target:OperatorDrainTarget
){
  const completed=(name:EpisodeAutomationStep)=>
    steps.some(item=>item.step===name&&item.status==='completed');
  if(target==='master')return completed('quality');
  if(target==='package')return completed('packaging');
  return completed('done')||completed('publish');
}

export function automationDrainStopReason(input:{
  status:EpisodeAutomationStatus;
  currentStep:EpisodeAutomationStep;
  holdStep?:EpisodeAutomationStep;
  steps:EpisodeAutomationStepState[];
  target:OperatorDrainTarget;
}):string|null{
  if(automationTargetReached(input.steps,input.target))return 'target-reached';
  if(input.status==='completed')return 'completed';
  if(input.status==='cancelled')return 'cancelled';
  if(input.status==='failed')return 'failed';
  if(input.holdStep)return 'hold';
  const current=input.steps.find(item=>item.step===input.currentStep);
  if(!current)return 'missing-current-step';
  if(current.status==='running')return 'external-work-running';
  if(current.requiresOperator)return 'operator-input-required';
  if(!['ready','waiting'].includes(current.status))return 'step-not-actionable';
  return null;
}

export const episodeAutomationLabels:Record<EpisodeAutomationStep,string>={
  content:'Content Project',
  script:'Script',
  voice:'Voice',
  transcript:'Transcript',
  scenes:'Scene Plan',
  'visual-prompts':'Visual Prompts',
  'visual-assets':'Visual Assets',
  timeline:'Timeline',
  'video-edit':'Video Edit',
  render:'Render',
  quality:'Production QA',
  packaging:'Packaging',
  publish:'Publish',
  done:'Concluído'
};

export function inspectAutomationSteps(steps:EpisodeAutomationStepState[]):{
  currentStep:EpisodeAutomationStep;
  blockers:string[];
  status:EpisodeAutomationStatus;
  lastDecision:string;
}{
  const actionable=steps.find(item=>item.status!=='completed'&&item.status!=='skipped');
  const currentStep=actionable?.step??'done';
  const blockers=steps
    .filter(item=>item.status==='blocked'||item.status==='failed')
    .map(item=>item.label+': '+(item.reason??item.status));
  const status:EpisodeAutomationStatus=currentStep==='done'
    ?'completed'
    :actionable?.status==='failed'
      ?'failed'
      :actionable?.status==='running'
        ?'running'
        :actionable?.status==='blocked'||actionable?.requiresOperator
          ?'waiting'
          :'active';

  return {
    currentStep,
    blockers,
    status,
    lastDecision:currentStep==='done'
      ?'Episódio concluiu toda a linha de produção.'
      :(actionable?.reason??episodeAutomationLabels[currentStep])
  };
}

export function automationHttpErrorShouldHold(status:number){
  return [400,409,422].includes(status);
}

export function automationTransientRetryPolicy(input:{
  status:number;
  message:string;
  attempt:number;
}){
  const status=Math.max(0,Math.round(input.status||0));
  const attempt=Math.max(1,Math.round(input.attempt||1));
  const message=String(input.message??'');
  const transient=
    status===429||status===500||status===502||status===503||status===504||status===507||
    /\b(?:econnreset|econnrefused|etimedout|enotfound|fetch failed|socket hang up)\b/i.test(message)||
    /\b(?:timeout|timed out|temporar|unavailable|high demand|rate limit|too many requests)\b/i.test(message);
  const maxAttempts=status===429?3:2;
  if(!transient||attempt>=maxAttempts){
    return {retry:false,delayMs:0,transient,maxAttempts};
  }
  const delayMs=status===429
    ?Math.min(15000,5000*Math.pow(2,attempt-1))
    :Math.min(8000,2000*Math.pow(2,attempt-1));
  return {retry:true,delayMs,transient,maxAttempts};
}

export function visualAssetBatchPlan(input:{
  sceneIds:string[];
  selectedReadySceneIds:string[];
  activeStockSceneIds:string[];
  batchSize:number;
}){
  const selected=new Set(input.selectedReadySceneIds);
  const active=new Set(input.activeStockSceneIds);
  const ordered=[...new Set(input.sceneIds.filter(Boolean))];
  const missing=ordered.filter(sceneId=>!selected.has(sceneId));
  const waiting=missing.filter(sceneId=>active.has(sceneId));
  const eligible=missing.filter(sceneId=>!active.has(sceneId));
  const batchSize=Math.max(1,Math.min(20,Math.floor(input.batchSize)||1));
  return {
    missing,
    waiting,
    eligible,
    targets:eligible.slice(0,batchSize)
  };
}


function automationObject(value:unknown){
  return value&&typeof value==='object'?value as Record<string,unknown>:{};
}

export function automationTimelineSnapshotIssues(input:{
  payload:unknown;
  scenePlanVersion:number;
  visualPromptSetVersion:number;
  selectedAssets:Array<{sceneId:string;assetId:string}>;
}){
  const payload=automationObject(input.payload);
  const issues:string[]=[];
  if(Number(payload.scenePlanVersion??-1)!==input.scenePlanVersion){
    issues.push('stale-scene-plan-version');
  }
  if(Number(payload.visualPromptSetVersion??-1)!==input.visualPromptSetVersion){
    issues.push('stale-visual-prompt-set-version');
  }

  const tracks=Array.isArray(payload.tracks)?payload.tracks:[];
  const visual=tracks
    .map(automationObject)
    .find(track=>String(track.type??'')==='visual');
  const clips=Array.isArray(visual?.clips)?visual!.clips:[];
  const byScene=new Map(
    clips.map(automationObject)
      .filter(clip=>clip.sceneId&&clip.assetId)
      .map(clip=>[String(clip.sceneId),String(clip.assetId)])
  );
  for(const selected of input.selectedAssets){
    if(byScene.get(selected.sceneId)!==selected.assetId){
      issues.push('scene-asset-selection-changed');
      break;
    }
  }
  if(byScene.size!==input.selectedAssets.length){
    issues.push('timeline-visual-coverage-changed');
  }
  return [...new Set(issues)];
}

export function automationVideoEditSnapshotIssues(input:{
  payload:unknown;
  timelineId:string;
  timelineVersion:number;
  transcriptId:string;
  transcriptVersion:number;
}){
  const payload=automationObject(input.payload);
  const issues:string[]=[];
  if(String(payload.timelineId??'')!==input.timelineId){
    issues.push('timeline-id-changed');
  }
  if(Number(payload.timelineVersion??-1)!==input.timelineVersion){
    issues.push('stale-timeline-version');
  }
  if(String(payload.transcriptId??'')!==input.transcriptId){
    issues.push('transcript-id-changed');
  }
  if(Number(payload.transcriptVersion??-1)!==input.transcriptVersion){
    issues.push('stale-transcript-version');
  }
  return issues;
}

export function automationRenderSnapshotIssues(input:{
  payload:unknown;
  videoEditId:string;
  videoEditVersion:number;
  timelineId:string;
  timelineVersion:number;
  transcriptId:string;
  transcriptVersion:number;
}){
  const payload=automationObject(input.payload);
  const manifest=automationObject(payload.manifest);
  const issues:string[]=[];
  if(String(manifest.videoEditId??'')!==input.videoEditId||
    Number(manifest.videoEditVersion??-1)!==input.videoEditVersion){
    issues.push('stale-video-edit-version');
  }
  if(String(manifest.timelineId??'')!==input.timelineId||
    Number(manifest.timelineVersion??-1)!==input.timelineVersion){
    issues.push('stale-timeline-version');
  }
  if(String(manifest.transcriptId??'')!==input.transcriptId||
    Number(manifest.transcriptVersion??-1)!==input.transcriptVersion){
    issues.push('stale-transcript-version');
  }
  return issues;
}


export function automationQualitySnapshotIssues(input:{
  payload:unknown;
  renderJobId:string;
  videoEditId:string;
  videoEditVersion:number;
}){
  const payload=automationObject(input.payload);
  const issues:string[]=[];
  if(String(payload.renderJobId??'')!==input.renderJobId){
    issues.push('stale-render-job');
  }
  if(String(payload.videoEditId??'')!==input.videoEditId||
    Number(payload.videoEditVersion??-1)!==input.videoEditVersion){
    issues.push('stale-video-edit-version');
  }
  return issues;
}

export function automationPackageSnapshotIssues(input:{
  payload:unknown;
  qualityReportId:string;
  qualityReportVersion:number;
  renderJobId:string;
}){
  const payload=automationObject(input.payload);
  const issues:string[]=[];
  if(String(payload.qualityReportId??'')!==input.qualityReportId||
    Number(payload.qualityReportVersion??-1)!==input.qualityReportVersion){
    issues.push('stale-quality-report');
  }
  if(String(payload.renderJobId??'')!==input.renderJobId){
    issues.push('stale-render-job');
  }
  return issues;
}

export function automationPublishSnapshotIssues(input:{
  payload:unknown;
  packageId:string;
  packageVersion:number;
}){
  const payload=automationObject(input.payload);
  const issues:string[]=[];
  if(String(payload.packageId??'')!==input.packageId||
    Number(payload.packageVersion??-1)!==input.packageVersion){
    issues.push('stale-publication-package');
  }
  return issues;
}

import type {
  EpisodeAutomationPolicy, EpisodeAutomationStatus, EpisodeAutomationStep,
  EpisodeAutomationStepState
} from './types';

export const assistedAutomationPolicy:EpisodeAutomationPolicy={
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
  return [400,409,422,429,503].includes(status);
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

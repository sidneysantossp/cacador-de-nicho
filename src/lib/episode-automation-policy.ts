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

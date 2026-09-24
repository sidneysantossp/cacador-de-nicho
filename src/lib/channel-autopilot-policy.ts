import type {
  ChannelAutopilotSettings, ManagedChannel
} from './types';

export const defaultChannelAutopilot:ChannelAutopilotSettings={
  enabled:false,
  mode:'assisted',
  startOnAcceptedNextEpisode:true,
  learningLoopEnabled:true,
  learningWindowsHours:[24,72,168],
  autoApprovePerformance:true,
  autoAnalyzeAudience:true,
  autoApproveAudience:true,
  autoPlanNextEpisode:true,
  autoAcceptNextEpisode:false,
  nextEpisodeTriggerHours:72,
  nextEpisodeMinEvidence:'high'
};

export function effectiveChannelAutopilot(
  channel:Pick<ManagedChannel,'autopilot'>
):ChannelAutopilotSettings{
  return {...defaultChannelAutopilot,...(channel.autopilot??{})};
}

export function channelAutopilotStartsAcceptedEpisode(
  channel:Pick<ManagedChannel,'autopilot'>
){
  const autopilot=effectiveChannelAutopilot(channel);
  return autopilot.enabled&&autopilot.startOnAcceptedNextEpisode;
}

export function channelAutopilotLearningEnabled(
  channel:Pick<ManagedChannel,'autopilot'>
){
  const autopilot=effectiveChannelAutopilot(channel);
  return autopilot.enabled&&autopilot.learningLoopEnabled;
}

export function channelLearningWindows(
  channel:Pick<ManagedChannel,'autopilot'>
){
  return [...new Set(
    effectiveChannelAutopilot(channel).learningWindowsHours
      .map(value=>Math.round(Number(value)))
      .filter(value=>Number.isFinite(value)&&value>=1&&value<=24*30)
  )].sort((a,b)=>a-b).slice(0,8);
}

export function channelNextEpisodeTriggerWindow(
  channel:Pick<ManagedChannel,'autopilot'>
){
  const autopilot=effectiveChannelAutopilot(channel);
  const windows=channelLearningWindows(channel);
  if(!windows.length)return null;
  const target=Math.max(1,Math.min(720,Math.round(autopilot.nextEpisodeTriggerHours)));
  return windows.find(value=>value>=target)??windows[windows.length-1];
}

export function channelShouldAutoPlanNextEpisode(
  channel:Pick<ManagedChannel,'autopilot'>,
  windowHours:number
){
  const autopilot=effectiveChannelAutopilot(channel);
  return autopilot.enabled&&
    autopilot.learningLoopEnabled&&
    autopilot.autoPlanNextEpisode&&
    channelNextEpisodeTriggerWindow(channel)===windowHours;
}

export function nextEpisodeAutoAcceptIssues(
  channel:Pick<ManagedChannel,'autopilot'>,
  plan:{
    recommendedCandidateId:string|null;
    candidates:Array<{
      id:string;
      narrativeReady:boolean;
      blockers:string[];
      evidenceStrength:'low'|'medium'|'high';
      evidenceRefs:string[];
    }>;
    context:{evidenceSnapshot:Array<{
      ref:string;
      type:'learning'|'thread'|'concept'|'arc'|'episode';
      confidence?:'low'|'medium'|'high';
    }>};
  }
){
  const autopilot=effectiveChannelAutopilot(channel);
  const issues:string[]=[];
  if(!autopilot.enabled||autopilot.mode!=='autonomous')issues.push('autonomous-mode-required');
  if(!autopilot.autoAcceptNextEpisode)issues.push('auto-accept-disabled');
  const candidate=plan.candidates.find(item=>item.id===plan.recommendedCandidateId);
  if(!candidate)issues.push('recommended-candidate-missing');
  if(candidate){
    if(!candidate.narrativeReady)issues.push('narrative-not-ready');
    if(candidate.blockers.length)issues.push('narrative-blockers');
    const rank={low:1,medium:2,high:3};
    if(rank[candidate.evidenceStrength]<rank[autopilot.nextEpisodeMinEvidence]){
      issues.push('evidence-below-threshold');
    }
    const evidence=new Map(plan.context.evidenceSnapshot.map(item=>[item.ref,item]));
    const strongLearning=candidate.evidenceRefs
      .map(ref=>evidence.get(ref))
      .some(item=>item?.type==='learning'&&(item.confidence==='medium'||item.confidence==='high'));
    if(!strongLearning)issues.push('no-strong-learning-evidence');
  }
  return [...new Set(issues)];
}

export async function startAcceptedEpisodeAutopilot<T extends {id:string;mode:'assisted'|'autonomous'}>(
  channel:Pick<ManagedChannel,'autopilot'>,
  contentProjectId:string,
  createRun:(input:{contentProjectId:string;mode:'assisted'|'autonomous'})=>Promise<T>
){
  const autopilot=effectiveChannelAutopilot(channel);
  if(!autopilot.enabled||!autopilot.startOnAcceptedNextEpisode){
    return {
      automationRunId:undefined,
      automationMode:undefined,
      automationStarted:false,
      automationError:undefined
    };
  }

  try{
    const run=await createRun({
      contentProjectId,
      mode:autopilot.mode
    });
    return {
      automationRunId:run.id,
      automationMode:run.mode,
      automationStarted:true,
      automationError:undefined
    };
  }catch(error){
    return {
      automationRunId:undefined,
      automationMode:autopilot.mode,
      automationStarted:false,
      automationError:error instanceof Error?error.message:'Falha ao iniciar Episode Automation.'
    };
  }
}

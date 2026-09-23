import 'server-only';

import type {
  AudienceIntelligenceReport, ChannelBrain, ManagedChannel
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  createDefaultChannelBrain, loadChannelBrain, saveChannelBrain
} from './channel-brain';
import { loadAudienceIntelligenceReport, listAudienceIntelligenceReports } from './audience-intelligence';
import {
  audienceLearningCandidates, audienceReportApplied, mergeAudienceReportIntoBrain
} from '@/lib/audience-learning-loop-policy';

async function managedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  return row.payload as ManagedChannel;
}

async function brainBase(report:AudienceIntelligenceReport){
  const current=await loadChannelBrain(report.channelId);
  if(current)return current;
  const channel=await managedChannel(report.channelId);
  return {...createDefaultChannelBrain(channel),version:0} as ChannelBrain;
}

async function applyOnce(report:AudienceIntelligenceReport,current:ChannelBrain){
  const candidates=audienceLearningCandidates(report);
  if(!candidates.length){
    return {
      brain:current,
      currentVersion:current.version,
      applied:0,
      learningIds:[] as string[],
      alreadyApplied:false,
      nothingToApply:true
    };
  }

  const {brain,added}=mergeAudienceReportIntoBrain(current,report);
  if(!added.length){
    return {
      brain:current,
      currentVersion:current.version,
      applied:0,
      learningIds:[] as string[],
      alreadyApplied:true,
      nothingToApply:false
    };
  }
  if(brain.learnings.length>300){
    throw new HttpError(
      'O Channel Brain atingiu o limite de 300 learnings. Consolide aprendizados antigos antes de aplicar este Audience Report.',
      409
    );
  }

  const saved=await saveChannelBrain(brain,current.version);
  return {
    brain:saved,
    currentVersion:saved.version,
    applied:added.length,
    learningIds:added.map(item=>item.id),
    alreadyApplied:false,
    nothingToApply:false
  };
}

export async function applyAudienceReportToBrain(reportId:string){
  const report=await loadAudienceIntelligenceReport(reportId);
  if(!report)throw new HttpError('Audience Report não encontrado.',404);
  if(report.status!=='approved'){
    throw new HttpError('Aprove o Audience Report antes de aplicá-lo ao Channel Brain.',409);
  }

  let current=await brainBase(report);
  if(audienceReportApplied(current,report.id)){
    return {
      brain:current,
      currentVersion:current.version,
      applied:0,
      learningIds:[] as string[],
      alreadyApplied:true,
      nothingToApply:false
    };
  }

  try{
    return await applyOnce(report,current);
  }catch(error){
    if(!(error instanceof HttpError)||error.status!==409)throw error;
    current=await brainBase(report);
    if(audienceReportApplied(current,report.id)){
      return {
        brain:current,
        currentVersion:current.version,
        applied:0,
        learningIds:[] as string[],
        alreadyApplied:true,
        nothingToApply:false
      };
    }
    return applyOnce(report,current);
  }
}

export async function audienceLearningLoopChannelState(channelId:string){
  const [brain,reports]=await Promise.all([
    loadChannelBrain(channelId),
    listAudienceIntelligenceReports(channelId)
  ]);
  const appliedReportIds=new Set<string>();
  for(const item of brain?.learnings??[]){
    const match=item.id.match(/^audience:([0-9a-f-]{36}):/i);
    if(match)appliedReportIds.add(match[1]);
  }
  const noEligibleLearningReportIds=reports
    .filter(report=>report.status==='approved'&&audienceLearningCandidates(report).length===0)
    .map(report=>report.id);

  return {
    brainVersion:brain?.version??0,
    audienceLearningCount:(brain?.learnings??[]).filter(item=>item.type==='audience').length,
    appliedReportIds:[...appliedReportIds],
    noEligibleLearningReportIds
  };
}

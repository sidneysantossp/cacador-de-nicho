import 'server-only';

import type { ChannelBrain, ManagedChannel, PerformanceReport } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  createDefaultChannelBrain, loadChannelBrain, saveChannelBrain
} from './channel-brain';
import { loadPerformanceReport } from './performance-analyst';
import {
  mergePerformanceReportIntoBrain, performanceReportApplied
} from '@/lib/learning-loop-policy';

async function managedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  return row.payload as ManagedChannel;
}

async function brainBase(report:PerformanceReport){
  const current=await loadChannelBrain(report.channelId);
  if(current)return current;
  const channel=await managedChannel(report.channelId);
  return {...createDefaultChannelBrain(channel),version:0} as ChannelBrain;
}

async function applyOnce(report:PerformanceReport,current:ChannelBrain){
  const {brain,added}=mergePerformanceReportIntoBrain(current,report);
  if(!added.length){
    return {brain,currentVersion:current.version,applied:0,learningIds:[] as string[],alreadyApplied:true};
  }
  if(brain.learnings.length>300){
    throw new HttpError('O Channel Brain atingiu o limite de 300 learnings. Revise ou consolide learnings antigos antes de aplicar este report.',409);
  }
  const saved=await saveChannelBrain(brain,current.version);
  return {
    brain:saved,
    currentVersion:saved.version,
    applied:added.length,
    learningIds:added.map(item=>item.id),
    alreadyApplied:false
  };
}

export async function applyPerformanceReportToBrain(reportId:string){
  const report=await loadPerformanceReport(reportId);
  if(!report)throw new HttpError('Performance Report não encontrado.',404);
  if(report.status!=='approved'){
    throw new HttpError('Aprove o Performance Report antes de aplicá-lo ao Learning Loop.',409);
  }

  let current=await brainBase(report);
  if(performanceReportApplied(current,report.id)){
    return {
      brain:current,
      currentVersion:current.version,
      applied:0,
      learningIds:[] as string[],
      alreadyApplied:true
    };
  }

  try{
    return await applyOnce(report,current);
  }catch(error){
    if(!(error instanceof HttpError)||error.status!==409)throw error;
    current=await brainBase(report);
    if(performanceReportApplied(current,report.id)){
      return {
        brain:current,
        currentVersion:current.version,
        applied:0,
        learningIds:[] as string[],
        alreadyApplied:true
      };
    }
    return applyOnce(report,current);
  }
}

export async function learningLoopChannelState(channelId:string){
  const brain=await loadChannelBrain(channelId);
  const appliedReportIds=new Set<string>();
  for(const item of brain?.learnings??[]){
    const match=item.id.match(/^performance:([0-9a-f-]{36}):/i);
    if(match)appliedReportIds.add(match[1]);
  }
  return {
    brainVersion:brain?.version??0,
    performanceLearningCount:(brain?.learnings??[]).filter(item=>item.type==='performance').length,
    appliedReportIds:[...appliedReportIds]
  };
}

import 'server-only';

import type { StockMediaProvider } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadVisualPromptSet } from './visual-prompt-engine';

export type VerifiedStockJobStatus='queued'|'processing'|'completed'|'failed';

export type VerifiedStockJob={
  id:string;
  channelId:string;
  episodeId:string;
  visualPromptSetId:string;
  sceneId:string;
  status:VerifiedStockJobStatus;
  query:string;
  desiredDurationSeconds:number;
  orientation:'landscape'|'portrait'|'any';
  providers:StockMediaProvider[];
  maxCandidatesPerProvider:number;
  attempts:number;
  availableAt:string;
  result:Record<string,unknown>;
  lastError?:string;
  completedAt?:string;
  createdAt:string;
  updatedAt:string;
};

type Row={
  id:string;channel_id:string;episode_id:string;visual_prompt_set_id:string;scene_id:string;
  status:VerifiedStockJobStatus;query:string;desired_duration_seconds:number|string;
  orientation:'landscape'|'portrait'|'any';providers:string[];max_candidates_per_provider:number;
  attempts:number;available_at:string;result:unknown;last_error:string|null;completed_at:string|null;
  created_at:string;updated_at:string;
};

const select='id,channel_id,episode_id,visual_prompt_set_id,scene_id,status,query,desired_duration_seconds,orientation,providers,max_candidates_per_provider,attempts,available_at,result,last_error,completed_at,created_at,updated_at';

function normalize(row:Row):VerifiedStockJob{
  return {
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    visualPromptSetId:row.visual_prompt_set_id,
    sceneId:row.scene_id,
    status:row.status,
    query:row.query,
    desiredDurationSeconds:Number(row.desired_duration_seconds),
    orientation:row.orientation,
    providers:(row.providers??[]).filter((item):item is StockMediaProvider=>
      item==='pexels'||item==='pixabay'||item==='unsplash'||item==='vecteezy'
    ),
    maxCandidatesPerProvider:Number(row.max_candidates_per_provider),
    attempts:Number(row.attempts),
    availableAt:row.available_at,
    result:(row.result&&typeof row.result==='object'?row.result:{}) as Record<string,unknown>,
    lastError:row.last_error??undefined,
    completedAt:row.completed_at??undefined,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

export async function loadVerifiedStockJob(promptSetId:string,sceneId:string){
  const row=checked(await db().from('radar_verified_stock_jobs')
    .select(select)
    .eq('visual_prompt_set_id',promptSetId)
    .eq('scene_id',sceneId)
    .maybeSingle()) as Row|null;
  return row?normalize(row):null;
}

export async function enqueueVerifiedStockJob(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
  desiredDurationSeconds:number;
  orientation:'landscape'|'portrait'|'any';
  providers?:StockMediaProvider[];
  maxCandidatesPerProvider?:number;
}){
  const set=await loadVisualPromptSet(input.promptSetId);
  if(!set)throw new HttpError('Visual Prompt Set não encontrado.',404);
  if(set.status!=='approved')throw new HttpError('Aprove os prompts visuais antes do fallback stock.',409);
  if(!set.scenePrompts.some(item=>item.sceneId===input.sceneId)){
    throw new HttpError('Cena não encontrada no Visual Prompt Set.',404);
  }

  const query=input.query.trim();
  if(query.length<1||query.length>2000)throw new HttpError('Intenção visual stock inválida.',400);
  const desiredDurationSeconds=Math.max(.25,Math.min(120,input.desiredDurationSeconds));
  const providers=(input.providers?.length?input.providers:['pexels','pixabay'])
    .filter((provider,index,list)=>list.indexOf(provider)===index);
  const maxCandidatesPerProvider=Math.max(1,Math.min(3,input.maxCandidatesPerProvider??2));

  const existing=await loadVerifiedStockJob(set.id,input.sceneId);
  const same=existing&&
    existing.query===query&&
    Math.abs(existing.desiredDurationSeconds-desiredDurationSeconds)<.01&&
    existing.orientation===input.orientation&&
    existing.maxCandidatesPerProvider===maxCandidatesPerProvider&&
    existing.providers.join('|')===providers.join('|');

  if(existing&&same)return existing;

  const now=new Date().toISOString();
  if(existing){
    const row=checked(await db().from('radar_verified_stock_jobs').update({
      channel_id:set.channelId,
      episode_id:set.episodeId,
      query,
      desired_duration_seconds:desiredDurationSeconds,
      orientation:input.orientation,
      providers,
      max_candidates_per_provider:maxCandidatesPerProvider,
      status:'queued',
      worker_token:null,
      lease_until:null,
      attempts:0,
      available_at:now,
      result:{},
      last_error:null,
      completed_at:null,
      updated_at:now
    }).eq('id',existing.id).select(select).single()) as Row;
    return normalize(row);
  }

  const row=checked(await db().from('radar_verified_stock_jobs').insert({
    id:crypto.randomUUID(),
    channel_id:set.channelId,
    episode_id:set.episodeId,
    visual_prompt_set_id:set.id,
    scene_id:input.sceneId,
    status:'queued',
    query,
    desired_duration_seconds:desiredDurationSeconds,
    orientation:input.orientation,
    providers,
    max_candidates_per_provider:maxCandidatesPerProvider,
    available_at:now,
    result:{}
  }).select(select).single()) as Row;
  return normalize(row);
}


export async function restartVerifiedStockJob(jobId:string){
  const now=new Date().toISOString();
  const row=checked(await db().from('radar_verified_stock_jobs').update({
    status:'queued',
    worker_token:null,
    lease_until:null,
    attempts:0,
    available_at:now,
    result:{},
    last_error:null,
    completed_at:null,
    updated_at:now
  }).eq('id',jobId).select(select).single()) as Row;
  return normalize(row);
}

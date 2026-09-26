import 'server-only';

import type { ContentProject, ContentProjectPayload, ContentProjectVersion } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadChannelBrain } from './channel-brain';
import { loadNarrativeBundle } from './narrative';
import { loadProductionDna } from './production-dna';
import { contentProjectReadiness, contentProjectStage } from '@/lib/content-os-policy';

function normalizeProject(row:{
  id:string;
  channel_id:string;
  episode_id:string;
  opportunity_id:string|null;
  version:number;
  status:ContentProject['status'];
  payload:unknown;
  created_at:string;
  updated_at:string;
}):ContentProject{
  const payload=row.payload as ContentProjectPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    opportunityId:row.opportunity_id??payload.opportunityId,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

export async function loadContentProjects(channelId:string):Promise<ContentProject[]>{
  const rows=checked(await db().from('radar_content_projects')
    .select('id,channel_id,episode_id,opportunity_id,version,status,payload,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeProject(row as never));
}

export async function loadContentProject(projectId:string):Promise<ContentProject|null>{
  const row=checked(await db().from('radar_content_projects')
    .select('id,channel_id,episode_id,opportunity_id,version,status,payload,created_at,updated_at')
    .eq('id',projectId)
    .maybeSingle());
  return row?normalizeProject(row as never):null;
}

export async function loadContentProjectHistory(projectId:string,limit=20):Promise<ContentProjectVersion[]>{
  const rows=checked(await db().from('radar_content_project_versions')
    .select('version,status,payload,created_at')
    .eq('project_id',projectId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as ContentProject['status'],
    payload:row.payload as ContentProjectPayload,
    createdAt:String(row.created_at)
  }));
}

export async function saveContentProject(
  payload:ContentProjectPayload,
  expectedVersion:number|null
):Promise<ContentProject>{
  const bundle=await loadNarrativeBundle(payload.channelId);
  const episode=bundle.episodes.find(item=>item.id===payload.episodeId);
  if(!episode)throw new HttpError('Episódio não encontrado para este canal.',404);

  const [brain,productionDna]=await Promise.all([
    loadChannelBrain(payload.channelId),
    loadProductionDna(payload.channelId)
  ]);
  if(payload.approval.status==='approved'){
    const readiness=contentProjectReadiness(
      payload,episode,bundle.concepts,brain,productionDna?.research??{}
    );
    if(!readiness.ready){
      throw new HttpError(`Content Project ainda não pode ser aprovado: ${readiness.blockers.join(' · ')}.`,409);
    }
  }

  const now=new Date().toISOString();
  const normalized:ContentProjectPayload={
    ...payload,
    createdAt:(await loadContentProject(payload.id))?.createdAt??payload.createdAt??now,
    updatedAt:now
  };
  const status=contentProjectStage(normalized);

  const result=await db().rpc('save_content_project',{
    p_project_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_opportunity_id:normalized.opportunityId??null,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('content project version conflict'))throw new HttpError('Content Project desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('episode already has content project'))throw new HttpError('Este episódio já possui um Content Project.',409);
    if(message.includes('episode does not belong to channel'))throw new HttpError('O episódio não pertence a este canal.',409);
    if(message.includes('managed channel not found'))throw new HttpError('Canal não encontrado.',404);
    throw new HttpError('Falha ao salvar o Content Project no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Content Project.',502);

  return {...normalized,version,status};
}

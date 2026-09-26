import 'server-only';

import type {
  ScenePlan, ScenePlanPayload, ScenePlanVersion, ScenePlanVersionSummary
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadTranscript } from './transcription-engine';
import { loadVoiceAsset } from './voice-engine';
import { loadEpisodeScript } from './episode-script';
import { loadProductionDna } from './production-dna';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import {
  createInitialScenes, normalizeScenePlan, scenePlanApprovalIssues,
  scenePlanAudioDuration
} from '@/lib/scene-timecode-policy';

function normalizeRow(row:{
  id:string;channel_id:string;episode_id:string;script_id:string;voice_asset_id:string;
  transcript_id:string;version:number;status:ScenePlan['status'];payload:unknown;
  created_at:string;updated_at:string;
}):ScenePlan{
  const payload=row.payload as ScenePlanPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scriptId:row.script_id,
    voiceAssetId:row.voice_asset_id,
    transcriptId:row.transcript_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

export async function listScenePlans(channelId:string):Promise<ScenePlan[]>{
  const rows=checked(await db().from('radar_scene_plans')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,transcript_id,version,status,payload,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeRow(row as never));
}

export async function loadScenePlan(planId:string):Promise<ScenePlan|null>{
  const row=checked(await db().from('radar_scene_plans')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,transcript_id,version,status,payload,created_at,updated_at')
    .eq('id',planId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadScenePlanByTranscript(transcriptId:string):Promise<ScenePlan|null>{
  const row=checked(await db().from('radar_scene_plans')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,transcript_id,version,status,payload,created_at,updated_at')
    .eq('transcript_id',transcriptId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadScenePlanHistory(planId:string,limit=20):Promise<ScenePlanVersionSummary[]>{
  const rows=checked(await db().from('radar_scene_plan_versions')
    .select('version,status,created_at')
    .eq('scene_plan_id',planId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as ScenePlan['status'],
    createdAt:String(row.created_at)
  }));
}

export async function loadScenePlanHistoryVersion(
  planId:string,
  version:number
):Promise<ScenePlanVersion|null>{
  const row=checked(await db().from('radar_scene_plan_versions')
    .select('version,status,payload,created_at')
    .eq('scene_plan_id',planId)
    .eq('version',version)
    .maybeSingle());
  if(!row)return null;
  return {
    version:Number(row.version),
    status:row.status as ScenePlan['status'],
    payload:row.payload as ScenePlanPayload,
    createdAt:String(row.created_at)
  };
}

async function eligibleContext(transcriptId:string){
  const transcript=await loadTranscript(transcriptId);
  if(!transcript)throw new HttpError('Transcript não encontrado.',404);
  if(transcript.status!=='approved')throw new HttpError('Aprove o transcript antes de criar o Scene Plan.',409);

  const [asset,script,dna]=await Promise.all([
    loadVoiceAsset(transcript.voiceAssetId),
    loadEpisodeScript(transcript.scriptId),
    loadProductionDna(transcript.channelId)
  ]);

  if(!asset||asset.status!=='ready')throw new HttpError('O take de voz não está pronto.',409);
  if(!asset.selected)throw new HttpError('Este transcript pertence a um take que não está mais ativo. Reconstrua a partir do take selecionado.',409);
  if(!script||script.status!=='approved')throw new HttpError('O roteiro não está aprovado.',409);

  return {transcript,asset,script,dna};
}

export async function createScenePlanFromTranscript(transcriptId:string):Promise<ScenePlan>{
  const context=await eligibleContext(transcriptId);
  const existing=await loadScenePlanByTranscript(transcriptId);
  if(existing)return existing;

  const now=new Date().toISOString();
  const audioDuration=scenePlanAudioDuration(context.transcript,context.asset.durationSeconds);
  const payload:ScenePlanPayload={
    kind:'scene-plan',
    id:crypto.randomUUID(),
    channelId:context.transcript.channelId,
    episodeId:context.transcript.episodeId,
    scriptId:context.transcript.scriptId,
    voiceAssetId:context.transcript.voiceAssetId,
    transcriptId:context.transcript.id,
    transcriptVersion:context.transcript.version,
    voiceTake:context.transcript.voiceTake,
    audioDurationSeconds:audioDuration,
    scenes:createInitialScenes(context.transcript,context.asset.durationSeconds),
    review:{notes:'',durationWarningsAccepted:false},
    createdAt:now,
    updatedAt:now
  };

  if(!payload.scenes.length)throw new HttpError('O transcript aprovado não possui segmentos temporais utilizáveis.',409);
  return saveScenePlan(payload,'draft',0);
}

export async function saveScenePlan(
  payload:ScenePlanPayload,
  status:ScenePlan['status'],
  expectedVersion:number|null
):Promise<ScenePlan>{
  const context=await eligibleContext(payload.transcriptId);
  if(
    payload.channelId!==context.transcript.channelId||
    payload.episodeId!==context.transcript.episodeId||
    payload.scriptId!==context.transcript.scriptId||
    payload.voiceAssetId!==context.transcript.voiceAssetId
  ){
    throw new HttpError('Scene Plan incompatível com o transcript selecionado.',409);
  }

  const existing=await loadScenePlan(payload.id);
  const normalized=normalizeScenePlan({
    ...payload,
    createdAt:existing?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  });

  if(status==='approved'){
    const issues=scenePlanApprovalIssues(normalized,context.transcript,context.dna);
    if(issues.length)throw new HttpError('Scene Plan ainda não pode ser aprovado: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_scene_plan',{
    p_plan_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_script_id:normalized.scriptId,
    p_voice_asset_id:normalized.voiceAssetId,
    p_transcript_id:normalized.transcriptId,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('scene plan version conflict'))throw new HttpError('Scene Plan desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('transcript already has scene plan'))throw new HttpError('Este transcript já possui um Scene Plan.',409);
    if(message.includes('transcript not approved'))throw new HttpError('O transcript precisa estar aprovado antes de salvar o Scene Plan.',409);
    throw new HttpError('Falha ao salvar o Scene Plan no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Scene Plan.',502);

  if(status==='approved'){
    const bundle=await loadNarrativeBundle(normalized.channelId);
    const episode=bundle.episodes.find(item=>item.id===normalized.episodeId);
    if(episode&&episode.status!=='producing'&&episode.status!=='published'){
      await saveChannelEpisode({...episode,status:'producing',updatedAt:new Date().toISOString()});
    }
  }

  return {...normalized,version,status};
}

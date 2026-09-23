import 'server-only';

import { createHash } from 'node:crypto';
import type {
  ScenePlan, Timeline, TimelinePayload, TimelineVersion, VoiceAsset,
  VisualPromptSet
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadScenePlan } from './scene-timecode';
import { loadVisualPromptSetByPlan } from './visual-prompt-engine';
import { loadProductionDna } from './production-dna';
import { loadVoiceAsset } from './voice-engine';
import { loadEpisodeScript } from './episode-script';
import { assetIsStale } from '@/lib/asset-factory-policy';
import { voiceAssetIsStale } from '@/lib/media-library-policy';
import {
  buildInitialTimeline, normalizeTimeline, timelineApprovalIssues,
  timelineAssetIssues, type TimelineVisualAssetRef
} from '@/lib/timeline-policy';

const BUCKET='cacadores-media';

type Row={
  id:string;channel_id:string;episode_id:string;scene_plan_id:string;script_id:string;
  voice_asset_id:string;visual_prompt_set_id:string;version:number;status:Timeline['status'];
  payload:unknown;created_at:string;updated_at:string;
};

type SceneAssetRow={
  id:string;scene_id:string;asset_kind:'image'|'video'|'graphic';status:string;selected:boolean;
  storage_path:string;mime_type:string;duration_seconds:number|string|null;payload:unknown;
  original_name:string|null;
};

function hash(value:string){
  return createHash('sha256').update(value,'utf8').digest('hex');
}

function normalizeRow(row:Row):Timeline{
  const payload=row.payload as TimelinePayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scenePlanId:row.scene_plan_id,
    scriptId:row.script_id,
    voiceAssetId:row.voice_asset_id,
    visualPromptSetId:row.visual_prompt_set_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

export async function listTimelines(channelId:string):Promise<Timeline[]>{
  const rows=checked(await db().from('radar_timelines')
    .select('id,channel_id,episode_id,scene_plan_id,script_id,voice_asset_id,visual_prompt_set_id,version,status,payload,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeRow(row as Row));
}

export async function loadTimeline(timelineId:string):Promise<Timeline|null>{
  const row=checked(await db().from('radar_timelines')
    .select('id,channel_id,episode_id,scene_plan_id,script_id,voice_asset_id,visual_prompt_set_id,version,status,payload,created_at,updated_at')
    .eq('id',timelineId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

export async function loadTimelineByPlan(scenePlanId:string):Promise<Timeline|null>{
  const row=checked(await db().from('radar_timelines')
    .select('id,channel_id,episode_id,scene_plan_id,script_id,voice_asset_id,visual_prompt_set_id,version,status,payload,created_at,updated_at')
    .eq('scene_plan_id',scenePlanId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

export async function loadTimelineHistory(timelineId:string,limit=20):Promise<TimelineVersion[]>{
  const rows=checked(await db().from('radar_timeline_versions')
    .select('version,status,payload,created_at')
    .eq('timeline_id',timelineId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as Timeline['status'],
    payload:row.payload as TimelinePayload,
    createdAt:String(row.created_at)
  }));
}

async function selectedSceneAssetRows(promptSetId:string){
  const rows=checked(await db().from('radar_scene_assets')
    .select('id,scene_id,asset_kind,status,selected,storage_path,mime_type,duration_seconds,payload,original_name')
    .eq('visual_prompt_set_id',promptSetId)
    .eq('selected',true)
    .limit(5000));
  return (rows??[]) as SceneAssetRow[];
}

async function eligibleContext(scenePlanId:string){
  const scenePlan=await loadScenePlan(scenePlanId);
  if(!scenePlan)throw new HttpError('Scene Plan não encontrado.',404);
  if(scenePlan.status!=='approved')throw new HttpError('Aprove o Scene Plan antes de criar a Timeline.',409);

  const [visualPromptSet,dna,voiceAsset,script]=await Promise.all([
    loadVisualPromptSetByPlan(scenePlan.id),
    loadProductionDna(scenePlan.channelId),
    loadVoiceAsset(scenePlan.voiceAssetId),
    loadEpisodeScript(scenePlan.scriptId)
  ]);

  if(!visualPromptSet||visualPromptSet.status!=='approved'){
    throw new HttpError('Aprove o Visual Prompt Set antes de criar a Timeline.',409);
  }
  if(!dna)throw new HttpError('Production DNA não encontrado.',409);
  if(!voiceAsset||voiceAsset.status!=='ready')throw new HttpError('O take de voz do Scene Plan não está pronto.',409);
  if(!script||script.status!=='approved')throw new HttpError('O roteiro não está aprovado.',409);

  const selectedAssets=await selectedSceneAssetRows(visualPromptSet.id);
  return {scenePlan,visualPromptSet,dna,voiceAsset,script,selectedAssets};
}

function selectedVisualRefs(rows:SceneAssetRow[]):TimelineVisualAssetRef[]{
  return rows.map(row=>({
    id:row.id,
    sceneId:row.scene_id,
    assetKind:row.asset_kind,
    durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds)
  }));
}

function currentAssetIssues(input:{
  timeline:TimelinePayload;
  scenePlan:ScenePlan;
  promptSet:VisualPromptSet;
  voiceAsset:VoiceAsset;
  scriptContent:string;
  scriptVersion:number;
  selectedAssets:SceneAssetRow[];
}){
  const promptMap=new Map(input.promptSet.scenePrompts.map(scene=>[scene.sceneId,scene]));
  const selected=new Map<string,{id:string;stale:boolean;ready:boolean}>();

  for(const row of input.selectedAssets){
    const payload=(row.payload??{}) as Record<string,unknown>;
    const current=promptMap.get(row.scene_id);
    const stale=!current||assetIsStale({
      promptSetVersion:Number(payload.promptSetVersion??0),
      prompt:String(payload.prompt??'')
    },input.promptSet.version,current);
    selected.set(row.scene_id,{id:row.id,stale,ready:row.status==='ready'});
  }

  const voiceStale=voiceAssetIsStale({
    assetScriptVersion:input.voiceAsset.scriptVersion,
    assetTextHash:input.voiceAsset.textHash,
    currentScriptVersion:input.scriptVersion,
    currentTextHash:hash(input.scriptContent)
  });

  return timelineAssetIssues({
    timeline:input.timeline,
    currentScenePlanVersion:input.scenePlan.version,
    currentPromptSetVersion:input.promptSet.version,
    voiceReady:input.voiceAsset.status==='ready',
    voiceStale,
    selectedSceneAssets:selected
  });
}

export async function createTimelineFromPlan(scenePlanId:string):Promise<Timeline>{
  const existing=await loadTimelineByPlan(scenePlanId);
  if(existing)return existing;
  const context=await eligibleContext(scenePlanId);
  const payload=buildInitialTimeline({
    scenePlan:context.scenePlan,
    productionDna:context.dna,
    visualPromptSet:context.visualPromptSet,
    visualAssets:selectedVisualRefs(context.selectedAssets.filter(asset=>asset.status==='ready')),
    voiceAsset:context.voiceAsset
  });
  return saveTimeline(payload,'draft',0);
}

export async function saveTimeline(
  payload:TimelinePayload,
  status:Timeline['status'],
  expectedVersion:number|null
):Promise<Timeline>{
  const context=await eligibleContext(payload.scenePlanId);
  if(
    payload.channelId!==context.scenePlan.channelId||
    payload.episodeId!==context.scenePlan.episodeId||
    payload.scriptId!==context.scenePlan.scriptId||
    payload.voiceAssetId!==context.scenePlan.voiceAssetId||
    payload.visualPromptSetId!==context.visualPromptSet.id
  ){
    throw new HttpError('Timeline incompatível com os recursos upstream selecionados.',409);
  }

  const existing=await loadTimeline(payload.id);
  const normalized=normalizeTimeline({
    ...payload,
    createdAt:existing?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  });

  if(status==='approved'){
    const assetIssues=currentAssetIssues({
      timeline:normalized,
      scenePlan:context.scenePlan,
      promptSet:context.visualPromptSet,
      voiceAsset:context.voiceAsset,
      scriptContent:context.script.content,
      scriptVersion:context.script.version,
      selectedAssets:context.selectedAssets
    });
    const issues=timelineApprovalIssues(normalized,context.scenePlan,assetIssues);
    if(issues.length)throw new HttpError('Timeline ainda não pode ser aprovada: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_timeline',{
    p_timeline_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_scene_plan_id:normalized.scenePlanId,
    p_script_id:normalized.scriptId,
    p_voice_asset_id:normalized.voiceAssetId,
    p_visual_prompt_set_id:normalized.visualPromptSetId,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('timeline version conflict'))throw new HttpError('Timeline desatualizada. Recarregue antes de salvar novamente.',409);
    if(message.includes('scene plan already has timeline'))throw new HttpError('Este Scene Plan já possui uma Timeline.',409);
    if(message.includes('timeline upstream not eligible'))throw new HttpError('Os recursos upstream da Timeline não estão mais elegíveis.',409);
    throw new HttpError('Falha ao salvar a Timeline no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar a Timeline.',502);
  return {...normalized,version,status};
}

export async function loadTimelineSources(timeline:Timeline){
  const visual=timeline.tracks.find(track=>track.type==='visual');
  const sceneIds=(visual?.clips??[]).map(clip=>clip.assetId).filter((id):id is string=>!!id);
  const sceneRows=sceneIds.length
    ?checked(await db().from('radar_scene_assets')
      .select('id,storage_path,mime_type,original_name')
      .in('id',sceneIds))
    :[];

  const voice=await loadVoiceAsset(timeline.voiceAssetId);
  const sources:Array<{
    assetId:string;kind:'image'|'video'|'audio';signedUrl:string|null;
    mimeType:string;title:string;
  }> = [];

  for(const row of sceneRows??[]){
    const signed=String(row.storage_path??'')
      ?await db().storage.from(BUCKET).createSignedUrl(String(row.storage_path),3600)
      :null;
    sources.push({
      assetId:String(row.id),
      kind:String(row.mime_type??'').startsWith('video/')?'video':'image',
      signedUrl:signed&&!signed.error?signed.data.signedUrl:null,
      mimeType:String(row.mime_type??''),
      title:String(row.original_name??'Scene asset')
    });
  }

  if(voice?.storagePath){
    const signed=await db().storage.from(BUCKET).createSignedUrl(voice.storagePath,3600);
    sources.push({
      assetId:voice.id,
      kind:'audio',
      signedUrl:signed.error?null:signed.data.signedUrl,
      mimeType:voice.mimeType,
      title:voice.originalName??('Voice Take '+voice.take)
    });
  }

  return sources;
}

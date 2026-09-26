import 'server-only';

import type {
  VisualPromptSet, VisualPromptSetListItem, VisualPromptSetPayload, VisualPromptSetVersion, VisualPromptSetVersionSummary
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadScenePlan } from './scene-timecode';
import { loadProductionDna } from './production-dna';
import { loadVoiceAsset } from './voice-engine';
import { draftVisualScenes } from './visual-prompt-ai';
import {
  buildInitialVisualPromptSet, compileCharacterReference, compileScenePrompt,
  normalizeVisualPromptSet, recurringCharacterIds, visualPromptIssues
} from '@/lib/visual-prompt-policy';

function normalizeRow(row:{
  id:string;channel_id:string;episode_id:string;scene_plan_id:string;
  version:number;status:VisualPromptSet['status'];payload:unknown;
  created_at:string;updated_at:string;
}):VisualPromptSet{
  const payload=row.payload as VisualPromptSetPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scenePlanId:row.scene_plan_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

function normalizeListRow(row:{
  id:string;channel_id:string;episode_id:string;scene_plan_id:string;version:number;
  status:VisualPromptSet['status'];scene_plan_version:number|string;production_dna_version:number|string;
  workflow_stage:VisualPromptSetPayload['workflowStage'];scene_prompt_count:number|string;
  character_reference_count:number|string;created_at:string;updated_at:string;
}):VisualPromptSetListItem{
  return {
    id:row.id,channelId:row.channel_id,episodeId:row.episode_id,scenePlanId:row.scene_plan_id,
    version:Number(row.version),status:row.status,scenePlanVersion:Number(row.scene_plan_version),
    productionDnaVersion:Number(row.production_dna_version),workflowStage:row.workflow_stage,
    scenePromptCount:Number(row.scene_prompt_count),characterReferenceCount:Number(row.character_reference_count),
    createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

export async function listVisualPromptSets(channelId:string):Promise<VisualPromptSetListItem[]>{
  const rows=checked(await db().from('radar_visual_prompt_set_list')
    .select('id,channel_id,episode_id,scene_plan_id,version,status,scene_plan_version,production_dna_version,workflow_stage,scene_prompt_count,character_reference_count,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeListRow(row as never));
}

export async function loadVisualPromptSet(setId:string):Promise<VisualPromptSet|null>{
  const row=checked(await db().from('radar_visual_prompt_sets')
    .select('id,channel_id,episode_id,scene_plan_id,version,status,payload,created_at,updated_at')
    .eq('id',setId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadVisualPromptSetByPlan(scenePlanId:string):Promise<VisualPromptSet|null>{
  const row=checked(await db().from('radar_visual_prompt_sets')
    .select('id,channel_id,episode_id,scene_plan_id,version,status,payload,created_at,updated_at')
    .eq('scene_plan_id',scenePlanId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadVisualPromptSetHistory(setId:string,limit=20):Promise<VisualPromptSetVersionSummary[]>{
  const rows=checked(await db().from('radar_visual_prompt_set_versions')
    .select('version,status,created_at')
    .eq('prompt_set_id',setId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as VisualPromptSet['status'],
    createdAt:String(row.created_at)
  }));
}

export async function loadVisualPromptSetHistoryVersion(
  setId:string,
  version:number
):Promise<VisualPromptSetVersion|null>{
  const row=checked(await db().from('radar_visual_prompt_set_versions')
    .select('version,status,payload,created_at')
    .eq('prompt_set_id',setId)
    .eq('version',version)
    .maybeSingle());
  if(!row)return null;
  return {
    version:Number(row.version),
    status:row.status as VisualPromptSet['status'],
    payload:row.payload as VisualPromptSetPayload,
    createdAt:String(row.created_at)
  };
}

async function eligibleContext(scenePlanId:string){
  const plan=await loadScenePlan(scenePlanId);
  if(!plan)throw new HttpError('Scene Plan não encontrado.',404);
  if(plan.status!=='approved')throw new HttpError('Aprove o Scene Plan antes de criar prompts visuais.',409);
  const [dna,voice]=await Promise.all([
    loadProductionDna(plan.channelId),
    loadVoiceAsset(plan.voiceAssetId)
  ]);
  if(!dna)throw new HttpError('Configure o Production DNA antes de criar prompts visuais.',409);
  if(!voice||voice.status!=='ready'||!voice.selected){
    throw new HttpError('O Scene Plan pertence a um take que não está mais ativo. Reconstrua a cadeia a partir da narração selecionada.',409);
  }
  return {plan,dna};
}

function workflowStage(payload:VisualPromptSetPayload){
  if(payload.characterReferences.some(ref=>!ref.assetReady))return 'references' as const;
  if(payload.scenePrompts.length===0)return 'scenes' as const;
  return 'complete' as const;
}

export async function createVisualPromptSet(scenePlanId:string):Promise<VisualPromptSet>{
  const {plan,dna}=await eligibleContext(scenePlanId);
  const existing=await loadVisualPromptSetByPlan(scenePlanId);
  if(existing)return existing;
  return saveVisualPromptSet(buildInitialVisualPromptSet(plan,dna),'draft',0,false);
}

export async function generateVisualPromptDrafts(setId:string):Promise<VisualPromptSet>{
  const current=await loadVisualPromptSet(setId);
  if(!current)throw new HttpError('Visual Prompt Set não encontrado.',404);
  const {plan,dna}=await eligibleContext(current.scenePlanId);

  const drafts=await draftVisualScenes(plan,dna);
  const recurring=recurringCharacterIds(drafts.map(item=>({sceneId:item.sceneId,characterIds:item.characterIds})));
  const existingReady=new Map(current.characterReferences.map(ref=>[ref.characterId,ref.assetReady]));

  const references=recurring.flatMap(characterId=>{
    const character=dna.characters.find(item=>item.id===characterId);
    if(!character)return [];
    const ref=compileCharacterReference(
      character,
      dna,
      drafts.filter(item=>item.characterIds.includes(characterId)).map(item=>item.sceneId)
    );
    return [{...ref,assetReady:existingReady.get(characterId)??false}];
  });

  const scenePrompts=plan.scenes.map(scene=>{
    const draft=drafts.find(item=>item.sceneId===scene.id);
    const characterIds=draft?.characterIds??scene.characterIds;
    const direction=draft?.direction??scene.promptDirection??scene.visualIntent??scene.narration;
    const compiled=compileScenePrompt(scene,dna,characterIds,direction,recurring);
    return {...compiled,direction,characterIds};
  });

  const next:VisualPromptSetPayload=normalizeVisualPromptSet({
    ...current,
    scenePlanVersion:plan.version,
    productionDnaVersion:dna.version,
    styleLock:dna.visual.basePrompt.trim(),
    characterReferences:references,
    scenePrompts,
    workflowStage:references.some(ref=>!ref.assetReady)?'references':'complete',
    updatedAt:new Date().toISOString()
  });

  return saveVisualPromptSet(next,'draft',current.version,false);
}

export async function saveVisualPromptSet(
  payload:VisualPromptSetPayload,
  status:VisualPromptSet['status'],
  expectedVersion:number|null,
  requireReadyReferences=true
):Promise<VisualPromptSet>{
  const {plan,dna}=await eligibleContext(payload.scenePlanId);
  if(payload.channelId!==plan.channelId||payload.episodeId!==plan.episodeId){
    throw new HttpError('Visual Prompt Set incompatível com o Scene Plan.',409);
  }

  const existing=await loadVisualPromptSet(payload.id);
  const normalized=normalizeVisualPromptSet({
    ...payload,
    workflowStage:workflowStage(payload),
    createdAt:existing?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  });

  if(status==='approved'){
    const issues=visualPromptIssues(normalized,plan,dna,requireReadyReferences);
    if(issues.length)throw new HttpError('Visual Prompt Set ainda não pode ser aprovado: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_visual_prompt_set',{
    p_set_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_scene_plan_id:normalized.scenePlanId,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('visual prompt version conflict'))throw new HttpError('Visual Prompt Set desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('scene plan already has visual prompt set'))throw new HttpError('Este Scene Plan já possui prompts visuais.',409);
    if(message.includes('scene plan not approved'))throw new HttpError('O Scene Plan precisa estar aprovado.',409);
    throw new HttpError('Falha ao salvar os prompts visuais no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar os prompts visuais.',502);
  return {...normalized,version,status};
}

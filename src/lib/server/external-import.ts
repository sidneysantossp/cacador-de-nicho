import 'server-only';

import type {
  ExternalImportBatch, ExternalImportItem, ExternalImportItemStatus,
  ExternalImportKind, VisualPromptSet
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadEpisodeScript } from './episode-script';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { loadVoiceAsset, uploadVoiceAsset } from './voice-engine';
import { importTranscriptFile } from './transcription-engine';
import { uploadSceneAsset } from './asset-factory';
import {
  previewExternalImportFiles, type ExternalFileDescriptor
} from '@/lib/external-import-policy';

type BatchRow={
  id:string;channel_id:string;script_id:string;visual_prompt_set_id:string|null;
  status:ExternalImportBatch['status'];payload:unknown;created_at:string;updated_at:string;
};

type ItemRow={
  id:string;batch_id:string;item_index:number;kind:ExternalImportKind;original_name:string;
  mime_type:string;bytes:number|string;matched_scene_id:string|null;matched_time_seconds:number|string|null;
  status:ExternalImportItemStatus;resource_type:ExternalImportItem['resourceType']|null;resource_id:string|null;
  error:string|null;payload:unknown;created_at:string;updated_at:string;
};

function normalizeItem(row:ItemRow):ExternalImportItem{
  return {
    id:row.id,
    batchId:row.batch_id,
    itemIndex:Number(row.item_index),
    kind:row.kind,
    originalName:row.original_name,
    mimeType:row.mime_type,
    bytes:Number(row.bytes??0),
    matchedSceneId:row.matched_scene_id??undefined,
    matchedTimeSeconds:row.matched_time_seconds===null?undefined:Number(row.matched_time_seconds),
    status:row.status,
    resourceType:row.resource_type??undefined,
    resourceId:row.resource_id??undefined,
    error:row.error??undefined,
    payload:(row.payload??{}) as ExternalImportItem['payload'],
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

async function batchRows(channelId?:string,batchId?:string){
  let query=db().from('radar_external_import_batches')
    .select('id,channel_id,script_id,visual_prompt_set_id,status,payload,created_at,updated_at')
    .order('created_at',{ascending:false})
    .limit(100);
  if(channelId)query=query.eq('channel_id',channelId);
  if(batchId)query=query.eq('id',batchId);
  return checked(await query)??[];
}

async function itemsFor(batchId:string){
  const rows=checked(await db().from('radar_external_import_items')
    .select('id,batch_id,item_index,kind,original_name,mime_type,bytes,matched_scene_id,matched_time_seconds,status,resource_type,resource_id,error,payload,created_at,updated_at')
    .eq('batch_id',batchId)
    .order('item_index',{ascending:true}));
  return (rows??[]).map(row=>normalizeItem(row as ItemRow));
}

async function normalizeBatch(row:BatchRow):Promise<ExternalImportBatch>{
  return {
    id:row.id,
    channelId:row.channel_id,
    scriptId:row.script_id,
    visualPromptSetId:row.visual_prompt_set_id??undefined,
    status:row.status,
    payload:(row.payload??{}) as ExternalImportBatch['payload'],
    items:await itemsFor(row.id),
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

export async function loadExternalImportBatch(batchId:string){
  const rows=await batchRows(undefined,batchId);
  return rows[0]?normalizeBatch(rows[0] as BatchRow):null;
}

export async function listExternalImportBatches(channelId:string){
  const rows=await batchRows(channelId);
  return Promise.all(rows.map(row=>normalizeBatch(row as BatchRow)));
}

async function refreshBatch(batchId:string){
  const result=await db().rpc('refresh_external_import_batch_status',{p_batch_id:batchId});
  if(result.error)throw new HttpError('Falha ao atualizar o progresso do batch.',502);
  const batch=await loadExternalImportBatch(batchId);
  if(!batch)throw new HttpError('Import Batch não encontrado.',404);
  return batch;
}

async function validateBatchContext(input:{
  channelId:string;
  scriptId:string;
  visualPromptSetId?:string;
  voiceAssetId?:string;
}){
  const script=await loadEpisodeScript(input.scriptId);
  if(!script||script.channelId!==input.channelId)throw new HttpError('Roteiro não encontrado para este canal.',404);
  if(script.status!=='approved')throw new HttpError('Aprove o roteiro antes de iniciar um import externo.',409);

  let promptSet:VisualPromptSet|null=null;
  if(input.visualPromptSetId){
    promptSet=await loadVisualPromptSet(input.visualPromptSetId);
    if(!promptSet||promptSet.channelId!==input.channelId||promptSet.episodeId!==script.episodeId){
      throw new HttpError('Visual Prompt Set incompatível com o roteiro selecionado.',409);
    }
    if(promptSet.status!=='approved')throw new HttpError('Aprove o Visual Prompt Set antes de importar imagens ou vídeos.',409);
  }

  if(input.voiceAssetId){
    const voice=await loadVoiceAsset(input.voiceAssetId);
    if(!voice||voice.scriptId!==script.id||voice.status!=='ready'){
      throw new HttpError('O take de voz existente não pertence a este roteiro ou ainda não está pronto.',409);
    }
  }

  return {script,promptSet};
}

export async function createExternalImportBatch(input:{
  channelId:string;
  scriptId:string;
  visualPromptSetId?:string;
  voiceAssetId?:string;
  sourceLabel?:string;
  files:ExternalFileDescriptor[];
}){
  if(!input.files.length)throw new HttpError('Selecione pelo menos um arquivo.',400);
  if(input.files.length>2000)throw new HttpError('Um batch pode conter no máximo 2.000 arquivos.',413);

  const {promptSet}=await validateBatchContext(input);
  const preview=previewExternalImportFiles(input.files,promptSet?.scenePrompts??[]);
  const id=crypto.randomUUID();
  const now=new Date().toISOString();
  const payload:ExternalImportBatch['payload']={
    voiceAssetId:input.voiceAssetId,
    sourceLabel:input.sourceLabel?.trim()||undefined
  };

  const inserted=await db().from('radar_external_import_batches').insert({
    id,
    channel_id:input.channelId,
    script_id:input.scriptId,
    visual_prompt_set_id:input.visualPromptSetId??null,
    status:'planned',
    payload
  });
  if(inserted.error)throw new HttpError('Falha ao criar o Import Batch.',502);

  const rows=preview.map(item=>({
    id:crypto.randomUUID(),
    batch_id:id,
    item_index:item.itemIndex,
    kind:item.kind,
    original_name:item.originalName,
    mime_type:item.mimeType,
    bytes:item.bytes,
    matched_scene_id:item.matchedSceneId??null,
    matched_time_seconds:item.matchedTimeSeconds??null,
    status:item.status,
    payload:item.payload
  }));

  const itemsInsert=await db().from('radar_external_import_items').insert(rows);
  if(itemsInsert.error){
    await db().from('radar_external_import_batches').delete().eq('id',id);
    throw new HttpError('Falha ao registrar os arquivos do batch.',502);
  }

  return refreshBatch(id);
}

async function loadBatchItem(batchId:string,itemId:string){
  const [batch,itemRow]=await Promise.all([
    loadExternalImportBatch(batchId),
    db().from('radar_external_import_items')
      .select('id,batch_id,item_index,kind,original_name,mime_type,bytes,matched_scene_id,matched_time_seconds,status,resource_type,resource_id,error,payload,created_at,updated_at')
      .eq('id',itemId).eq('batch_id',batchId).maybeSingle()
  ]);
  if(!batch)throw new HttpError('Import Batch não encontrado.',404);
  if(itemRow.error)throw new HttpError('Falha ao carregar item do batch.',502);
  if(!itemRow.data)throw new HttpError('Arquivo não encontrado neste batch.',404);
  return {batch,item:normalizeItem(itemRow.data as ItemRow)};
}

export async function remapExternalImportItem(batchId:string,itemId:string,sceneId:string){
  const {batch,item}=await loadBatchItem(batchId,itemId);
  if(item.kind!=='image'&&item.kind!=='video')throw new HttpError('Somente imagens e vídeos podem ser remapeados para cenas.',409);
  if(!batch.visualPromptSetId)throw new HttpError('Este batch não possui Visual Prompt Set.',409);
  const promptSet=await loadVisualPromptSet(batch.visualPromptSetId);
  if(!promptSet||promptSet.status!=='approved')throw new HttpError('Visual Prompt Set indisponível ou não aprovado.',409);
  if(!promptSet.scenePrompts.some(scene=>scene.sceneId===sceneId))throw new HttpError('Cena não encontrada neste Visual Prompt Set.',404);

  checked(await db().from('radar_external_import_items').update({
    matched_scene_id:sceneId,
    status:'pending',
    error:null,
    payload:{...item.payload,detectedBy:'manual'}
  }).eq('id',itemId).eq('batch_id',batchId));

  return refreshBatch(batchId);
}

export async function skipExternalImportItem(batchId:string,itemId:string){
  await loadBatchItem(batchId,itemId);
  checked(await db().from('radar_external_import_items').update({
    status:'skipped',error:null,updated_at:new Date().toISOString()
  }).eq('id',itemId).eq('batch_id',batchId));
  return refreshBatch(batchId);
}

async function resolveTranscriptVoiceAsset(batch:ExternalImportBatch){
  if(batch.payload.voiceAssetId){
    const asset=await loadVoiceAsset(batch.payload.voiceAssetId);
    if(asset&&asset.scriptId===batch.scriptId&&asset.status==='ready')return asset.id;
  }

  const imported=checked(await db().from('radar_external_import_items')
    .select('resource_id')
    .eq('batch_id',batch.id)
    .eq('kind','audio')
    .eq('status','ready')
    .not('resource_id','is',null)
    .order('item_index',{ascending:true})
    .limit(1)
    .maybeSingle());
  if(imported?.resource_id)return String(imported.resource_id);

  const selected=checked(await db().from('radar_voice_assets')
    .select('id')
    .eq('script_id',batch.scriptId)
    .eq('status','ready')
    .eq('selected',true)
    .limit(1)
    .maybeSingle());
  if(selected?.id)return String(selected.id);

  throw new HttpError('A transcrição precisa de um take de voz. Processe o áudio primeiro ou selecione um take existente.',409);
}

function safeError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return message.slice(0,1500);
}

export async function processExternalImportItem(batchId:string,itemId:string,file:File){
  const {batch,item}=await loadBatchItem(batchId,itemId);
  if(item.status==='ready'||item.status==='skipped')return refreshBatch(batchId);
  if(file.name!==item.originalName)throw new HttpError('O arquivo selecionado não corresponde ao item do batch.',409);
  if(item.bytes>0&&file.size!==item.bytes)throw new HttpError('O tamanho do arquivo mudou desde a criação do batch.',409);

  checked(await db().from('radar_external_import_items').update({
    status:'processing',error:null,updated_at:new Date().toISOString()
  }).eq('id',item.id));

  try{
    let resourceType:ExternalImportItem['resourceType'];
    let resourceId:string|undefined;

    if(item.kind==='image'||item.kind==='video'){
      if(!batch.visualPromptSetId||!item.matchedSceneId)throw new HttpError('Mapeie este arquivo para uma cena antes de enviar.',409);
      const asset=await uploadSceneAsset({
        promptSetId:batch.visualPromptSetId,
        sceneId:item.matchedSceneId,
        file,
        license:{type:'owned',label:'External production asset supplied by operator'}
      });
      if(!asset)throw new HttpError('O Asset Factory não devolveu o asset importado.',502);
      resourceType='scene_asset';resourceId=asset.id;
    }else if(item.kind==='audio'){
      const asset=await uploadVoiceAsset(batch.scriptId,file);
      resourceType='voice_asset';resourceId=asset.id;
      if(!batch.payload.voiceAssetId){
        checked(await db().from('radar_external_import_batches').update({
          payload:{...batch.payload,voiceAssetId:asset.id},
          updated_at:new Date().toISOString()
        }).eq('id',batch.id));
      }
    }else if(item.kind==='transcript'){
      const voiceAssetId=await resolveTranscriptVoiceAsset(await loadExternalImportBatch(batch.id) as ExternalImportBatch);
      const transcript=await importTranscriptFile(voiceAssetId,file);
      resourceType='transcript';resourceId=transcript.id;
    }else{
      checked(await db().from('radar_external_import_items').update({
        status:'skipped',error:null,updated_at:new Date().toISOString()
      }).eq('id',item.id));
      return refreshBatch(batch.id);
    }

    checked(await db().from('radar_external_import_items').update({
      status:'ready',
      resource_type:resourceType,
      resource_id:resourceId,
      error:null,
      updated_at:new Date().toISOString()
    }).eq('id',item.id));
    return refreshBatch(batch.id);
  }catch(error){
    checked(await db().from('radar_external_import_items').update({
      status:'failed',
      error:safeError(error),
      updated_at:new Date().toISOString()
    }).eq('id',item.id));
    await db().rpc('refresh_external_import_batch_status',{p_batch_id:batch.id});
    throw error;
  }
}

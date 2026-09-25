import 'server-only';

import { createHash } from 'node:crypto';
import type {
  SceneAsset, SceneAssetKind, SceneAssetLicense, VisualPromptSet, VisualScenePrompt
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { putMedia, removeMedia, signedMediaUrl } from './media-storage';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { loadScenePlan } from './scene-timecode';
import { loadProductionDna } from './production-dna';
import { matchOwnedMediaSegments } from './owned-media-intelligence';
import { libraryFirstMatchAccepted, libraryFirstSceneQuery } from '@/lib/media-library-policy';
import {
  assetIsStale, assetKindForMime, googleImageModels, googleVideoModels, sceneAssetOwnsStorage,
  type GoogleImageModel, type GoogleVideoModel, validVideoGeneration
} from '@/lib/asset-factory-policy';

const MAX_IMAGE_BYTES=25*1024*1024;
const MAX_VIDEO_BYTES=250*1024*1024;

type Row={
  id:string;channel_id:string;episode_id:string;scene_plan_id:string;visual_prompt_set_id:string;
  scene_id:string;variant:number;asset_kind:SceneAsset['assetKind'];source_type:SceneAsset['sourceType'];
  provider:string|null;status:SceneAsset['status'];selected:boolean;storage_path:string;mime_type:string;
  original_name:string|null;bytes:number|string;width:number|null;height:number|null;duration_seconds:number|string|null;
  payload:unknown;created_at:string;updated_at:string;
};

function sha(value:string){return createHash('sha256').update(value,'utf8').digest('hex');}

function normalizeRow(row:Row):SceneAsset{
  const payload=(row.payload??{}) as Partial<SceneAsset>;
  return {
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scenePlanId:row.scene_plan_id,
    visualPromptSetId:row.visual_prompt_set_id,
    sceneId:row.scene_id,
    variant:Number(row.variant),
    assetKind:row.asset_kind,
    sourceType:row.source_type,
    provider:row.provider??undefined,
    status:row.status,
    selected:!!row.selected,
    storagePath:row.storage_path,
    mimeType:row.mime_type,
    originalName:row.original_name??undefined,
    bytes:Number(row.bytes??0),
    width:row.width===null?null:Number(row.width),
    height:row.height===null?null:Number(row.height),
    durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),
    timecodeLabel:String(payload.timecodeLabel??''),
    promptSetVersion:Number(payload.promptSetVersion??0),
    prompt:String(payload.prompt??''),
    promptHash:String(payload.promptHash??''),
    modelId:payload.modelId?String(payload.modelId):undefined,
    providerOperationId:payload.providerOperationId?String(payload.providerOperationId):undefined,
    generation:(payload.generation??{}) as SceneAsset['generation'],
    license:(payload.license??{type:'unknown',label:'Unknown'}) as SceneAssetLicense,
    stock:payload.stock as SceneAsset['stock']|undefined,
    verifiedStock:payload.verifiedStock as SceneAsset['verifiedStock']|undefined,
    owned:payload.owned as SceneAsset['owned']|undefined,
    costUsd:typeof payload.costUsd==='number'?payload.costUsd:null,
    error:payload.error?String(payload.error):undefined,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

async function rawAsset(assetId:string){
  const row=checked(await db().from('radar_scene_assets')
    .select('id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload,created_at,updated_at')
    .eq('id',assetId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

async function eligibleContext(promptSetId:string,sceneId:string){
  const promptSet=await loadVisualPromptSet(promptSetId);
  if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
  if(promptSet.status!=='approved')throw new HttpError('Aprove os prompts visuais antes de gerar assets.',409);
  const [plan,dna]=await Promise.all([
    loadScenePlan(promptSet.scenePlanId),
    loadProductionDna(promptSet.channelId)
  ]);
  if(!plan||plan.status!=='approved')throw new HttpError('O Scene Plan não está aprovado.',409);
  if(!dna)throw new HttpError('Production DNA não encontrado.',409);
  const scene=plan.scenes.find(item=>item.id===sceneId);
  const visual=promptSet.scenePrompts.find(item=>item.sceneId===sceneId);
  if(!scene||!visual)throw new HttpError('Cena não encontrada no plano visual aprovado.',404);
  return {promptSet,plan,dna,scene,visual};
}

function metadataFor(
  promptSet:VisualPromptSet,
  visual:VisualScenePrompt,
  extra:Partial<SceneAsset>
){
  return {
    timecodeLabel:visual.timecodeLabel,
    promptSetVersion:promptSet.version,
    prompt:visual.prompt,
    promptHash:sha(visual.prompt),
    generation:extra.generation??{},
    license:extra.license??{type:'unknown',label:'Unknown'},
    stock:extra.stock,
    verifiedStock:extra.verifiedStock,
    owned:extra.owned,
    costUsd:extra.costUsd??null,
    modelId:extra.modelId,
    providerOperationId:extra.providerOperationId,
    error:extra.error
  };
}

async function reserve(input:{
  promptSet:VisualPromptSet;
  sceneId:string;
  kind:SceneAssetKind;
  sourceType:SceneAsset['sourceType'];
  provider:string|null;
  mimeType:string;
  originalName:string|null;
  metadata:Record<string,unknown>;
}){
  const id=crypto.randomUUID();
  const result=await db().rpc('reserve_scene_asset',{
    p_id:id,
    p_channel_id:input.promptSet.channelId,
    p_episode_id:input.promptSet.episodeId,
    p_scene_plan_id:input.promptSet.scenePlanId,
    p_visual_prompt_set_id:input.promptSet.id,
    p_scene_id:input.sceneId,
    p_asset_kind:input.kind,
    p_source_type:input.sourceType,
    p_provider:input.provider,
    p_mime_type:input.mimeType,
    p_original_name:input.originalName,
    p_payload:input.metadata
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('scene not eligible'))throw new HttpError('A cena não está elegível para o Asset Factory.',409);
    throw new HttpError('Não foi possível reservar uma variante para esta cena.',502);
  }
  return {id,variant:Number(result.data)};
}

function extension(mime:string){
  if(mime==='image/png')return 'png';
  if(mime==='image/webp')return 'webp';
  if(mime==='image/jpeg')return 'jpg';
  if(mime==='video/webm')return 'webm';
  if(mime==='video/quicktime')return 'mov';
  return 'mp4';
}

async function persistReady(
  assetId:string,
  bytes:Buffer,
  mimeType:string,
  metadata:Record<string,unknown>,
  fields:{width?:number|null;height?:number|null;durationSeconds?:number|null}={},
  selectIfNone=true
){
  const asset=await rawAsset(assetId);
  if(!asset)throw new HttpError('Asset reservado não encontrado.',404);
  const timecode=(asset.timecodeLabel||'scene').replace(/^#/,'');
  const storagePath=[
    'channels',asset.channelId,'episodes',asset.episodeId,'assets',
    asset.visualPromptSetId,asset.sceneId,
    timecode+'-v'+String(asset.variant).padStart(3,'0')+'.'+extension(mimeType)
  ].join('/');

  let persistedPath:string;
  try{
    persistedPath=await putMedia(storagePath,bytes,mimeType,{cacheControl:'3600'});
  }catch{
    await db().from('radar_scene_assets').update({
      status:'failed',selected:false,payload:{...metadata,error:'storage-upload-failed'},updated_at:new Date().toISOString()
    }).eq('id',assetId);
    throw new HttpError('Falha ao armazenar o asset no storage privado.',502);
  }

  checked(await db().from('radar_scene_assets').update({
    status:'ready',
    storage_path:persistedPath,
    mime_type:mimeType,
    bytes:bytes.length,
    width:fields.width??null,
    height:fields.height??null,
    duration_seconds:fields.durationSeconds??null,
    payload:metadata,
    updated_at:new Date().toISOString()
  }).eq('id',assetId));

  if(selectIfNone){
    await db().rpc('select_scene_asset_if_none',{
      p_visual_prompt_set_id:asset.visualPromptSetId,
      p_scene_id:asset.sceneId,
      p_asset_id:assetId
    });
  }

  return rawAsset(assetId);
}

function findImage(value:unknown):{data:string;mimeType:string}|null{
  if(!value||typeof value!=='object')return null;
  const obj=value as Record<string,unknown>;
  const direct=(obj.output_image??obj.outputImage) as Record<string,unknown>|undefined;
  if(direct&&typeof direct.data==='string'){
    return {data:direct.data,mimeType:String(direct.mime_type??direct.mimeType??'image/png')};
  }
  if(typeof obj.data==='string'){
    const mime=String(obj.mime_type??obj.mimeType??'');
    if(mime.startsWith('image/'))return {data:obj.data,mimeType:mime};
  }
  for(const child of Object.values(obj)){
    if(child&&typeof child==='object'){
      const found=findImage(child);
      if(found)return found;
    }
  }
  return null;
}

function findVideoUri(value:unknown):string|null{
  if(!value||typeof value!=='object')return null;
  const obj=value as Record<string,unknown>;
  if(typeof obj.uri==='string'&&/^https?:\/\//.test(obj.uri))return obj.uri;
  for(const child of Object.values(obj)){
    if(child&&typeof child==='object'){
      const found=findVideoUri(child);
      if(found)return found;
    }
  }
  return null;
}

export async function listSceneAssets(promptSetId:string){
  const promptSet=await loadVisualPromptSet(promptSetId);
  if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
  const rows=checked(await db().from('radar_scene_assets')
    .select('id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload,created_at,updated_at')
    .eq('visual_prompt_set_id',promptSetId)
    .order('scene_id',{ascending:true})
    .order('variant',{ascending:false})
    .limit(5000));
  const assets=(rows??[]).map(row=>normalizeRow(row as Row));
  const promptMap=new Map(promptSet.scenePrompts.map(item=>[item.sceneId,item]));
  return Promise.all(assets.map(async asset=>{
    let signedUrl:string|null=null;
    if(asset.status==='ready'&&asset.storagePath){
      signedUrl=await signedMediaUrl(asset.storagePath,3600);
    }
    const current=promptMap.get(asset.sceneId);
    return {...asset,signedUrl,stale:current?assetIsStale(asset,promptSet.version,current):true};
  }));
}

export async function attachOwnedMediaToScene(input:{
  promptSetId:string;
  sceneId:string;
  ownedAssetId:string;
  segmentId:string;
  sourceStartSeconds?:number;
  sourceEndSeconds?:number;
  matchScore?:number;
  visualCoverage?:number;
  select?:boolean;
}){
  const {promptSet,visual}=await eligibleContext(input.promptSetId,input.sceneId);
  const owned=checked(await db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds')
    .eq('id',input.ownedAssetId)
    .maybeSingle());
  if(!owned)throw new HttpError('Asset OWNED não encontrado.',404);
  if(owned.status!=='ready'||!owned.storage_path)throw new HttpError('O asset OWNED ainda não está pronto.',409);
  if(owned.asset_kind!=='video')throw new HttpError('Este fluxo exige um vídeo OWNED analisado.',409);

  const segment=checked(await db().from('radar_owned_media_segments')
    .select('id,asset_id,start_seconds,end_seconds,duration_seconds')
    .eq('id',input.segmentId)
    .eq('asset_id',input.ownedAssetId)
    .maybeSingle());
  if(!segment)throw new HttpError('Segmento visual OWNED não encontrado.',404);

  const segmentStart=Number(segment.start_seconds);
  const segmentEnd=Number(segment.end_seconds);
  const start=input.sourceStartSeconds===undefined?segmentStart:Number(input.sourceStartSeconds);
  const end=input.sourceEndSeconds===undefined?segmentEnd:Number(input.sourceEndSeconds);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<segmentStart-.05||end>segmentEnd+.05||end-start<.20){
    throw new HttpError('O trim solicitado está fora do segmento visual validado.',422);
  }

  const existingRows=checked(await db().from('radar_scene_assets')
    .select('id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload,created_at,updated_at')
    .eq('visual_prompt_set_id',promptSet.id)
    .eq('scene_id',input.sceneId)
    .eq('source_type','owned')
    .eq('status','ready')
    .order('variant',{ascending:false})
    .limit(100)) as Row[];
  const existing=existingRows.find(row=>{
    const payload=(row.payload??{}) as Record<string,unknown>;
    const ownedLink=payload.owned&&typeof payload.owned==='object'
      ?payload.owned as Record<string,unknown>
      :{};
    return String(ownedLink.assetId??'')===input.ownedAssetId&&
      String(ownedLink.segmentId??'')===input.segmentId&&
      Math.abs(Number(ownedLink.sourceStartSeconds??-1)-start)<.01&&
      Math.abs(Number(ownedLink.sourceEndSeconds??-1)-end)<.01;
  });
  if(existing){
    if(input.select!==false)await selectSceneAsset(existing.id);
    return rawAsset(existing.id);
  }

  const metadata=metadataFor(promptSet,visual,{
    generation:{},
    license:{type:'owned',label:'OWNED Media Library'},
    owned:{
      assetId:input.ownedAssetId,
      segmentId:input.segmentId,
      sourceStartSeconds:start,
      sourceEndSeconds:end,
      matchScore:input.matchScore,
      visualCoverage:input.visualCoverage
    },
    costUsd:0
  } as Partial<SceneAsset>);

  const reservation=await reserve({
    promptSet,
    sceneId:input.sceneId,
    kind:'video',
    sourceType:'owned',
    provider:'owned-library',
    mimeType:String(owned.mime_type),
    originalName:String(owned.original_name??''),
    metadata
  });

  checked(await db().from('radar_scene_assets').update({
    status:'ready',
    storage_path:String(owned.storage_path),
    mime_type:String(owned.mime_type),
    original_name:String(owned.original_name??''),
    bytes:Number(owned.bytes??0),
    width:owned.width===null?null:Number(owned.width),
    height:owned.height===null?null:Number(owned.height),
    duration_seconds:owned.duration_seconds===null?null:Number(owned.duration_seconds),
    payload:metadata,
    updated_at:new Date().toISOString()
  }).eq('id',reservation.id));

  if(input.select!==false)await selectSceneAsset(reservation.id);
  return rawAsset(reservation.id);
}

export async function resolveOwnedMediaForScene(input:{
  promptSetId:string;
  sceneId:string;
  query?:string;
  minimumScore?:number;
  force?:boolean;
  dryRun?:boolean;
}){
  const {promptSet,plan,dna,scene,visual}=await eligibleContext(input.promptSetId,input.sceneId);

  const selectedRow=checked(await db().from('radar_scene_assets')
    .select('id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload,created_at,updated_at')
    .eq('visual_prompt_set_id',promptSet.id)
    .eq('scene_id',input.sceneId)
    .eq('selected',true)
    .eq('status','ready')
    .maybeSingle()) as Row|null;
  if(selectedRow&&!input.force){
    const selected=normalizeRow(selectedRow);
    if(!assetIsStale(selected,promptSet.version,visual)){
      return {
        status:'skipped' as const,
        reason:'selected-ready' as const,
        query:'',
        sceneId:scene.id,
        timecodeLabel:visual.timecodeLabel,
        asset:selected,
        match:null
      };
    }
  }

  const query=libraryFirstSceneQuery({
    visualIntent:input.query??scene.visualIntent,
    direction:visual.direction,
    prompt:visual.prompt,
    narration:scene.narration
  });
  if(query.length<3){
    return {
      status:'gap' as const,
      reason:'missing-visual-query' as const,
      query,
      sceneId:scene.id,
      timecodeLabel:visual.timecodeLabel,
      asset:null,
      match:null
    };
  }

  const orientation=dna.format.width===dna.format.height
    ?'any'
    :dna.format.width>dna.format.height?'landscape':'portrait';
  const matches=await matchOwnedMediaSegments({
    query,
    desiredDurationSeconds:Math.max(.25,scene.durationSeconds),
    limit:5,
    orientation
  });
  const best=matches.find(match=>libraryFirstMatchAccepted(
    match,
    Math.max(.30,Math.min(.90,input.minimumScore??.45))
  ));
  if(!best){
    return {
      status:'gap' as const,
      reason:matches.length?'weak-match':'no-match' as const,
      query,
      sceneId:scene.id,
      timecodeLabel:visual.timecodeLabel,
      asset:null,
      match:null,
      candidates:matches.slice(0,3)
    };
  }

  const asset=input.dryRun?null:await attachOwnedMediaToScene({
    promptSetId:promptSet.id,
    sceneId:scene.id,
    ownedAssetId:best.assetId,
    segmentId:best.segment.id,
    sourceStartSeconds:best.sourceStartSeconds,
    sourceEndSeconds:best.sourceEndSeconds,
    matchScore:best.score,
    visualCoverage:best.visualCoverage,
    select:true
  });
  return {
    status:'matched' as const,
    reason:'owned-library' as const,
    query,
    sceneId:scene.id,
    timecodeLabel:visual.timecodeLabel,
    applied:!input.dryRun,
    asset,
    match:best
  };
}

export async function resolveOwnedMediaForPromptSet(input:{
  promptSetId:string;
  minimumScore?:number;
  force?:boolean;
  dryRun?:boolean;
}){
  const promptSet=await loadVisualPromptSet(input.promptSetId);
  if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
  if(promptSet.status!=='approved')throw new HttpError('Aprove os prompts visuais antes do Library First.',409);
  const results=[];
  for(const visual of promptSet.scenePrompts){
    results.push(await resolveOwnedMediaForScene({
      promptSetId:promptSet.id,
      sceneId:visual.sceneId,
      minimumScore:input.minimumScore,
      force:input.force,
      dryRun:input.dryRun
    }));
  }
  return {
    promptSetId:promptSet.id,
    matched:results.filter(item=>item.status==='matched').length,
    gaps:results.filter(item=>item.status==='gap').length,
    skipped:results.filter(item=>item.status==='skipped').length,
    results
  };
}

export async function uploadSceneAsset(input:{
  promptSetId:string;sceneId:string;file:File;
  license?:SceneAssetLicense;
}){
  const {promptSet,visual}=await eligibleContext(input.promptSetId,input.sceneId);
  const mime=input.file.type||'';
  const kind=assetKindForMime(mime);
  if(!kind)throw new HttpError('Formato não suportado. Use PNG/JPG/WebP ou MP4/WebM/MOV.',415);
  const max=kind==='image'?MAX_IMAGE_BYTES:MAX_VIDEO_BYTES;
  if(input.file.size<=0)throw new HttpError('O arquivo está vazio.',400);
  if(input.file.size>max)throw new HttpError(kind==='image'?'Imagem maior que 25 MB.':'Vídeo maior que 250 MB.',413);
  const metadata=metadataFor(promptSet,visual,{
    generation:{},
    license:input.license??{type:'owned',label:'External asset supplied by operator'},
    costUsd:null
  } as Partial<SceneAsset>);
  const reservation=await reserve({
    promptSet,sceneId:input.sceneId,kind,sourceType:'uploaded',provider:'external',
    mimeType:mime,originalName:input.file.name,metadata
  });
  return persistReady(reservation.id,Buffer.from(await input.file.arrayBuffer()),mime,metadata);
}

export async function persistStockSceneAsset(input:{
  promptSetId:string;
  sceneId:string;
  provider:'pexels'|'pixabay'|'unsplash'|'vecteezy';
  providerAssetId:string;
  kind:'image'|'video';
  bytes:Buffer;
  mimeType:string;
  width:number|null;
  height:number|null;
  durationSeconds:number|null;
  pageUrl:string;
  creatorName:string;
  creatorUrl?:string;
  attributionLabel:string;
  licenseLabel:string;
  licenseUrl:string;
  selectIfNone?:boolean;
}){
  const {promptSet,visual}=await eligibleContext(input.promptSetId,input.sceneId);
  const metadata=metadataFor(promptSet,visual,{
    generation:{},
    license:{type:'licensed',label:input.licenseLabel,sourceUrl:input.licenseUrl},
    stock:{
      providerAssetId:input.providerAssetId,
      pageUrl:input.pageUrl,
      creatorName:input.creatorName,
      creatorUrl:input.creatorUrl,
      attributionLabel:input.attributionLabel
    },
    costUsd:0
  } as Partial<SceneAsset>);
  const reservation=await reserve({
    promptSet,
    sceneId:input.sceneId,
    kind:input.kind,
    sourceType:'stock',
    provider:input.provider,
    mimeType:input.mimeType,
    originalName:null,
    metadata
  });
  return persistReady(
    reservation.id,input.bytes,input.mimeType,metadata,
    {width:input.width,height:input.height,durationSeconds:input.durationSeconds},
    input.selectIfNone!==false
  );
}

export async function generateGoogleImage(input:{
  promptSetId:string;sceneId:string;modelId?:GoogleImageModel;imageSize?:'1K'|'2K'|'4K';
}){
  const {promptSet,dna,visual}=await eligibleContext(input.promptSetId,input.sceneId);
  const modelId=input.modelId??'gemini-3.1-flash-image';
  if(!googleImageModels.includes(modelId))throw new HttpError('Modelo de imagem Google AI não suportado.',400);
  const imageSize=input.imageSize??'2K';
  const key=await providerSecret('googleai');

  const metadata=metadataFor(promptSet,visual,{
    modelId,
    generation:{aspectRatio:dna.format.aspectRatio,imageSize},
    license:{type:'provider-terms',label:'Google AI generated asset'},
    costUsd:null
  } as Partial<SceneAsset>);

  const reservation=await reserve({
    promptSet,sceneId:input.sceneId,kind:'image',sourceType:'generated',provider:'googleai',
    mimeType:'image/jpeg',originalName:null,metadata
  });

  let response:Response;
  try{
    response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',
      headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:modelId,
        input:visual.prompt,
        response_format:{
          type:'image',
          mime_type:'image/jpeg',
          aspect_ratio:dna.format.aspectRatio,
          image_size:imageSize
        }
      }),
      signal:AbortSignal.timeout(180000),
      cache:'no-store'
    });
  }catch{
    await db().from('radar_scene_assets').update({status:'failed',payload:{...metadata,error:'google-image-timeout'},updated_at:new Date().toISOString()}).eq('id',reservation.id);
    throw new HttpError('A Google AI excedeu o tempo para gerar a imagem.',504);
  }

  if(!response.ok){
    const error=await response.text().catch(()=>'');
    await db().from('radar_scene_assets').update({status:'failed',payload:{...metadata,error:'google-image-'+response.status},updated_at:new Date().toISOString()}).eq('id',reservation.id);
    if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial ou o acesso ao modelo.',422);
    if(response.status===429)throw new HttpError('A Google AI atingiu quota ou limite de geração.',429);
    throw new HttpError('A Google AI falhou ao gerar imagem'+(error?' ('+error.slice(0,160)+')':'')+'.',502);
  }

  const body=await response.json();
  const image=findImage(body);
  if(!image?.data)throw new HttpError('A Google AI não devolveu uma imagem utilizável.',502);
  const bytes=Buffer.from(image.data,'base64');
  if(!bytes.length)throw new HttpError('A Google AI devolveu uma imagem vazia.',502);
  return persistReady(reservation.id,bytes,image.mimeType||'image/jpeg',metadata);
}

export async function startGoogleVideo(input:{
  promptSetId:string;sceneId:string;modelId?:GoogleVideoModel;
  resolution?:'720p'|'1080p'|'4k';durationSeconds?:4|6|8;
}){
  const {promptSet,dna,visual}=await eligibleContext(input.promptSetId,input.sceneId);
  const modelId=input.modelId??'veo-3.1-fast-generate-preview';
  const resolution=input.resolution??'720p';
  const durationSeconds=input.durationSeconds??4;
  if(!validVideoGeneration(modelId,resolution,durationSeconds))throw new HttpError('Combinação Veo inválida para modelo, resolução ou duração.',400);
  const key=await providerSecret('googleai');

  const baseMetadata=metadataFor(promptSet,visual,{
    modelId,
    generation:{aspectRatio:dna.format.aspectRatio,resolution,durationSeconds},
    license:{type:'provider-terms',label:'Google AI generated asset'},
    costUsd:null
  } as Partial<SceneAsset>);

  const reservation=await reserve({
    promptSet,sceneId:input.sceneId,kind:'video',sourceType:'generated',provider:'googleai',
    mimeType:'video/mp4',originalName:null,metadata:baseMetadata
  });

  let response:Response;
  try{
    response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(modelId)+':predictLongRunning',{
      method:'POST',
      headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
      body:JSON.stringify({
        instances:[{prompt:visual.prompt}],
        parameters:{
          numberOfVideos:1,
          aspectRatio:dna.format.aspectRatio==='9:16'?'9:16':'16:9',
          durationSeconds:String(durationSeconds),
          resolution
        }
      }),
      signal:AbortSignal.timeout(30000),
      cache:'no-store'
    });
  }catch{
    await db().from('radar_scene_assets').update({status:'failed',payload:{...baseMetadata,error:'veo-start-timeout'},updated_at:new Date().toISOString()}).eq('id',reservation.id);
    throw new HttpError('A Google AI excedeu o tempo para iniciar a geração Veo.',504);
  }

  if(!response.ok){
    const error=await response.text().catch(()=>'');
    await db().from('radar_scene_assets').update({status:'failed',payload:{...baseMetadata,error:'veo-start-'+response.status},updated_at:new Date().toISOString()}).eq('id',reservation.id);
    if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial ou o acesso ao Veo.',422);
    if(response.status===429)throw new HttpError('A Google AI atingiu quota ou limite do Veo.',429);
    throw new HttpError('O Veo falhou ao iniciar a geração'+(error?' ('+error.slice(0,160)+')':'')+'.',502);
  }

  const body=await response.json() as {name?:string};
  if(!body.name)throw new HttpError('O Veo não devolveu o identificador da operação.',502);
  const metadata={...baseMetadata,providerOperationId:body.name};
  checked(await db().from('radar_scene_assets').update({
    status:'processing',payload:metadata,updated_at:new Date().toISOString()
  }).eq('id',reservation.id));
  return rawAsset(reservation.id);
}

export async function refreshGoogleVideo(assetId:string){
  const asset=await rawAsset(assetId);
  if(!asset)throw new HttpError('Asset não encontrado.',404);
  if(asset.sourceType!=='generated'||asset.provider!=='googleai'||asset.assetKind!=='video')throw new HttpError('Este asset não é um job Veo.',409);
  if(asset.status==='ready'||asset.status==='failed')return asset;
  if(!asset.providerOperationId)throw new HttpError('Job Veo sem identificador de operação.',409);

  const key=await providerSecret('googleai');
  let response:Response;
  try{
    response=await fetch('https://generativelanguage.googleapis.com/v1beta/'+asset.providerOperationId,{
      headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(20000),cache:'no-store'
    });
  }catch{throw new HttpError('Não foi possível consultar o job Veo.',502);}
  if(!response.ok)throw new HttpError('A Google AI recusou a consulta do job Veo.',502);

  const body=await response.json() as Record<string,unknown>;
  if(body.error){
    const metadata={...asset,error:'veo-operation-failed'};
    await db().from('radar_scene_assets').update({status:'failed',selected:false,payload:metadata,updated_at:new Date().toISOString()}).eq('id',asset.id);
    return rawAsset(asset.id);
  }
  if(body.done!==true)return asset;

  const uri=findVideoUri(body);
  if(!uri)throw new HttpError('O job Veo terminou sem URI de vídeo utilizável.',502);
  let video:Response;
  try{video=await fetch(uri,{headers:{'x-goog-api-key':key},redirect:'follow',signal:AbortSignal.timeout(120000)});}
  catch{throw new HttpError('O vídeo Veo ficou pronto, mas o download falhou.',502);}
  if(!video.ok)throw new HttpError('O download do vídeo Veo falhou.',502);
  const bytes=Buffer.from(await video.arrayBuffer());
  const metadata={
    timecodeLabel:asset.timecodeLabel,promptSetVersion:asset.promptSetVersion,prompt:asset.prompt,promptHash:asset.promptHash,
    generation:asset.generation,license:asset.license,costUsd:asset.costUsd,modelId:asset.modelId,providerOperationId:asset.providerOperationId
  };
  return persistReady(asset.id,bytes,video.headers.get('content-type')?.split(';')[0]||'video/mp4',metadata,{durationSeconds:asset.generation.durationSeconds??null});
}

export async function selectSceneAsset(assetId:string){
  const asset=await rawAsset(assetId);
  if(!asset)throw new HttpError('Asset não encontrado.',404);
  const result=await db().rpc('select_scene_asset',{
    p_visual_prompt_set_id:asset.visualPromptSetId,p_scene_id:asset.sceneId,p_asset_id:asset.id
  });
  if(result.error){
    if(String(result.error.message??'').includes('scene asset not ready'))throw new HttpError('Este asset ainda não está pronto.',409);
    throw new HttpError('Falha ao selecionar a variante.',502);
  }
}

export async function deleteSceneAsset(assetId:string){
  const asset=await rawAsset(assetId);
  if(!asset)throw new HttpError('Asset não encontrado.',404);
  if(asset.storagePath&&sceneAssetOwnsStorage(asset)){
    try{await removeMedia(asset.storagePath);}
    catch{throw new HttpError('Falha ao remover o arquivo do storage.',502);}
  }
  checked(await db().from('radar_scene_assets').delete().eq('id',asset.id));
  if(asset.selected){
    const fallback=checked(await db().from('radar_scene_assets')
      .select('id')
      .eq('visual_prompt_set_id',asset.visualPromptSetId)
      .eq('scene_id',asset.sceneId)
      .eq('status','ready')
      .order('variant',{ascending:false})
      .limit(1)
      .maybeSingle());
    if(fallback)await selectSceneAsset(String(fallback.id));
  }
}

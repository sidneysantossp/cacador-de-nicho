import 'server-only';

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  EpisodeScript, VoiceAlignment, VoiceAsset, VoiceAssetListItem, VoiceGenerationChunkSummary
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerAvailable, providerSecret } from './providers';
import {
  compatibleVoiceApiHeaders, compatibleVoiceApiUrl, listCompatibleVoiceApiVoices,
  parseCompatibleVoiceApiConfig
} from './compatible-voice-api';
import {
  downloadMedia, downloadMediaToFile, headMedia, putMedia, r2StoragePath, removeMedia,
  signedMediaPutUrl, signedMediaUrl
} from './media-storage';
import { loadEpisodeScript } from './episode-script';
import { loadProductionDna } from './production-dna';
import {
  maxLongFormVoiceCharacters, mergeVoiceAlignments, splitVoiceText,
  voiceAssetIsStale, voiceDownstreamStages, voiceGenerationIssues
} from '@/lib/voice-policy';

const MAX_AUDIO_BYTES=100*1024*1024;
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';
const FFPROBE=process.env.FFPROBE_PATH||'ffprobe';
const execFileAsync=promisify(execFile);

type ElevenAlignment={
  characters?:string[];
  character_start_times_seconds?:number[];
  character_end_times_seconds?:number[];
};

type ElevenTtsResponse={
  audio_base64?:string;
  alignment?:ElevenAlignment;
  normalized_alignment?:ElevenAlignment;
};

export type VoiceGenerationProvider='elevenlabs'|'voiceapi';

type VoiceProviderRuntime={
  provider:VoiceGenerationProvider;
  baseUrl:string;
  key:string;
  authMode:'xi-api-key'|'bearer';
};

async function voiceProviderRuntime(provider:VoiceGenerationProvider):Promise<VoiceProviderRuntime>{
  if(provider==='elevenlabs'){
    return {
      provider,
      baseUrl:'https://api.elevenlabs.io',
      key:await providerSecret('elevenlabs'),
      authMode:'xi-api-key'
    };
  }
  const config=parseCompatibleVoiceApiConfig(await providerSecret('voiceapi'));
  return {
    provider,
    baseUrl:config.baseUrl,
    key:config.apiKey,
    authMode:config.authMode
  };
}

function voiceProviderHeaders(runtime:VoiceProviderRuntime,json=false){
  if(runtime.provider==='voiceapi'){
    return compatibleVoiceApiHeaders({
      baseUrl:runtime.baseUrl,
      apiKey:runtime.key,
      authMode:runtime.authMode
    },json);
  }
  return {
    'xi-api-key':runtime.key,
    ...(json?{'Content-Type':'application/json'}:{})
  };
}

function voiceProviderUrl(runtime:VoiceProviderRuntime,pathValue:string){
  if(runtime.provider==='voiceapi'){
    return compatibleVoiceApiUrl({
      baseUrl:runtime.baseUrl,
      apiKey:runtime.key,
      authMode:runtime.authMode
    },pathValue);
  }
  return runtime.baseUrl+(pathValue.startsWith('/')?pathValue:'/'+pathValue);
}

function voiceProviderLabel(provider:VoiceGenerationProvider){
  return provider==='voiceapi'?'Voice API externa':'ElevenLabs';
}

export type ElevenVoiceOption={
  voiceId:string;
  name:string;
  category:string;
  description:string;
  previewUrl:string;
  labels:Record<string,string>;
};

function textHash(text:string){
  return createHash('sha256').update(text,'utf8').digest('hex');
}

function normalizeAlignment(value:ElevenAlignment|undefined):VoiceAlignment|undefined{
  if(!value?.characters?.length)return undefined;
  const starts=value.character_start_times_seconds??[];
  const ends=value.character_end_times_seconds??[];
  if(starts.length!==value.characters.length||ends.length!==value.characters.length)return undefined;
  return {
    characters:value.characters.map(String),
    characterStartTimesSeconds:starts.map(Number),
    characterEndTimesSeconds:ends.map(Number)
  };
}

function durationFromAlignment(alignment:VoiceAlignment|undefined){
  if(!alignment?.characterEndTimesSeconds.length)return null;
  const duration=Number(alignment.characterEndTimesSeconds.at(-1));
  return Number.isFinite(duration)&&duration>=0?duration:null;
}

function extensionForMime(mime:string,originalName=''){
  const lower=originalName.toLowerCase();
  if(mime==='audio/wav'||mime==='audio/x-wav'||lower.endsWith('.wav'))return 'wav';
  if(mime==='audio/mp4'||mime==='audio/m4a'||lower.endsWith('.m4a')||lower.endsWith('.mp4'))return 'm4a';
  if(mime==='audio/ogg'||lower.endsWith('.ogg'))return 'ogg';
  if(mime==='audio/webm'||lower.endsWith('.webm'))return 'webm';
  return 'mp3';
}

function normalizeMime(mime:string,originalName=''){
  const lower=originalName.toLowerCase();
  if(mime==='audio/wav'||mime==='audio/x-wav'||lower.endsWith('.wav'))return 'audio/wav';
  if(mime==='audio/mp4'||mime==='audio/m4a'||lower.endsWith('.m4a')||lower.endsWith('.mp4'))return 'audio/mp4';
  if(mime==='audio/ogg'||lower.endsWith('.ogg'))return 'audio/ogg';
  if(mime==='audio/webm'||lower.endsWith('.webm'))return 'audio/webm';
  if(mime==='audio/mpeg'||mime==='audio/mp3'||lower.endsWith('.mp3'))return 'audio/mpeg';
  throw new HttpError('Formato de áudio não suportado. Use MP3, WAV, M4A, OGG ou WebM.',415);
}

function normalizeAsset(row:{
  id:string;channel_id:string;episode_id:string;script_id:string;take:number;
  source_type:VoiceAsset['sourceType'];provider:string|null;status:VoiceAsset['status'];
  selected:boolean;storage_path:string;mime_type:string;original_name:string|null;
  bytes:number|string;payload:unknown;created_at:string;updated_at:string;
}):VoiceAsset{
  const payload=(row.payload??{}) as Partial<VoiceAsset>;
  return {
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scriptId:row.script_id,
    take:Number(row.take),
    sourceType:row.source_type,
    provider:row.provider??undefined,
    status:row.status,
    selected:!!row.selected,
    storagePath:row.storage_path,
    mimeType:row.mime_type,
    originalName:row.original_name??undefined,
    bytes:Number(row.bytes??0),
    scriptVersion:Number(payload.scriptVersion??0),
    scriptWordCount:Number(payload.scriptWordCount??0),
    textHash:String(payload.textHash??''),
    modelId:payload.modelId?String(payload.modelId):undefined,
    voiceId:payload.voiceId?String(payload.voiceId):undefined,
    voiceName:payload.voiceName?String(payload.voiceName):undefined,
    durationSeconds:typeof payload.durationSeconds==='number'?payload.durationSeconds:null,
    characterCount:Number(payload.characterCount??0),
    alignment:payload.alignment as VoiceAlignment|undefined,
    generationChunks:Array.isArray(payload.generationChunks)
      ?payload.generationChunks as VoiceGenerationChunkSummary[]
      :undefined,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}


type VoiceChunkCacheRow={
  id:string;
  cache_key:string;
  storage_path:string|null;
  bytes:number|string|null;
  duration_seconds:number|string|null;
  alignment:unknown;
  status:'processing'|'completed'|'failed';
};

function normalizeVoiceListRow(row:{
  id:string;channel_id:string;episode_id:string;script_id:string;take:number|string;
  source_type:VoiceAsset['sourceType'];provider:string|null;status:VoiceAsset['status'];selected:boolean;
  storage_path:string;mime_type:string;original_name:string|null;bytes:number|string;
  script_version:number|string;script_word_count:number|string;text_hash:string;model_id:string|null;
  voice_id:string|null;voice_name:string|null;duration_seconds:number|string|null;
  character_count:number|string;has_alignment:boolean;generation_chunk_count:number|string;
  created_at:string;updated_at:string;
}):Omit<VoiceAssetListItem,'signedUrl'|'stale'>{
  const chunkCount=Number(row.generation_chunk_count);
  return {
    id:row.id,channelId:row.channel_id,episodeId:row.episode_id,scriptId:row.script_id,
    take:Number(row.take),sourceType:row.source_type,provider:row.provider??undefined,
    status:row.status,selected:Boolean(row.selected),storagePath:row.storage_path,
    mimeType:row.mime_type,originalName:row.original_name??undefined,bytes:Number(row.bytes??0),
    scriptVersion:Number(row.script_version),scriptWordCount:Number(row.script_word_count),
    textHash:String(row.text_hash??''),modelId:row.model_id??undefined,voiceId:row.voice_id??undefined,
    voiceName:row.voice_name??undefined,durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),
    characterCount:Number(row.character_count),hasAlignment:Boolean(row.has_alignment),
    generationChunkCount:chunkCount,
    createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

function voiceChunkCacheKey(input:{
  provider:VoiceGenerationProvider;endpointKey:string;
  voiceId:string;modelId:string;text:string;previousText:string;nextText:string;
}){
  return createHash('sha256').update(JSON.stringify({
    provider:input.provider,
    endpointKey:input.endpointKey,
    outputFormat:'mp3_44100_128',
    voiceId:input.voiceId,
    modelId:input.modelId,
    text:input.text,
    previousText:input.previousText,
    nextText:input.nextText
  }),'utf8').digest('hex');
}

async function cachedVoiceChunk(cacheKey:string){
  const row=checked(await db().from('radar_voice_generation_chunks')
    .select('id,cache_key,storage_path,bytes,duration_seconds,alignment,status')
    .eq('cache_key',cacheKey)
    .eq('status','completed')
    .maybeSingle());
  return row as VoiceChunkCacheRow|null;
}

async function audioDuration(filePath:string){
  try{
    const result=await execFileAsync(FFPROBE,[
      '-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',filePath
    ],{maxBuffer:1024*1024,timeout:30000});
    const duration=Number(String(result.stdout).trim());
    return Number.isFinite(duration)&&duration>0?duration:null;
  }catch{return null;}
}

function concatEscape(value:string){
  return String(value).replace(/'/g,"'\\''");
}

async function stitchMp3Files(files:string[],outputPath:string,root:string){
  if(files.length===1){
    await writeFile(outputPath,await readFile(files[0]));
    return;
  }
  const listPath=path.join(root,'chunks.concat.txt');
  await writeFile(listPath,files.map(file=>"file '"+concatEscape(file)+"'").join('\n')+'\n','utf8');
  try{
    await execFileAsync(FFMPEG,[
      '-hide_banner','-loglevel','error','-y',
      '-f','concat','-safe','0','-i',listPath,
      '-map','0:a:0','-c:a','copy',outputPath
    ],{maxBuffer:4*1024*1024,timeout:180000});
  }catch{
    await execFileAsync(FFMPEG,[
      '-hide_banner','-loglevel','error','-y',
      '-f','concat','-safe','0','-i',listPath,
      '-map','0:a:0','-c:a','libmp3lame','-b:a','128k',outputPath
    ],{maxBuffer:4*1024*1024,timeout:300000});
  }
}

function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

async function parseVoiceProviderSuccess(
  response:Response,
  provider:VoiceGenerationProvider
){
  const contentType=(response.headers.get('content-type')??'').toLowerCase();
  if(contentType.startsWith('audio/')||contentType.includes('application/octet-stream')){
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length)throw new HttpError('A '+voiceProviderLabel(provider)+' devolveu um trecho de áudio vazio.',502);
    return {bytes,alignment:undefined as VoiceAlignment|undefined};
  }

  const raw=await response.text();
  let body:Record<string,unknown>={};
  try{body=JSON.parse(raw) as Record<string,unknown>;}
  catch{throw new HttpError('A '+voiceProviderLabel(provider)+' respondeu sem áudio utilizável.',502);}

  const nested=body.data&&typeof body.data==='object'?body.data as Record<string,unknown>:{};
  const audioBase64=String(body.audio_base64??body.audio??nested.audio_base64??nested.audio??'').trim();
  if(!audioBase64)throw new HttpError('A '+voiceProviderLabel(provider)+' não devolveu áudio para um trecho da narração.',502);
  const bytes=Buffer.from(audioBase64,'base64');
  if(!bytes.length)throw new HttpError('A '+voiceProviderLabel(provider)+' devolveu um trecho de áudio vazio.',502);
  const alignment=normalizeAlignment(
    (body.normalized_alignment??body.alignment??nested.normalized_alignment??nested.alignment) as ElevenAlignment|undefined
  );
  return {bytes,alignment};
}

async function generateVoiceProviderChunk(input:{
  runtime:VoiceProviderRuntime;
  voiceId:string;modelId:string;text:string;previousText:string;nextText:string;
}){
  const label=voiceProviderLabel(input.runtime.provider);
  const encodedVoice=encodeURIComponent(input.voiceId);
  const endpoints=[
    '/v1/text-to-speech/'+encodedVoice+'/with-timestamps?output_format=mp3_44100_128',
    '/v1/text-to-speech/'+encodedVoice+'?output_format=mp3_44100_128'
  ];
  let lastStatus=0;
  let lastBody='';

  for(let endpointIndex=0;endpointIndex<endpoints.length;endpointIndex++){
    const endpoint=endpoints[endpointIndex];
    for(let attempt=0;attempt<3;attempt++){
      let response:Response;
      try{
        response=await fetch(voiceProviderUrl(input.runtime,endpoint),{
          method:'POST',
          headers:voiceProviderHeaders(input.runtime,true),
          body:JSON.stringify({
            text:input.text,
            model_id:input.modelId,
            previous_text:endpointIndex===0?(input.previousText||undefined):undefined,
            next_text:endpointIndex===0?(input.nextText||undefined):undefined
          }),
          signal:AbortSignal.timeout(180000),
          cache:'no-store'
        });
      }catch{
        if(attempt<2){await sleep(1000*(attempt+1));continue;}
        throw new HttpError('A '+label+' excedeu o tempo de geração de um trecho da narração.',504);
      }

      if(response.ok){
        const generated=await parseVoiceProviderSuccess(response,input.runtime.provider);
        if(input.runtime.provider==='elevenlabs'&&endpointIndex===0&&!generated.alignment){
          throw new HttpError('A ElevenLabs não devolveu timestamps válidos para um trecho da narração.',502);
        }
        return generated;
      }

      lastStatus=response.status;
      lastBody=await response.text().catch(()=>'');
      if((response.status===404||response.status===405||response.status===501)&&endpointIndex===0)break;

      if(response.status===401||response.status===403){
        let status='';
        let message='';
        try{
          const parsed=JSON.parse(lastBody) as {
            detail?:{status?:unknown;message?:unknown};
            error?:{status?:unknown;message?:unknown};
          };
          const detail=parsed.detail??parsed.error;
          status=typeof detail?.status==='string'?detail.status:'';
          message=typeof detail?.message==='string'?detail.message:'';
        }catch{}
        if(status==='missing_permissions'){
          if(input.runtime.provider==='elevenlabs'){
            throw new HttpError('A chave ElevenLabs é válida, mas ainda não possui permissão Text to Speech.',422);
          }
          throw new HttpError('A credencial da '+label+' não possui permissão de Text to Speech.',422);
        }
        if(status==='invalid_api_key'&&input.runtime.provider==='elevenlabs'){
          throw new HttpError('A chave ElevenLabs usada pela plataforma foi invalidada, revogada ou expirou.',422);
        }
        const safeStatus=status.replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80);
        const safeMessage=message.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,220);
        throw new HttpError(
          'A '+label+' recusou a autenticação do Text to Speech'+
          (safeStatus?' ['+safeStatus+']':'')+
          (safeMessage?': '+safeMessage:'')+'.',
          422
        );
      }

      if(response.status===422){
        throw new HttpError('A '+label+' recusou a voz, o modelo ou um trecho do texto enviado.',422);
      }
      if(response.status!==429&&response.status<500)break;
      if(attempt<2){
        const retryAfter=Number(response.headers.get('retry-after')??0);
        await sleep(Math.max(1000*(attempt+1),Number.isFinite(retryAfter)?retryAfter*1000:0));
      }
    }
  }

  if(lastStatus===429)throw new HttpError('A '+voiceProviderLabel(input.runtime.provider)+' atingiu o limite de uso ou créditos da conta.',429);
  const safe=lastBody.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
  throw new HttpError(
    'A '+voiceProviderLabel(input.runtime.provider)+' falhou ao gerar um trecho da narração'+
    (safe?' ('+safe+')':'')+'.',
    502
  );
}

async function persistVoiceChunk(input:{
  script:EpisodeScript;cacheKey:string;index:number;count:number;text:string;
  voiceId:string;modelId:string;bytes:Buffer;durationSeconds:number;alignment?:VoiceAlignment;
}){
  const storageKey=[
    'channels',input.script.channelId,'episodes',input.script.episodeId,
    'voice-chunks',input.script.id,'v'+input.script.version,
    input.cacheKey+'-'+crypto.randomUUID()+'.mp3'
  ].join('/');
  const storagePath=await putMedia(storageKey,input.bytes,'audio/mpeg',{cacheControl:'31536000'});
  const row={
    channel_id:input.script.channelId,
    episode_id:input.script.episodeId,
    script_id:input.script.id,
    script_version:input.script.version,
    cache_key:input.cacheKey,
    chunk_index:input.index,
    chunk_count:input.count,
    text_hash:textHash(input.text),
    character_count:input.text.length,
    voice_id:input.voiceId,
    model_id:input.modelId,
    status:'completed',
    storage_path:storagePath,
    mime_type:'audio/mpeg',
    bytes:input.bytes.length,
    duration_seconds:input.durationSeconds,
    alignment:input.alignment??null,
    error:null,
    completed_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  };
  const result=await db().from('radar_voice_generation_chunks').upsert(row,{onConflict:'cache_key'});
  if(result.error){
    await removeMedia(storagePath).catch(()=>{});
    throw new HttpError('Falha ao persistir o cache de um trecho da narração.',502);
  }
  return storagePath;
}

async function approvedScript(scriptId:string){
  const script=await loadEpisodeScript(scriptId);
  if(!script)throw new HttpError('Roteiro não encontrado.',404);
  if(script.status!=='approved')throw new HttpError('Aprove o roteiro antes de criar a narração.',409);
  return script;
}

async function reserveAsset(
  script:EpisodeScript,
  sourceType:VoiceAsset['sourceType'],
  provider:string|null,
  mimeType:string,
  originalName:string|null,
  metadata:Record<string,unknown>
){
  const id=crypto.randomUUID();
  const result=await db().rpc('reserve_voice_asset',{
    p_id:id,
    p_channel_id:script.channelId,
    p_episode_id:script.episodeId,
    p_script_id:script.id,
    p_source_type:sourceType,
    p_provider:provider,
    p_mime_type:mimeType,
    p_original_name:originalName,
    p_payload:metadata
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('script not approved'))throw new HttpError('Aprove o roteiro antes de criar a narração.',409);
    throw new HttpError('Não foi possível reservar um novo take de voz.',502);
  }
  return {id,take:Number(result.data)};
}

async function persistAudio(
  script:EpisodeScript,
  reservation:{id:string;take:number},
  bytes:Buffer,
  mimeType:string,
  originalName:string|null,
  metadata:Record<string,unknown>
){
  const ext=extensionForMime(mimeType,originalName??'');
  const storagePath=[
    'channels',script.channelId,
    'episodes',script.episodeId,
    'voice',script.id,
    'take-'+String(reservation.take).padStart(3,'0')+'-'+reservation.id+'.'+ext
  ].join('/');

  let persistedPath:string;
  try{
    persistedPath=await putMedia(storagePath,bytes,mimeType,{cacheControl:'3600'});
  }catch{
    await db().from('radar_voice_assets').update({
      status:'failed',
      selected:false,
      payload:{...metadata,error:'storage-upload-failed'},
      updated_at:new Date().toISOString()
    }).eq('id',reservation.id);
    throw new HttpError('Falha ao armazenar o áudio no storage privado.',502);
  }

  const row=checked(await db().from('radar_voice_assets').update({
    status:'ready',
    storage_path:persistedPath,
    mime_type:mimeType,
    bytes:bytes.length,
    payload:metadata,
    updated_at:new Date().toISOString()
  }).eq('id',reservation.id)
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .single());

  await db().rpc('select_voice_asset_if_none',{
    p_script_id:script.id,
    p_asset_id:reservation.id
  });

  const finalRow=checked(await db().from('radar_voice_assets')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .eq('id',reservation.id)
    .single());

  return normalizeAsset(finalRow as never);
}

export async function loadVoiceAsset(assetId:string){
  const row=checked(await db().from('radar_voice_assets')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .eq('id',assetId)
    .maybeSingle());
  return row?normalizeAsset(row as never):null;
}

export async function downloadVoiceAsset(assetId:string){
  const asset=await loadVoiceAsset(assetId);
  if(!asset)throw new HttpError('Take de voz não encontrado.',404);
  if(asset.status!=='ready'||!asset.storagePath)throw new HttpError('O take de voz ainda não está pronto.',409);
  try{
    return {asset,bytes:await downloadMedia(asset.storagePath)};
  }catch{
    throw new HttpError('Falha ao ler o áudio do storage privado.',502);
  }
}

export async function listVoiceAssets(scriptId:string):Promise<VoiceAssetListItem[]>{
  const script=await loadEpisodeScript(scriptId);
  if(!script)throw new HttpError('Roteiro não encontrado.',404);
  const rows=checked(await db().from('radar_voice_asset_list')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,script_version,script_word_count,text_hash,model_id,voice_id,voice_name,duration_seconds,character_count,has_alignment,generation_chunk_count,created_at,updated_at')
    .eq('script_id',scriptId)
    .order('take',{ascending:false})
    .limit(100));
  const assets=(rows??[]).map(row=>normalizeVoiceListRow(row as never));
  return Promise.all(assets.map(async asset=>{
    let signedUrl:string|null=null;
    if(asset.status==='ready'&&asset.storagePath){
      signedUrl=await signedMediaUrl(asset.storagePath,3600);
    }
    return {
      ...asset,
      signedUrl,
      stale:voiceAssetIsStale(asset,script,textHash(script.content))
    };
  }));
}

export async function prepareVoiceAssetUpload(input:{
  scriptId:string;fileName:string;mimeType:string;bytes:number;
}){
  const script=await approvedScript(input.scriptId);
  if(!Number.isSafeInteger(input.bytes)||input.bytes<=0)throw new HttpError('O arquivo de áudio está vazio.',400);
  if(input.bytes>MAX_AUDIO_BYTES)throw new HttpError('O áudio excede o limite de 100 MB.',413);
  const mimeType=normalizeMime(input.mimeType,input.fileName);
  const metadata={
    scriptVersion:script.version,
    scriptWordCount:script.wordCount,
    textHash:textHash(script.content),
    durationSeconds:null,
    characterCount:script.content.length,
    expectedBytes:input.bytes,
    uploadTransport:'direct-r2'
  };
  const reservation=await reserveAsset(script,'uploaded','external',mimeType,input.fileName,metadata);
  const ext=extensionForMime(mimeType,input.fileName);
  const storageKey=[
    'channels',script.channelId,'episodes',script.episodeId,'voice',script.id,
    'take-'+String(reservation.take).padStart(3,'0')+'-'+reservation.id+'.'+ext
  ].join('/');
  const storagePath=r2StoragePath(storageKey);
  const uploadUrl=await signedMediaPutUrl(storagePath,mimeType,600);
  if(!uploadUrl){
    await db().from('radar_voice_assets').update({
      status:'failed',selected:false,payload:{...metadata,error:'direct-upload-unavailable'},
      updated_at:new Date().toISOString()
    }).eq('id',reservation.id);
    throw new HttpError('Não foi possível preparar o upload direto do áudio para o R2.',503);
  }
  checked(await db().from('radar_voice_assets').update({
    storage_path:storagePath,mime_type:mimeType,bytes:input.bytes,payload:metadata,
    updated_at:new Date().toISOString()
  }).eq('id',reservation.id));
  return {assetId:reservation.id,take:reservation.take,storagePath,mimeType,uploadUrl};
}

export async function finalizeVoiceAssetUpload(input:{scriptId:string;assetId:string}){
  const script=await approvedScript(input.scriptId);
  const row=checked(await db().from('radar_voice_assets')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .eq('id',input.assetId).eq('script_id',script.id).maybeSingle());
  if(!row)throw new HttpError('Upload de voz não encontrado.',404);
  if(String(row.status)==='ready')return normalizeAsset(row as never);
  const storagePath=String(row.storage_path??'');
  if(!storagePath.startsWith('r2:'))throw new HttpError('O upload de voz não possui destino R2 válido.',409);
  const expected=Number(row.bytes??0);
  let remote:{bytes:number;contentType:string;etag:string};
  try{remote=await headMedia(storagePath);}
  catch{throw new HttpError('O áudio ainda não apareceu no R2. Tente finalizar novamente.',409);}
  if(remote.bytes<=0||remote.bytes!==expected){
    throw new HttpError('O tamanho recebido no R2 não corresponde ao master preparado.',422);
  }
  const root=await mkdtemp(path.join(os.tmpdir(),'voice-upload-'));
  let durationSeconds:null|number=null;
  try{
    const local=path.join(root,'master.'+extensionForMime(String(row.mime_type),String(row.original_name??'')));
    await downloadMediaToFile(storagePath,local);
    durationSeconds=await audioDuration(local);
  }finally{
    await rm(root,{recursive:true,force:true}).catch(()=>{});
  }
  if(!durationSeconds)throw new HttpError('Não foi possível determinar a duração do master enviado.',422);
  const payload={
    ...((row.payload??{}) as Record<string,unknown>),
    durationSeconds:Number(durationSeconds.toFixed(6)),
    finalizedAt:new Date().toISOString()
  };
  const updated=checked(await db().from('radar_voice_assets').update({
    status:'ready',bytes:remote.bytes,mime_type:remote.contentType||row.mime_type,payload,
    updated_at:new Date().toISOString()
  }).eq('id',input.assetId)
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .single());
  await db().rpc('select_voice_asset_if_none',{p_script_id:script.id,p_asset_id:input.assetId});
  const finalRow=checked(await db().from('radar_voice_assets')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .eq('id',input.assetId).single());
  return normalizeAsset(finalRow as never);
}

export async function uploadVoiceAsset(scriptId:string,file:File){
  const script=await approvedScript(scriptId);
  if(file.size<=0)throw new HttpError('O arquivo de áudio está vazio.',400);
  if(file.size>MAX_AUDIO_BYTES)throw new HttpError('O áudio excede o limite de 100 MB.',413);
  const mimeType=normalizeMime(file.type,file.name);
  const bytes=Buffer.from(await file.arrayBuffer());
  const metadata={
    scriptVersion:script.version,
    scriptWordCount:script.wordCount,
    textHash:textHash(script.content),
    durationSeconds:null,
    characterCount:script.content.length
  };
  const reservation=await reserveAsset(script,'uploaded','external',mimeType,file.name,metadata);
  return persistAudio(script,reservation,bytes,mimeType,file.name,metadata);
}

export type ElevenSharedVoiceCandidate=ElevenVoiceOption&{
  publicOwnerId:string;
  originalVoiceId:string;
};

export async function discoverElevenLabsSharedVoice(voiceId:string):Promise<ElevenSharedVoiceCandidate|null>{
  const id=voiceId.trim();
  if(!id)throw new HttpError('Voice ID da ElevenLabs inválido.',400);
  const key=await providerSecret('elevenlabs');
  const params=new URLSearchParams({
    page_size:'100',
    search:id
  });
  let response:Response;
  try{
    response=await fetch('https://api.elevenlabs.io/v1/shared-voices?'+params.toString(),{
      headers:{'xi-api-key':key},
      signal:AbortSignal.timeout(20000),
      cache:'no-store'
    });
  }catch{
    throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);
  }
  if(!response.ok){
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===403)throw new HttpError('O plano ElevenLabs atual não permite consultar a Voice Library via API.',403);
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso da conta.',429);
    throw new HttpError('A ElevenLabs não conseguiu pesquisar a Voice Library.',502);
  }
  const body=await response.json() as {voices?:Array<Record<string,unknown>>};
  const item=(body.voices??[]).find(row=>String(row.voice_id??'')===id)??body.voices?.[0];
  if(!item)return null;
  const publicOwnerId=String(item.public_owner_id??'').trim();
  const originalVoiceId=String(item.voice_id??id).trim();
  if(!publicOwnerId||!originalVoiceId)return null;
  return {
    voiceId:originalVoiceId,
    name:String(item.name??'Unnamed voice'),
    category:String(item.category??''),
    description:String(item.description??''),
    previewUrl:String(item.preview_url??''),
    labels:item.labels&&typeof item.labels==='object'?item.labels as Record<string,string>:{},
    publicOwnerId,
    originalVoiceId
  };
}

export async function addElevenLabsSharedVoice(input:{
  originalVoiceId:string;
  publicOwnerId:string;
  name:string;
}){
  const key=await providerSecret('elevenlabs');
  let response:Response;
  try{
    response=await fetch(
      'https://api.elevenlabs.io/v1/voices/add/'+encodeURIComponent(input.publicOwnerId)+'/'+encodeURIComponent(input.originalVoiceId),
      {
        method:'POST',
        headers:{'xi-api-key':key,'Content-Type':'application/json'},
        body:JSON.stringify({new_name:input.name.trim()||'Lax',bookmarked:true}),
        signal:AbortSignal.timeout(20000),
        cache:'no-store'
      }
    );
  }catch{
    throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);
  }
  const raw=await response.text().catch(()=>'');
  if(!response.ok){
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===403)throw new HttpError('A credencial atual não pode adicionar esta voz compartilhada.',403);
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso da conta.',429);
    const safe=raw.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
    throw new HttpError('A ElevenLabs não conseguiu adicionar a voz compartilhada'+(safe?': '+safe:'')+'.',422);
  }
  let parsed:{voice_id?:unknown}={};
  try{parsed=JSON.parse(raw) as {voice_id?:unknown};}catch{}
  const voiceId=String(parsed.voice_id??'').trim();
  if(!voiceId)throw new HttpError('A ElevenLabs adicionou a voz sem retornar um novo Voice ID.',502);
  return getElevenLabsVoice(voiceId);
}

export async function getElevenLabsVoice(voiceId:string):Promise<ElevenVoiceOption>{
  const id=voiceId.trim();
  if(!id)throw new HttpError('Voice ID da ElevenLabs inválido.',400);
  const key=await providerSecret('elevenlabs');
  let response:Response;
  try{
    response=await fetch(
      'https://api.elevenlabs.io/v1/voices/'+encodeURIComponent(id),
      {
        headers:{'xi-api-key':key},
        signal:AbortSignal.timeout(20000),
        cache:'no-store'
      }
    );
  }catch{
    throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);
  }
  if(!response.ok){
    const raw=await response.text().catch(()=>'');
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===403)throw new HttpError('A nova credencial não tem acesso a esta voz ElevenLabs.',403);
    if(response.status===404||response.status===422){
      throw new HttpError('Esta voz ElevenLabs não está disponível para a credencial atual.',404);
    }
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso da conta.',429);
    const safe=raw.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
    throw new HttpError('A ElevenLabs não conseguiu consultar esta voz'+(safe?': '+safe:'')+'.',502);
  }
  const item=await response.json() as Record<string,unknown>;
  return {
    voiceId:String(item.voice_id??id),
    name:String(item.name??'Unnamed voice'),
    category:String(item.category??''),
    description:String(item.description??''),
    previewUrl:String(item.preview_url??''),
    labels:item.labels&&typeof item.labels==='object'?item.labels as Record<string,string>:{}
  };
}

export async function listElevenLabsVoices(search=''):Promise<ElevenVoiceOption[]>{
  const key=await providerSecret('elevenlabs');
  const params=new URLSearchParams({page_size:'100',include_total_count:'false'});
  if(search.trim())params.set('search',search.trim());
  let response:Response;
  try{
    response=await fetch('https://api.elevenlabs.io/v2/voices?'+params.toString(),{
      headers:{'xi-api-key':key},
      signal:AbortSignal.timeout(20000),
      cache:'no-store'
    });
  }catch{
    throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);
  }
  if(!response.ok){
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso da conta.',429);
    throw new HttpError('A ElevenLabs não conseguiu listar as vozes desta conta.',502);
  }
  const body=await response.json() as {voices?:Array<Record<string,unknown>>};
  return (body.voices??[]).slice(0,100).map(item=>({
    voiceId:String(item.voice_id??''),
    name:String(item.name??'Unnamed voice'),
    category:String(item.category??''),
    description:String(item.description??''),
    previewUrl:String(item.preview_url??''),
    labels:item.labels&&typeof item.labels==='object'?item.labels as Record<string,string>:{}
  })).filter(item=>!!item.voiceId);
}

export async function listVoiceProviderVoices(
  provider:VoiceGenerationProvider,
  search=''
):Promise<ElevenVoiceOption[]>{
  if(provider==='elevenlabs')return listElevenLabsVoices(search);
  const config=parseCompatibleVoiceApiConfig(await providerSecret('voiceapi'));
  return listCompatibleVoiceApiVoices(config,search);
}

export async function getVoiceProviderVoice(
  provider:VoiceGenerationProvider,
  voiceId:string
):Promise<ElevenVoiceOption>{
  if(provider==='elevenlabs')return getElevenLabsVoice(voiceId);
  const id=voiceId.trim();
  if(!id)throw new HttpError('Voice ID da Voice API externa inválido.',400);
  const voices=await listVoiceProviderVoices('voiceapi',id);
  const exact=voices.find(item=>item.voiceId===id)??voices[0];
  if(!exact)throw new HttpError('Esta voz não está disponível na Voice API externa.',404);
  return exact;
}

export async function generateVoiceWithProvider(input:{
  scriptId:string;
  provider?:VoiceGenerationProvider;
  voiceId?:string;
  voiceName?:string;
  modelId?:string;
}){
  const provider=input.provider??'elevenlabs';
  const script=await approvedScript(input.scriptId);
  const dna=await loadProductionDna(script.channelId);
  const voiceId=(input.voiceId??dna?.voice.voiceId??'').trim();
  if(!voiceId)throw new HttpError('Selecione uma voz antes de gerar a narração.',400);

  const modelId=(input.modelId??'eleven_flash_v2_5').trim();
  const issues=voiceGenerationIssues(script.content.length,modelId);
  if(issues.includes('unsupported-model'))throw new HttpError('Modelo de voz não suportado pelo Voice Engine.',400);
  if(issues.includes('empty-script'))throw new HttpError('O roteiro aprovado está vazio.',409);
  if(issues.includes('text-too-long')){
    throw new HttpError(
      'O roteiro tem '+script.content.length+' caracteres e excede o limite long-form de '+
      maxLongFormVoiceCharacters+' caracteres por take.',
      413
    );
  }

  const chunks=splitVoiceText(script.content,modelId);
  if(!chunks.length)throw new HttpError('Não foi possível dividir o roteiro para geração de voz.',409);

  const runtime=await voiceProviderRuntime(provider);
  const root=await mkdtemp(path.join(os.tmpdir(),'cacadores-voice-'));
  const files:string[]=[];
  const alignmentParts:Array<{alignment:VoiceAlignment;offsetSeconds:number}>=[];
  const generationChunks:VoiceGenerationChunkSummary[]=[];
  let offsetSeconds=0;

  try{
    for(const chunk of chunks){
      const cacheKey=voiceChunkCacheKey({
        provider,
        endpointKey:runtime.baseUrl,
        voiceId,
        modelId,
        text:chunk.text,
        previousText:chunk.previousText,
        nextText:chunk.nextText
      });
      const filePath=path.join(root,'chunk-'+String(chunk.index).padStart(3,'0')+'.mp3');
      let durationSeconds:number|null=null;
      let alignment:VoiceAlignment|undefined;
      let cacheHit=false;

      const cached=await cachedVoiceChunk(cacheKey);
      if(cached?.storage_path){
        try{
          await downloadMediaToFile(cached.storage_path,filePath);
          const cachedAlignment=cached.alignment&&typeof cached.alignment==='object'
            ?cached.alignment as VoiceAlignment
            :undefined;
          const probedDuration=await audioDuration(filePath);
          if(!cachedAlignment||probedDuration===null)throw new Error('invalid-voice-chunk-cache');
          alignment=cachedAlignment;
          durationSeconds=probedDuration;
          cacheHit=true;
        }catch{
          cacheHit=false;
        }
      }

      if(!cacheHit){
        const generated=await generateVoiceProviderChunk({
          runtime,
          voiceId,
          modelId,
          text:chunk.text,
          previousText:chunk.previousText,
          nextText:chunk.nextText
        });
        if(generated.bytes.length>MAX_AUDIO_BYTES){
          throw new HttpError('Um trecho gerado excedeu o limite de áudio do Voice Engine.',413);
        }
        await writeFile(filePath,generated.bytes);
        alignment=generated.alignment;
        durationSeconds=await audioDuration(filePath)??durationFromAlignment(alignment);
        if(durationSeconds===null||durationSeconds<=0){
          throw new HttpError('Não foi possível determinar a duração de um trecho gerado.',502);
        }
        await persistVoiceChunk({
          script,
          cacheKey,
          index:chunk.index,
          count:chunks.length,
          text:chunk.text,
          voiceId,
          modelId,
          bytes:generated.bytes,
          durationSeconds,
          alignment
        });
      }

      if(durationSeconds===null||durationSeconds<=0){
        throw new HttpError('O cache de voz contém um trecho sem duração válida.',502);
      }
      files.push(filePath);
      if(alignment)alignmentParts.push({alignment,offsetSeconds});
      generationChunks.push({
        index:chunk.index,
        characterCount:chunk.characterCount,
        durationSeconds:Number(durationSeconds.toFixed(6)),
        cacheHit
      });
      offsetSeconds+=durationSeconds;
    }

    const outputPath=path.join(root,'stitched.mp3');
    await stitchMp3Files(files,outputPath,root);
    const bytes=await readFile(outputPath);
    if(!bytes.length)throw new HttpError('O stitching da narração gerou um áudio vazio.',502);
    if(bytes.length>MAX_AUDIO_BYTES)throw new HttpError('O áudio final excede o limite de 100 MB.',413);

    const finalDuration=await audioDuration(outputPath)??offsetSeconds;
    const alignment=alignmentParts.length===chunks.length
      ?mergeVoiceAlignments(alignmentParts)
      :undefined;
    const metadata={
      scriptVersion:script.version,
      scriptWordCount:script.wordCount,
      textHash:textHash(script.content),
      modelId,
      voiceId,
      voiceName:(input.voiceName??dna?.voice.voiceName??'').trim()||undefined,
      durationSeconds:Number(finalDuration.toFixed(6)),
      characterCount:script.content.length,
      generationChunks,
      alignment
    };
    const reservation=await reserveAsset(script,'generated',provider,'audio/mpeg',null,metadata);
    return persistAudio(script,reservation,bytes,'audio/mpeg',null,metadata);
  }finally{
    await rm(root,{recursive:true,force:true}).catch(()=>{});
  }
}

export async function generateElevenLabsVoice(input:{
  scriptId:string;
  voiceId?:string;
  voiceName?:string;
  modelId?:string;
}){
  return generateVoiceWithProvider({...input,provider:'elevenlabs'});
}

export async function generatePreferredVoice(input:{scriptId:string}){
  const script=await approvedScript(input.scriptId);
  const dna=await loadProductionDna(script.channelId);
  const preferences=(dna?.voice.providerPreference??[]).map(item=>String(item).trim().toLowerCase());
  let provider:VoiceGenerationProvider='elevenlabs';
  if(preferences.some(item=>item==='voiceapi'||item.includes('voice api')||item.includes('external'))){
    provider='voiceapi';
  }else if(preferences.some(item=>item.includes('elevenlabs'))){
    provider='elevenlabs';
  }else if(await providerAvailable('voiceapi')){
    provider='voiceapi';
  }
  return generateVoiceWithProvider({scriptId:input.scriptId,provider});
}

export async function selectVoiceAsset(scriptId:string,assetId:string){
  const [current,target]=await Promise.all([
    db().from('radar_voice_assets')
      .select('id')
      .eq('script_id',scriptId)
      .eq('selected',true)
      .maybeSingle(),
    db().from('radar_voice_assets')
      .select('id,status,episode_id')
      .eq('script_id',scriptId)
      .eq('id',assetId)
      .maybeSingle()
  ]);
  if(current.error)throw new HttpError('Falha ao verificar o take ativo.',502);
  if(target.error)throw new HttpError('Falha ao verificar o take selecionado.',502);
  if(!target.data)throw new HttpError('Take de voz não encontrado para este roteiro.',404);
  if(target.data.status!=='ready')throw new HttpError('Este take ainda não está pronto para uso.',409);

  const previousAssetId=current.data?.id?String(current.data.id):null;
  const changed=previousAssetId!==assetId;
  const result=await db().rpc('select_voice_asset',{p_script_id:scriptId,p_asset_id:assetId});
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('voice asset not ready'))throw new HttpError('Este take ainda não está pronto para uso.',409);
    throw new HttpError('Falha ao selecionar o take de voz.',502);
  }
  if(changed){
    const reopened=await db().from('radar_episode_automation_runs').update({
      status:'active',
      worker_token:null,
      lease_until:null,
      hold_step:null,
      hold_reason:null,
      hold_created_at:null,
      last_error:null,
      updated_at:new Date().toISOString()
    }).eq('episode_id',String(target.data.episode_id)).neq('status','cancelled');
    if(reopened.error)throw new HttpError('Take ativado, mas não foi possível reabrir a automação do episódio.',502);
  }

  return {
    changed,
    previousAssetId,
    selectedAssetId:assetId,
    invalidatedStages:changed&&previousAssetId?[...voiceDownstreamStages]:[]
  };
}

export async function deleteVoiceAsset(scriptId:string,assetId:string){
  const row=checked(await db().from('radar_voice_assets')
    .select('id,script_id,selected,storage_path')
    .eq('id',assetId)
    .eq('script_id',scriptId)
    .maybeSingle());
  if(!row)throw new HttpError('Take de voz não encontrado.',404);

  if(row.storage_path){
    try{await removeMedia(String(row.storage_path));}
    catch{throw new HttpError('Falha ao remover o arquivo de áudio do storage.',502);}
  }

  checked(await db().from('radar_voice_assets').delete().eq('id',assetId).eq('script_id',scriptId));

  if(row.selected){
    const fallback=checked(await db().from('radar_voice_assets')
      .select('id')
      .eq('script_id',scriptId)
      .eq('status','ready')
      .order('take',{ascending:false})
      .limit(1)
      .maybeSingle());
    if(fallback)await selectVoiceAsset(scriptId,String(fallback.id));
  }
}

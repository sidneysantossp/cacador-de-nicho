import 'server-only';

import { createHash } from 'node:crypto';
import type { EpisodeScript, VoiceAlignment, VoiceAsset } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { loadEpisodeScript } from './episode-script';
import { loadProductionDna } from './production-dna';
import { voiceAssetIsStale, voiceModelCharacterLimits } from '@/lib/voice-policy';

const BUCKET='cacadores-media';
const MAX_AUDIO_BYTES=100*1024*1024;

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
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
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

  const upload=await db().storage.from(BUCKET).upload(storagePath,bytes,{
    contentType:mimeType,
    upsert:false,
    cacheControl:'3600'
  });

  if(upload.error){
    await db().from('radar_voice_assets').update({
      status:'failed',
      payload:{...metadata,error:'storage-upload-failed'},
      updated_at:new Date().toISOString()
    }).eq('id',reservation.id);
    throw new HttpError('Falha ao armazenar o áudio no storage privado.',502);
  }

  const row=checked(await db().from('radar_voice_assets').update({
    status:'ready',
    storage_path:storagePath,
    mime_type:mimeType,
    bytes:bytes.length,
    payload:metadata,
    updated_at:new Date().toISOString()
  }).eq('id',reservation.id)
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .single());

  return normalizeAsset(row as never);
}

export async function listVoiceAssets(scriptId:string){
  const script=await loadEpisodeScript(scriptId);
  if(!script)throw new HttpError('Roteiro não encontrado.',404);
  const rows=checked(await db().from('radar_voice_assets')
    .select('id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
    .eq('script_id',scriptId)
    .order('take',{ascending:false})
    .limit(100));
  const assets=(rows??[]).map(row=>normalizeAsset(row as never));
  return Promise.all(assets.map(async asset=>{
    let signedUrl:string|null=null;
    if(asset.status==='ready'&&asset.storagePath){
      const signed=await db().storage.from(BUCKET).createSignedUrl(asset.storagePath,3600);
      if(!signed.error)signedUrl=signed.data.signedUrl;
    }
    return {
      ...asset,
      signedUrl,
      stale:voiceAssetIsStale(asset,script,textHash(script.content))
    };
  }));
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

export async function listElevenLabsVoices():Promise<ElevenVoiceOption[]>{
  const key=await providerSecret('elevenlabs');
  let response:Response;
  try{
    response=await fetch('https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false',{
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

export async function generateElevenLabsVoice(input:{
  scriptId:string;
  voiceId?:string;
  voiceName?:string;
  modelId?:string;
}){
  const script=await approvedScript(input.scriptId);
  const dna=await loadProductionDna(script.channelId);
  const voiceId=(input.voiceId??dna?.voice.voiceId??'').trim();
  if(!voiceId)throw new HttpError('Selecione uma voz ElevenLabs antes de gerar a narração.',400);

  const modelId=(input.modelId??'eleven_flash_v2_5').trim();
  const limit=voiceModelCharacterLimits[modelId as keyof typeof voiceModelCharacterLimits];
  if(!limit)throw new HttpError('Modelo ElevenLabs não suportado pelo Voice Engine.',400);
  if(script.content.length>limit){
    throw new HttpError('O roteiro tem '+script.content.length+' caracteres e excede o limite de '+limit+' deste modelo. Escolha um modelo com limite maior ou divida a produção.',409);
  }

  const key=await providerSecret('elevenlabs');
  let response:Response;
  try{
    response=await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(voiceId)+'/with-timestamps?output_format=mp3_44100_128',
      {
        method:'POST',
        headers:{'xi-api-key':key,'Content-Type':'application/json'},
        body:JSON.stringify({text:script.content,model_id:modelId}),
        signal:AbortSignal.timeout(180000),
        cache:'no-store'
      }
    );
  }catch{
    throw new HttpError('A ElevenLabs excedeu o tempo de geração da narração.',504);
  }

  if(!response.ok){
    const body=await response.text().catch(()=>'');
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso ou créditos da conta.',429);
    if(response.status===422)throw new HttpError('A ElevenLabs recusou a voz, o modelo ou o texto enviados.',422);
    throw new HttpError('A ElevenLabs falhou ao gerar a narração'+(body?' ('+body.slice(0,180)+')':'')+'.',502);
  }

  const body=await response.json() as ElevenTtsResponse;
  if(!body.audio_base64)throw new HttpError('A ElevenLabs não devolveu áudio para esta geração.',502);
  const bytes=Buffer.from(body.audio_base64,'base64');
  if(!bytes.length)throw new HttpError('A ElevenLabs devolveu um áudio vazio.',502);
  if(bytes.length>MAX_AUDIO_BYTES)throw new HttpError('O áudio gerado excede o limite de 100 MB.',413);

  const alignment=normalizeAlignment(body.normalized_alignment??body.alignment);
  const metadata={
    scriptVersion:script.version,
    scriptWordCount:script.wordCount,
    textHash:textHash(script.content),
    modelId,
    voiceId,
    voiceName:(input.voiceName??dna?.voice.voiceName??'').trim()||undefined,
    durationSeconds:durationFromAlignment(alignment),
    characterCount:script.content.length,
    alignment
  };
  const reservation=await reserveAsset(script,'generated','elevenlabs','audio/mpeg',null,metadata);
  return persistAudio(script,reservation,bytes,'audio/mpeg',null,metadata);
}

export async function selectVoiceAsset(scriptId:string,assetId:string){
  const result=await db().rpc('select_voice_asset',{p_script_id:scriptId,p_asset_id:assetId});
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('voice asset not ready'))throw new HttpError('Este take ainda não está pronto para uso.',409);
    throw new HttpError('Falha ao selecionar o take de voz.',502);
  }
}

export async function deleteVoiceAsset(scriptId:string,assetId:string){
  const row=checked(await db().from('radar_voice_assets')
    .select('id,script_id,selected,storage_path')
    .eq('id',assetId)
    .eq('script_id',scriptId)
    .maybeSingle());
  if(!row)throw new HttpError('Take de voz não encontrado.',404);

  if(row.storage_path){
    const removal=await db().storage.from(BUCKET).remove([String(row.storage_path)]);
    if(removal.error)throw new HttpError('Falha ao remover o arquivo de áudio do storage.',502);
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

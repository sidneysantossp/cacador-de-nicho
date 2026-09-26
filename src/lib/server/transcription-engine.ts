import 'server-only';

import type { EpisodeScript, Transcript, TranscriptPayload, TranscriptVersion, TranscriptVersionSummary, VoiceAsset } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadEpisodeScript } from './episode-script';
import { downloadVoiceAsset, loadVoiceAsset } from './voice-engine';
import { providerSecret } from './providers';
import {
  normalizeTranscriptPayload, parseSrtOrVtt, parseTimestampedText,
  parseTranscriptJson, transcriptApprovalIssues, transcriptFromAlignment
} from '@/lib/transcript-policy';

function normalizeRow(row:{
  id:string;channel_id:string;episode_id:string;script_id:string;voice_asset_id:string;
  version:number;source_type:Transcript['sourceType'];status:Transcript['status'];
  payload:unknown;created_at:string;updated_at:string;
}):Transcript{
  const payload=row.payload as TranscriptPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    scriptId:row.script_id,
    voiceAssetId:row.voice_asset_id,
    sourceType:row.source_type,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

export async function listTranscripts(scriptId:string):Promise<Transcript[]>{
  const rows=checked(await db().from('radar_transcripts')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,version,source_type,status,payload,created_at,updated_at')
    .eq('script_id',scriptId)
    .order('updated_at',{ascending:false})
    .limit(100));
  return (rows??[]).map(row=>normalizeRow(row as never));
}

export async function listTranscriptsByChannel(channelId:string):Promise<Transcript[]>{
  const rows=checked(await db().from('radar_transcripts')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,version,source_type,status,payload,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(300));
  return (rows??[]).map(row=>normalizeRow(row as never));
}

export async function loadTranscript(transcriptId:string):Promise<Transcript|null>{
  const row=checked(await db().from('radar_transcripts')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,version,source_type,status,payload,created_at,updated_at')
    .eq('id',transcriptId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadTranscriptByVoiceAsset(voiceAssetId:string):Promise<Transcript|null>{
  const row=checked(await db().from('radar_transcripts')
    .select('id,channel_id,episode_id,script_id,voice_asset_id,version,source_type,status,payload,created_at,updated_at')
    .eq('voice_asset_id',voiceAssetId)
    .maybeSingle());
  return row?normalizeRow(row as never):null;
}

export async function loadTranscriptHistory(transcriptId:string,limit=20):Promise<TranscriptVersionSummary[]>{
  const rows=checked(await db().from('radar_transcript_versions')
    .select('version,status,created_at')
    .eq('transcript_id',transcriptId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as Transcript['status'],
    createdAt:String(row.created_at)
  }));
}

export async function loadTranscriptHistoryVersion(
  transcriptId:string,
  version:number
):Promise<TranscriptVersion|null>{
  const row=checked(await db().from('radar_transcript_versions')
    .select('version,status,payload,created_at')
    .eq('transcript_id',transcriptId)
    .eq('version',version)
    .maybeSingle());
  if(!row)return null;
  return {
    version:Number(row.version),
    status:row.status as Transcript['status'],
    payload:row.payload as TranscriptPayload,
    createdAt:String(row.created_at)
  };
}

async function eligibleContext(voiceAssetId:string){
  const asset=await loadVoiceAsset(voiceAssetId);
  if(!asset)throw new HttpError('Take de voz não encontrado.',404);
  if(asset.status!=='ready')throw new HttpError('O take de voz ainda não está pronto.',409);
  const script=await loadEpisodeScript(asset.scriptId);
  if(!script)throw new HttpError('Roteiro não encontrado.',404);
  if(script.status!=='approved')throw new HttpError('O roteiro precisa estar aprovado antes da transcrição.',409);
  return {asset,script};
}

function basePayload(asset:VoiceAsset,script:EpisodeScript,sourceType:Transcript['sourceType']):TranscriptPayload{
  const now=new Date().toISOString();
  return {
    kind:'transcript',
    id:crypto.randomUUID(),
    channelId:asset.channelId,
    episodeId:asset.episodeId,
    scriptId:asset.scriptId,
    voiceAssetId:asset.id,
    sourceType,
    text:'',
    words:[],
    segments:[],
    scriptMatchScore:null,
    scriptVersion:asset.scriptVersion,
    voiceTake:asset.take,
    provenance:{},
    review:{scriptMismatchOverride:false,notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export async function saveTranscript(
  payload:TranscriptPayload,
  status:Transcript['status'],
  expectedVersion:number|null
):Promise<Transcript>{
  const {asset,script}=await eligibleContext(payload.voiceAssetId);
  if(asset.channelId!==payload.channelId||asset.episodeId!==payload.episodeId||asset.scriptId!==payload.scriptId){
    throw new HttpError('Transcript incompatível com o take de voz.',409);
  }

  const existing=await loadTranscript(payload.id);
  const normalized=normalizeTranscriptPayload({
    ...payload,
    createdAt:existing?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  },script.content);

  if(status==='approved'){
    const issues=transcriptApprovalIssues(normalized,script.version);
    if(issues.length)throw new HttpError('Transcript ainda não pode ser aprovado: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_transcript',{
    p_transcript_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_script_id:normalized.scriptId,
    p_voice_asset_id:normalized.voiceAssetId,
    p_source_type:normalized.sourceType,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('transcript version conflict'))throw new HttpError('Transcript desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('voice asset already has transcript'))throw new HttpError('Este take já possui transcript. Abra o transcript existente para criar uma nova versão.',409);
    if(message.includes('voice asset not eligible'))throw new HttpError('O take ou roteiro não está elegível para transcrição.',409);
    throw new HttpError('Falha ao salvar o transcript no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o transcript.',502);
  return {...normalized,version,status};
}

async function saveGeneratedTranscript(
  asset:VoiceAsset,
  script:EpisodeScript,
  sourceType:Transcript['sourceType'],
  data:{
    text:string;
    words:TranscriptPayload['words'];
    segments:TranscriptPayload['segments'];
    languageCode?:string;
    originalFormat?:TranscriptPayload['originalFormat'];
    provenance:TranscriptPayload['provenance'];
  }
){
  const existing=await loadTranscriptByVoiceAsset(asset.id);
  const payload:TranscriptPayload={
    ...(existing?{
      ...existing,
      id:existing.id,
      createdAt:existing.createdAt,
      review:existing.review
    }:basePayload(asset,script,sourceType)),
    sourceType,
    text:data.text,
    words:data.words,
    segments:data.segments,
    languageCode:data.languageCode,
    originalFormat:data.originalFormat,
    provenance:data.provenance,
    scriptVersion:asset.scriptVersion,
    voiceTake:asset.take,
    updatedAt:new Date().toISOString()
  };
  return saveTranscript(payload,'draft',existing?.version??0);
}

export async function createTranscriptFromAlignment(voiceAssetId:string){
  const {asset,script}=await eligibleContext(voiceAssetId);
  if(!asset.alignment)throw new HttpError('Este take não possui alignment temporal.',409);
  let converted;
  try{converted=transcriptFromAlignment(asset.alignment);}
  catch{throw new HttpError('O alignment deste take está incompleto ou inválido.',409);}
  return saveGeneratedTranscript(asset,script,'alignment',{
    ...converted,
    provenance:{provider:asset.provider??'elevenlabs',model:asset.modelId}
  });
}

export async function transcribeWithScribe(voiceAssetId:string){
  const {asset,script}=await eligibleContext(voiceAssetId);
  const {bytes}=await downloadVoiceAsset(voiceAssetId);
  const key=await providerSecret('elevenlabs');

  const form=new FormData();
  const filename=asset.originalName||('take-'+String(asset.take).padStart(3,'0')+'.mp3');
  form.set('file',new Blob([bytes],{type:asset.mimeType}),filename);
  form.set('model_id','scribe_v2');
  form.set('timestamps_granularity','word');
  form.set('diarize','false');
  form.set('tag_audio_events','false');

  let response:Response;
  try{
    response=await fetch('https://api.elevenlabs.io/v1/speech-to-text',{
      method:'POST',
      headers:{'xi-api-key':key},
      body:form,
      signal:AbortSignal.timeout(300000),
      cache:'no-store'
    });
  }catch{
    throw new HttpError('A ElevenLabs excedeu o tempo de transcrição.',504);
  }

  if(!response.ok){
    const text=await response.text().catch(()=>'');
    if(response.status===401)throw new HttpError('A ElevenLabs recusou a credencial configurada.',422);
    if(response.status===429)throw new HttpError('A ElevenLabs atingiu o limite de uso ou créditos da conta.',429);
    if(response.status===422)throw new HttpError('A ElevenLabs recusou o arquivo de áudio para transcrição.',422);
    throw new HttpError('A ElevenLabs falhou ao transcrever o áudio'+(text?' ('+text.slice(0,180)+')':'')+'.',502);
  }

  const body=await response.json();
  let parsed;
  try{parsed=parseTranscriptJson(JSON.stringify(body),asset.durationSeconds);}
  catch{throw new HttpError('A resposta do Scribe não pôde ser normalizada.',502);}
  if(!parsed.text||!parsed.segments.length)throw new HttpError('O Scribe não devolveu segmentos utilizáveis.',502);

  return saveGeneratedTranscript(asset,script,'scribe',{
    text:parsed.text,
    words:parsed.words,
    segments:parsed.segments,
    languageCode:parsed.languageCode,
    provenance:{provider:'elevenlabs',model:'scribe_v2'}
  });
}

export async function importTranscriptFile(voiceAssetId:string,file:File){
  const {asset,script}=await eligibleContext(voiceAssetId);
  if(file.size<=0)throw new HttpError('O arquivo de transcrição está vazio.',400);
  if(file.size>10*1024*1024)throw new HttpError('A transcrição excede o limite de 10 MB.',413);
  const input=await file.text();
  const name=file.name.toLowerCase();
  let format:TranscriptPayload['originalFormat'];
  let parsed:{text:string;words:TranscriptPayload['words'];segments:TranscriptPayload['segments'];languageCode?:string};

  try{
    if(name.endsWith('.srt')){
      format='srt';parsed=parseSrtOrVtt(input);
    }else if(name.endsWith('.vtt')){
      format='vtt';parsed=parseSrtOrVtt(input);
    }else if(name.endsWith('.json')){
      format='json';parsed=parseTranscriptJson(input,asset.durationSeconds);
    }else{
      format='txt';parsed=parseTimestampedText(input,asset.durationSeconds);
    }
  }catch{
    throw new HttpError('Não foi possível interpretar a transcrição. Use SRT, VTT, TXT com timestamps ou JSON.',400);
  }

  if(!parsed.text||!parsed.segments.length){
    throw new HttpError('A transcrição não contém segmentos temporais reconhecíveis.',400);
  }

  return saveGeneratedTranscript(asset,script,'imported',{
    text:parsed.text,
    words:parsed.words,
    segments:parsed.segments,
    languageCode:parsed.languageCode,
    originalFormat:format,
    provenance:{importedBy:'operator'}
  });
}

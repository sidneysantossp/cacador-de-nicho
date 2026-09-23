import 'server-only';

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AudioLibraryAsset, SceneAssetLicense } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { normalizeMediaTags } from '@/lib/media-library-policy';

const BUCKET='cacadores-media';
const MAX_AUDIO_BYTES=100*1024*1024;
const MIME_EXT:Record<string,string>={
  'audio/mpeg':'mp3',
  'audio/mp3':'mp3',
  'audio/wav':'wav',
  'audio/x-wav':'wav',
  'audio/mp4':'m4a',
  'audio/x-m4a':'m4a',
  'audio/ogg':'ogg',
  'audio/flac':'flac',
  'audio/webm':'webm'
};

type Row={
  id:string;channel_id:string;kind:'music'|'sfx';source_type:'uploaded'|'generated'|'stock';
  provider:string|null;status:'processing'|'ready'|'failed';storage_path:string;mime_type:string;
  original_name:string|null;bytes:number|string;duration_seconds:number|string|null;bpm:number|string|null;
  favorite:boolean;tags:string[]|null;notes:string;license:unknown;created_at:string;updated_at:string;
};

function extensionFor(mime:string,name:string){
  const known=MIME_EXT[mime];
  if(known)return known;
  const ext=name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  return ext&&['mp3','wav','m4a','ogg','flac','webm'].includes(ext)?ext:'bin';
}

function normalizeMime(mime:string,name:string){
  if(MIME_EXT[mime])return mime;
  const ext=extensionFor(mime,name);
  if(ext==='mp3')return 'audio/mpeg';
  if(ext==='wav')return 'audio/wav';
  if(ext==='m4a')return 'audio/mp4';
  if(ext==='ogg')return 'audio/ogg';
  if(ext==='flac')return 'audio/flac';
  if(ext==='webm')return 'audio/webm';
  throw new HttpError('Formato de áudio não suportado. Use MP3, WAV, M4A, OGG, FLAC ou WebM.',415);
}

function normalizeRow(row:Row,signedUrl:string|null):AudioLibraryAsset{
  const license=(row.license&&typeof row.license==='object'?row.license:{
    type:'owned',label:'Owned / operator supplied'
  }) as SceneAssetLicense;
  return {
    id:row.id,
    channelId:row.channel_id,
    kind:row.kind,
    sourceType:row.source_type,
    provider:row.provider??undefined,
    status:row.status,
    storagePath:row.storage_path,
    mimeType:row.mime_type,
    originalName:row.original_name??undefined,
    bytes:Number(row.bytes),
    durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),
    bpm:row.bpm===null?null:Number(row.bpm),
    favorite:Boolean(row.favorite),
    tags:normalizeMediaTags(row.tags??[]),
    notes:String(row.notes??''),
    license,
    signedUrl,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

async function signedUrl(storagePath:string){
  const signed=await db().storage.from(BUCKET).createSignedUrl(storagePath,3600);
  return signed.error?null:signed.data.signedUrl;
}

async function ensureChannel(channelId:string){
  const row=checked(await db().from('radar_managed_channels').select('id').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
}

function runProbe(filePath:string){
  return new Promise<number>((resolve,reject)=>{
    const child=spawn('ffprobe',[
      '-v','error','-show_entries','format=duration',
      '-of','default=noprint_wrappers=1:nokey=1',filePath
    ],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk.toString());
    child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-2000));
    child.on('error',reject);
    child.on('close',code=>{
      const duration=Number(stdout.trim());
      if(code===0&&Number.isFinite(duration)&&duration>0)resolve(duration);
      else reject(new Error(stderr||'ffprobe failed'));
    });
  });
}

async function probeDuration(bytes:Buffer,extension:string){
  const dir=await mkdtemp(path.join(os.tmpdir(),'cacadores-audio-'));
  const filePath=path.join(dir,'input.'+extension);
  try{
    await writeFile(filePath,bytes);
    return await runProbe(filePath);
  }catch{
    throw new HttpError('Não foi possível ler a duração deste arquivo de áudio.',415);
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

export async function listAudioAssets(channelId:string):Promise<AudioLibraryAsset[]>{
  const rows=checked(await db().from('radar_audio_assets')
    .select('id,channel_id,kind,source_type,provider,status,storage_path,mime_type,original_name,bytes,duration_seconds,bpm,favorite,tags,notes,license,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('favorite',{ascending:false})
    .order('updated_at',{ascending:false})
    .limit(1000));
  return Promise.all((rows??[]).map(async row=>normalizeRow(row as Row,String(row.storage_path??'')?await signedUrl(String(row.storage_path)):null)));
}

export async function loadAudioAssetsByIds(ids:string[]):Promise<AudioLibraryAsset[]>{
  const unique=[...new Set(ids.filter(Boolean))].slice(0,1000);
  if(!unique.length)return [];
  const rows=checked(await db().from('radar_audio_assets')
    .select('id,channel_id,kind,source_type,provider,status,storage_path,mime_type,original_name,bytes,duration_seconds,bpm,favorite,tags,notes,license,created_at,updated_at')
    .in('id',unique));
  return Promise.all((rows??[]).map(async row=>normalizeRow(row as Row,String(row.storage_path??'')?await signedUrl(String(row.storage_path)):null)));
}

export async function uploadAudioAsset(input:{
  channelId:string;
  kind:'music'|'sfx';
  file:File;
  tags?:string[];
  notes?:string;
}){
  await ensureChannel(input.channelId);
  if(input.file.size<=0)throw new HttpError('O arquivo de áudio está vazio.',400);
  if(input.file.size>MAX_AUDIO_BYTES)throw new HttpError('O áudio excede o limite de 100 MB.',413);
  const mimeType=normalizeMime(input.file.type,input.file.name);
  const ext=extensionFor(mimeType,input.file.name);
  const bytes=Buffer.from(await input.file.arrayBuffer());
  const durationSeconds=await probeDuration(bytes,ext);
  const id=crypto.randomUUID();
  const storagePath=[
    'channels',input.channelId,'audio-library',input.kind,id+'.'+ext
  ].join('/');
  const upload=await db().storage.from(BUCKET).upload(storagePath,bytes,{
    contentType:mimeType,upsert:false,cacheControl:'3600'
  });
  if(upload.error)throw new HttpError('Falha ao armazenar o áudio na biblioteca privada.',502);

  const license:SceneAssetLicense={type:'owned',label:'Owned / operator supplied'};
  const inserted=await db().from('radar_audio_assets').insert({
    id,
    channel_id:input.channelId,
    kind:input.kind,
    source_type:'uploaded',
    provider:'external',
    status:'ready',
    storage_path:storagePath,
    mime_type:mimeType,
    original_name:input.file.name,
    bytes:bytes.length,
    duration_seconds:durationSeconds,
    favorite:false,
    tags:normalizeMediaTags(input.tags??[]),
    notes:(input.notes??'').trim().slice(0,5000),
    license
  }).select('id,channel_id,kind,source_type,provider,status,storage_path,mime_type,original_name,bytes,duration_seconds,bpm,favorite,tags,notes,license,created_at,updated_at').single();

  if(inserted.error){
    await db().storage.from(BUCKET).remove([storagePath]).catch(()=>{});
    throw new HttpError('Falha ao registrar o áudio na biblioteca.',502);
  }
  return normalizeRow(inserted.data as Row,await signedUrl(storagePath));
}

export async function saveAudioAssetMetadata(input:{
  channelId:string;
  assetId:string;
  favorite:boolean;
  tags:string[];
  notes:string;
  bpm:number|null;
}){
  const row=checked(await db().from('radar_audio_assets')
    .update({
      favorite:input.favorite,
      tags:normalizeMediaTags(input.tags),
      notes:input.notes.trim().slice(0,5000),
      bpm:input.bpm,
      updated_at:new Date().toISOString()
    })
    .eq('id',input.assetId)
    .eq('channel_id',input.channelId)
    .select('id,channel_id,kind,source_type,provider,status,storage_path,mime_type,original_name,bytes,duration_seconds,bpm,favorite,tags,notes,license,created_at,updated_at')
    .maybeSingle());
  if(!row)throw new HttpError('Áudio da biblioteca não encontrado.',404);
  return normalizeRow(row as Row,await signedUrl(String(row.storage_path)));
}

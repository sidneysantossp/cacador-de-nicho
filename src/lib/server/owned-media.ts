import 'server-only';

import type { OwnedMediaAsset } from '@/lib/types';
import { ownedMediaKind, ownedMediaSearchText, parseOwnedMediaFilename } from '@/lib/owned-media-policy';
import { checked, db } from './db';
import { HttpError } from './auth';
import { headMedia, presignedR2Upload, removeMedia, signedMediaUrl } from './media-storage';

const MAX_BYTES=2*1024*1024*1024;

type Row={
  id:string;
  asset_kind:'image'|'video';
  status:'uploading'|'ready'|'failed';
  storage_path:string;
  mime_type:string;
  original_name:string;
  bytes:number|string;
  width:number|null;
  height:number|null;
  duration_seconds:number|string|null;
  title:string;
  tags:string[]|null;
  semantic:unknown;
  search_text:string;
  etag:string|null;
  payload:unknown;
  created_at:string;
  updated_at:string;
};

function safeName(value:string){
  const parts=value.split('.');
  const ext=parts.length>1?'.'+String(parts.pop()).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8):'';
  const base=parts.join('.').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-_.]+|[-_.]+$/g,'')
    .slice(0,120)||'media';
  return base+ext;
}

function normalizedSemantic(value:unknown){
  const source=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const list=(key:string)=>Array.isArray(source[key])
    ?[...new Set((source[key] as unknown[]).map(item=>String(item??'').trim().toLowerCase()).filter(Boolean))].slice(0,50)
    :[];
  return {subjects:list('subjects'),locations:list('locations'),periods:list('periods'),shotTypes:list('shotTypes'),moods:list('moods')};
}

async function rowToAsset(row:Row):Promise<OwnedMediaAsset>{
  return {
    id:String(row.id),
    assetKind:row.asset_kind,
    status:row.status,
    sourceType:'owned',
    storagePath:String(row.storage_path),
    mimeType:String(row.mime_type),
    originalName:String(row.original_name),
    bytes:Number(row.bytes??0),
    width:row.width===null?null:Number(row.width),
    height:row.height===null?null:Number(row.height),
    durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),
    title:String(row.title??row.original_name),
    tags:row.tags??[],
    semantic:normalizedSemantic(row.semantic),
    signedUrl:row.status==='ready'?await signedMediaUrl(row.storage_path,3600):null,
    etag:row.etag??undefined,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

export async function prepareOwnedMediaUpload(input:{
  fileName:string;
  mimeType:string;
  bytes:number;
  browserOrigin?:string;
}){
  const fileName=input.fileName.trim().slice(0,255);
  const mimeType=input.mimeType.trim().toLowerCase();
  const kind=ownedMediaKind(mimeType);
  if(!fileName)throw new HttpError('Nome do arquivo ausente.',400);
  if(!kind)throw new HttpError('Formato não suportado. Use MP4, MOV, WebM, JPG, PNG ou WebP.',415);
  if(!Number.isFinite(input.bytes)||input.bytes<=0)throw new HttpError('O arquivo está vazio.',400);
  if(input.bytes>MAX_BYTES)throw new HttpError('Arquivo maior que 2 GB. Divida o material antes de importar.',413);

  const duplicate=checked(await db().from('radar_owned_media_assets')
    .select('id,status')
    .eq('original_name',fileName)
    .eq('bytes',Math.round(input.bytes))
    .in('status',['uploading','ready'])
    .limit(1)
    .maybeSingle());
  if(duplicate)throw new HttpError('Este arquivo já existe ou está sendo enviado para a Biblioteca.',409);

  const id=crypto.randomUUID();
  const now=new Date();
  const key=[
    'library','owned',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth()+1).padStart(2,'0'),
    id,
    safeName(fileName)
  ].join('/');
  let upload:{uploadUrl:string;storagePath:string};
  try{upload=await presignedR2Upload(key,mimeType,1800,input.browserOrigin);}
  catch{throw new HttpError('O Cloudflare R2 precisa estar configurado para upload direto.',503);}

  const parsed=parseOwnedMediaFilename(fileName);
  const searchText=ownedMediaSearchText({
    title:parsed.title,originalName:fileName,tags:parsed.tags,semantic:parsed.semantic
  });
  checked(await db().from('radar_owned_media_assets').insert({
    id,
    asset_kind:kind,
    status:'uploading',
    storage_path:upload.storagePath,
    mime_type:mimeType,
    original_name:fileName,
    bytes:Math.round(input.bytes),
    width:null,
    height:null,
    duration_seconds:null,
    title:parsed.title,
    tags:parsed.tags,
    semantic:parsed.semantic,
    search_text:searchText,
    etag:null,
    payload:{
      source:'operator-drag-drop',
      filenameIntelligence:parsed,
      expectedBytes:Math.round(input.bytes)
    }
  }));
  return {assetId:id,uploadUrl:upload.uploadUrl,storagePath:upload.storagePath,parsed};
}

export async function finalizeOwnedMediaUpload(input:{
  assetId:string;
  width?:number|null;
  height?:number|null;
  durationSeconds?:number|null;
}){
  const row=checked(await db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,title,tags,semantic,search_text,etag,payload,created_at,updated_at')
    .eq('id',input.assetId)
    .maybeSingle()) as Row|null;
  if(!row)throw new HttpError('Upload não encontrado.',404);
  if(row.status==='ready')return rowToAsset(row);
  let remote:{bytes:number;contentType:string;etag:string};
  try{remote=await headMedia(row.storage_path);}
  catch{throw new HttpError('O arquivo ainda não apareceu no R2. Tente finalizar novamente.',409);}
  if(remote.bytes<=0)throw new HttpError('O arquivo enviado ao R2 está vazio.',422);
  if(Number(row.bytes)!==remote.bytes){
    await db().from('radar_owned_media_assets').update({
      status:'failed',
      payload:{...(row.payload as Record<string,unknown>??{}),error:'size-mismatch',actualBytes:remote.bytes},
      updated_at:new Date().toISOString()
    }).eq('id',row.id);
    throw new HttpError('O tamanho recebido no R2 não corresponde ao arquivo original.',422);
  }
  const width=input.width&&input.width>0?Math.round(input.width):null;
  const height=input.height&&input.height>0?Math.round(input.height):null;
  const duration=input.durationSeconds&&input.durationSeconds>0?input.durationSeconds:null;
  checked(await db().from('radar_owned_media_assets').update({
    status:'ready',
    width,
    height,
    duration_seconds:duration,
    mime_type:remote.contentType||row.mime_type,
    etag:remote.etag||null,
    updated_at:new Date().toISOString()
  }).eq('id',row.id));
  const updated=checked(await db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,title,tags,semantic,search_text,etag,payload,created_at,updated_at')
    .eq('id',row.id).single()) as Row;
  return rowToAsset(updated);
}

export async function listOwnedMediaAssets(input:{
  query?:string;
  kind?:'all'|'image'|'video';
  page?:number;
  limit?:number;
}={}){
  const page=Math.max(1,Math.min(Number(input.page??1)||1,100));
  const limit=Math.max(12,Math.min(Number(input.limit??60)||60,120));
  let query=db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,title,tags,semantic,search_text,etag,payload,created_at,updated_at',{count:'exact'})
    .eq('status','ready')
    .order('created_at',{ascending:false});
  if(input.kind&&input.kind!=='all')query=query.eq('asset_kind',input.kind);
  const term=(input.query??'').trim();
  if(term)query=query.ilike('search_text','%'+term.replace(/[%_]/g,'')+'%');
  const start=(page-1)*limit;
  const result=await query.range(start,start+limit-1);
  if(result.error)throw new HttpError('Falha ao carregar a Biblioteca de Mídia.',502);
  const rows=(result.data??[]) as Row[];
  const items=await Promise.all(rows.map(rowToAsset));
  const total=Number(result.count??items.length);
  return {items,page,limit,total,hasMore:start+items.length<total};
}

export async function updateOwnedMediaMetadata(input:{
  assetId:string;
  title:string;
  tags:string[];
  semantic:OwnedMediaAsset['semantic'];
}){
  const title=input.title.trim().slice(0,220);
  const tags=[...new Set(input.tags.map(value=>value.trim().toLowerCase()).filter(Boolean))].slice(0,50);
  const semantic=normalizedSemantic(input.semantic);
  const original=checked(await db().from('radar_owned_media_assets').select('original_name').eq('id',input.assetId).maybeSingle());
  if(!original)throw new HttpError('Asset não encontrado.',404);
  const searchText=ownedMediaSearchText({title,originalName:String(original.original_name),tags,semantic});
  checked(await db().from('radar_owned_media_assets').update({
    title,tags,semantic,search_text:searchText,updated_at:new Date().toISOString()
  }).eq('id',input.assetId));
}

export async function deleteOwnedMediaAsset(assetId:string){
  const row=checked(await db().from('radar_owned_media_assets').select('id,storage_path').eq('id',assetId).maybeSingle());
  if(!row)throw new HttpError('Asset não encontrado.',404);
  try{await removeMedia(String(row.storage_path));}
  catch{throw new HttpError('Falha ao remover o arquivo do R2.',502);}
  checked(await db().from('radar_owned_media_assets').delete().eq('id',assetId));
}

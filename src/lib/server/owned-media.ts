import 'server-only';

import type { OwnedMediaAsset } from '@/lib/types';
import { normalizeOwnedMediaDuplicateName, ownedMediaKind, ownedMediaSearchText, parseOwnedMediaFilename } from '@/lib/owned-media-policy';
import { MEDIA_TAXONOMY_VERSION } from '@/lib/media-taxonomy';
import { checked, db } from './db';
import { HttpError } from './auth';
import { headMedia, preferredMediaStorage, putMediaStream, r2StoragePath, removeMedia, signedMediaUrl } from './media-storage';
import { probeStoredVideo } from './media-probe';
import { searchOwnedMediaEmbeddings } from './media-embeddings';

const MAX_BYTES=2*1024*1024*1024;

type Row={
  id:string;
  asset_kind:'image'|'video';
  status:'uploading'|'ready'|'failed';
  storage_path:string;
  mime_type:string;
  original_name:string;
  normalized_name:string|null;
  content_fingerprint:string|null;
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

function normalizedSemantic(value:unknown):OwnedMediaAsset['semantic']{
  const source=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const list=(key:string)=>Array.isArray(source[key])
    ?[...new Set((source[key] as unknown[]).map(item=>String(item??'').trim().toLowerCase()).filter(Boolean))].slice(0,80)
    :[];
  return {
    subjects:list('subjects'),locations:list('locations'),periods:list('periods'),
    countries:list('countries'),regions:list('regions'),cities:list('cities'),
    districts:list('districts'),landmarks:list('landmarks'),scenes:list('scenes'),
    objects:list('objects'),activities:list('activities'),people:list('people'),
    timeOfDay:list('timeOfDay'),weather:list('weather'),seasons:list('seasons'),
    shotTypes:list('shotTypes'),cameraMotion:list('cameraMotion'),moods:list('moods')
  };
}

async function rowToAsset(row:Row,visualIntelligence?:OwnedMediaAsset['visualIntelligence']):Promise<OwnedMediaAsset>{
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
    visualIntelligence,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at)
  };
}

export type OwnedMediaDuplicateProbe={
  clientId:string;
  fileName:string;
  bytes:number;
  contentFingerprint?:string;
};

export type OwnedMediaDuplicateResult={
  clientId:string;
  duplicate:boolean;
  reason?:'batch-name'|'batch-fingerprint'|'library-name'|'library-fingerprint';
  duplicateOfName?:string;
};

function validFingerprint(value:string|undefined){
  const normalized=(value??'').trim().toLowerCase();
  return /^sample-sha256-v1:[a-f0-9]{64}$/.test(normalized)?normalized:'';
}

export async function preflightOwnedMediaDuplicates(
  probes:OwnedMediaDuplicateProbe[]
):Promise<OwnedMediaDuplicateResult[]>{
  const items=probes.map(item=>({
    ...item,
    bytes:Math.max(0,Math.round(item.bytes)),
    normalizedName:normalizeOwnedMediaDuplicateName(item.fileName),
    fingerprint:validFingerprint(item.contentFingerprint)
  }));
  const result=new Map<string,OwnedMediaDuplicateResult>();
  const seenNames=new Map<string,{clientId:string;fingerprint:string}>();
  const seenFingerprints=new Map<string,string>();

  for(const item of items){
    const nameKey=item.normalizedName+'::'+item.bytes;
    const fingerprintKey=item.fingerprint?item.fingerprint+'::'+item.bytes:'';
    const priorFingerprint=fingerprintKey?seenFingerprints.get(fingerprintKey):undefined;
    const priorName=seenNames.get(nameKey);
    if(priorFingerprint){
      result.set(item.clientId,{clientId:item.clientId,duplicate:true,reason:'batch-fingerprint'});
      continue;
    }
    if(priorName&&(!item.fingerprint||!priorName.fingerprint||item.fingerprint===priorName.fingerprint)){
      result.set(item.clientId,{clientId:item.clientId,duplicate:true,reason:'batch-name'});
      continue;
    }
    if(!priorName)seenNames.set(nameKey,{clientId:item.clientId,fingerprint:item.fingerprint});
    if(fingerprintKey)seenFingerprints.set(fingerprintKey,item.clientId);
  }

  const sizes=[...new Set(items.filter(item=>!result.has(item.clientId)).map(item=>item.bytes).filter(value=>value>0))];
  if(sizes.length){
    const query=await db().from('radar_owned_media_assets')
      .select('id,original_name,normalized_name,content_fingerprint,bytes,status,updated_at')
      .in('bytes',sizes)
      .in('status',['uploading','ready'])
      .order('created_at',{ascending:false})
      .limit(2000);
    if(query.error)throw new HttpError('Falha ao verificar duplicidade da Biblioteca.',502);
    const now=Date.now();
    const rows=(query.data??[]).filter(row=>
      row.status==='ready'||now-new Date(String(row.updated_at)).getTime()<2*60*60*1000
    );
    for(const item of items){
      if(result.has(item.clientId))continue;
      const match=rows.find(row=>{
        if(Number(row.bytes)!==item.bytes)return false;
        const rowFingerprint=validFingerprint(String(row.content_fingerprint??''));
        if(item.fingerprint&&rowFingerprint)return item.fingerprint===rowFingerprint;
        const rowName=String(row.normalized_name??'').trim()||normalizeOwnedMediaDuplicateName(String(row.original_name??''));
        return !!item.normalizedName&&rowName===item.normalizedName;
      });
      if(!match)continue;
      const fingerprintMatch=!!item.fingerprint&&validFingerprint(String(match.content_fingerprint??''))===item.fingerprint;
      result.set(item.clientId,{
        clientId:item.clientId,
        duplicate:true,
        reason:fingerprintMatch?'library-fingerprint':'library-name',
        duplicateOfName:String(match.original_name??'')
      });
    }
  }

  return items.map(item=>result.get(item.clientId)??{clientId:item.clientId,duplicate:false});
}

export async function prepareOwnedMediaUpload(input:{
  fileName:string;
  mimeType:string;
  bytes:number;
  contentFingerprint?:string;
}){
  const fileName=input.fileName.trim().slice(0,255);
  const mimeType=input.mimeType.trim().toLowerCase();
  const kind=ownedMediaKind(mimeType);
  if(!fileName)throw new HttpError('Nome do arquivo ausente.',400);
  if(!kind)throw new HttpError('Formato não suportado. Use MP4, MOV, WebM, JPG, PNG ou WebP.',415);
  if(!Number.isFinite(input.bytes)||input.bytes<=0)throw new HttpError('O arquivo está vazio.',400);
  if(input.bytes>MAX_BYTES)throw new HttpError('Arquivo maior que 2 GB. Divida o material antes de importar.',413);

  const normalizedName=normalizeOwnedMediaDuplicateName(fileName);
  const contentFingerprint=validFingerprint(input.contentFingerprint);
  const [duplicate]=await preflightOwnedMediaDuplicates([{
    clientId:'prepare',
    fileName,
    bytes:input.bytes,
    contentFingerprint:contentFingerprint||undefined
  }]);
  if(duplicate?.duplicate)throw new HttpError('Arquivo duplicado.',409);

  const id=crypto.randomUUID();
  const now=new Date();
  const key=[
    'library','owned',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth()+1).padStart(2,'0'),
    id,
    safeName(fileName)
  ].join('/');
  if(await preferredMediaStorage()!=='r2')throw new HttpError('Configure o Cloudflare R2 para usar a Biblioteca de Mídia.',503);
  const storagePath=r2StoragePath(key);

  const parsed=parseOwnedMediaFilename(fileName);
  const searchText=ownedMediaSearchText({
    title:parsed.title,originalName:fileName,tags:parsed.tags,semantic:parsed.semantic,includeOriginalName:false
  });
  checked(await db().from('radar_owned_media_assets').insert({
    id,
    asset_kind:kind,
    status:'uploading',
    storage_path:storagePath,
    mime_type:mimeType,
    original_name:fileName,
    normalized_name:normalizedName,
    content_fingerprint:contentFingerprint||null,
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
      taxonomyVersion:MEDIA_TAXONOMY_VERSION,
      expectedBytes:Math.round(input.bytes),
      contentFingerprint:contentFingerprint||null
    }
  }));
  return {assetId:id,uploadUrl:'/api/owned-media/upload?assetId='+encodeURIComponent(id),storagePath,parsed};
}


export async function streamOwnedMediaUpload(input:{
  assetId:string;
  body:ReadableStream<Uint8Array>;
  mimeType:string;
  bytes:number;
}){
  const row=checked(await db().from('radar_owned_media_assets')
    .select('id,status,storage_path,mime_type,bytes,payload')
    .eq('id',input.assetId)
    .maybeSingle()) as Pick<Row,'id'|'status'|'storage_path'|'mime_type'|'bytes'|'payload'>|null;
  if(!row)throw new HttpError('Upload não encontrado.',404);
  if(row.status!=='uploading')throw new HttpError('Este upload não está mais aberto para recebimento.',409);
  const expected=Number(row.bytes??0);
  if(input.bytes!==expected)throw new HttpError('O tamanho transmitido não corresponde ao arquivo preparado.',422);
  const mime=input.mimeType.split(';')[0].trim().toLowerCase();
  if(mime!==String(row.mime_type).toLowerCase())throw new HttpError('O tipo do arquivo transmitido não corresponde ao arquivo preparado.',422);
  try{
    await putMediaStream(String(row.storage_path),input.body,mime,input.bytes);
    checked(await db().from('radar_owned_media_assets').update({
      payload:{...(row.payload as Record<string,unknown>??{}),uploadTransport:'same-origin-stream',uploadedAt:new Date().toISOString()},
      updated_at:new Date().toISOString()
    }).eq('id',row.id));
  }catch{
    await db().from('radar_owned_media_assets').update({
      status:'failed',
      payload:{...(row.payload as Record<string,unknown>??{}),error:'stream-upload-failed'},
      updated_at:new Date().toISOString()
    }).eq('id',row.id);
    throw new HttpError('Falha ao transmitir o arquivo para o Cloudflare R2.',502);
  }
  return {assetId:row.id};
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
  let width=input.width&&input.width>0?Math.round(input.width):null;
  let height=input.height&&input.height>0?Math.round(input.height):null;
  let duration=input.durationSeconds&&input.durationSeconds>0?input.durationSeconds:null;
  let technical:Record<string,unknown>|null=null;
  let technicalProbeError:string|null=null;
  if(row.asset_kind==='video'&&(!width||!height||!duration)){
    try{
      const probed=await probeStoredVideo(row.storage_path);
      width=width??probed.width;
      height=height??probed.height;
      duration=duration??probed.durationSeconds;
      technical={
        fps:probed.fps,
        codec:probed.codec,
        bitrate:probed.bitrate,
        probedAt:new Date().toISOString()
      };
    }catch(error){
      technicalProbeError=error instanceof Error?error.message:'ffprobe-failed';
    }
  }
  checked(await db().from('radar_owned_media_assets').update({
    status:'ready',
    width,
    height,
    duration_seconds:duration,
    mime_type:remote.contentType||row.mime_type,
    etag:remote.etag||null,
    payload:{
      ...(row.payload as Record<string,unknown>??{}),
      ...(technical?{technical}:{}),
      ...(technicalProbeError?{technicalProbeError}:{}),
      finalizedAt:new Date().toISOString()
    },
    updated_at:new Date().toISOString()
  }).eq('id',row.id));
  if(row.asset_kind==='video'||row.asset_kind==='image'){
    checked(await db().from('radar_owned_media_analysis_jobs').upsert({
      id:crypto.randomUUID(),
      asset_id:row.id,
      status:'queued',
      worker_token:null,
      lease_until:null,
      last_error:null,
      completed_at:null,
      updated_at:new Date().toISOString()
    },{onConflict:'asset_id',ignoreDuplicates:true}));
  }
  const updated=checked(await db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,title,tags,semantic,search_text,etag,payload,created_at,updated_at')
    .eq('id',row.id).single()) as Row;
  return rowToAsset(updated);
}

export async function listOwnedMediaAssets(input:{
  query?:string;
  kind?:'all'|'image'|'video';
  country?:string;
  city?:string;
  scene?:string;
  timeOfDay?:string;
  weather?:string;
  season?:string;
  shotType?:string;
  cameraMotion?:string;
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
  const facetFilters:Array<[keyof OwnedMediaAsset['semantic'],string|undefined]>= [
    ['countries',input.country],['cities',input.city],['scenes',input.scene],
    ['timeOfDay',input.timeOfDay],['weather',input.weather],['seasons',input.season],
    ['shotTypes',input.shotType],['cameraMotion',input.cameraMotion]
  ];
  for(const [key,value] of facetFilters){
    const normalized=(value??'').trim().toLowerCase();
    if(normalized)query=query.contains('semantic',{[key]:[normalized]});
  }
  const term=(input.query??'').trim();
  const semanticMatches=term
    ?await searchOwnedMediaEmbeddings(term,120).catch(()=>[])
    :[];
  const semanticScoreByAsset=new Map<string,number>();
  for(const match of semanticMatches){
    semanticScoreByAsset.set(
      match.assetId,
      Math.max(semanticScoreByAsset.get(match.assetId)??0,match.similarity)
    );
  }
  if(term){
    const safe=term.replace(/[^a-zA-Z0-9À-ÿ ._()\-]/g,'').replace(/[%_]/g,'').slice(0,120);
    const clauses:string[]=[];
    if(safe){
      clauses.push('search_text.ilike.%'+safe+'%','original_name.ilike.%'+safe+'%');
    }
    const semanticIds=[...semanticScoreByAsset.keys()].filter(id=>/^[0-9a-f-]{36}$/i.test(id));
    if(semanticIds.length)clauses.push('id.in.('+semanticIds.join(',')+')');
    if(clauses.length)query=query.or(clauses.join(','));
  }
  const start=(page-1)*limit;
  const result=term
    ?await query.limit(240)
    :await query.range(start,start+limit-1);
  if(result.error)throw new HttpError('Falha ao carregar a Biblioteca de Mídia.',502);
  let rows=(result.data??[]) as Row[];
  if(term){
    const normalized=term.toLowerCase();
    rows=[...rows].sort((a,b)=>{
      const semanticDelta=(semanticScoreByAsset.get(String(b.id))??0)-(semanticScoreByAsset.get(String(a.id))??0);
      if(Math.abs(semanticDelta)>.0001)return semanticDelta;
      const aLex=(String(a.title??'')+' '+String(a.original_name??'')+' '+String(a.search_text??'')).toLowerCase().includes(normalized)?1:0;
      const bLex=(String(b.title??'')+' '+String(b.original_name??'')+' '+String(b.search_text??'')).toLowerCase().includes(normalized)?1:0;
      return bLex-aLex;
    }).slice(start,start+limit);
  }
  const assetIds=rows.map(row=>String(row.id));
  const intelligenceByAsset=new Map<string,OwnedMediaAsset['visualIntelligence']>();
  if(assetIds.length){
    const intelligence=await db().from('radar_owned_media_visual_analysis')
      .select('asset_id,status,payload,error,analyzed_at')
      .in('asset_id',assetIds);
    if(!intelligence.error){
      for(const row of intelligence.data??[]){
        const payload=row.payload&&typeof row.payload==='object'?row.payload as Record<string,unknown>:{};
        const embedding=payload.embedding&&typeof payload.embedding==='object'
          ?payload.embedding as Record<string,unknown>
          :{};
        intelligenceByAsset.set(String(row.asset_id),{
          status:(['processing','completed','failed'].includes(String(row.status))?String(row.status):'idle') as 'idle'|'processing'|'completed'|'failed',
          segmentCount:Math.max(0,Number(payload.segmentCount??0)||0),
          usableSegmentCount:Math.max(0,Number(payload.usableSegmentCount??0)||0),
          meanQuality:Math.max(0,Math.min(1,Number(payload.meanQuality??0)||0)),
          embeddingStatus:(['completed','failed'].includes(String(embedding.status))?String(embedding.status):'idle') as 'idle'|'completed'|'failed',
          analyzedAt:row.analyzed_at?String(row.analyzed_at):undefined,
          error:row.error?String(row.error):undefined
        });
      }
    }
  }
  const items=await Promise.all(rows.map(row=>rowToAsset(row,intelligenceByAsset.get(String(row.id))??{
    status:'idle',segmentCount:0
  })));
  const total=term?Math.min(Number(result.count??items.length),240):Number(result.count??items.length);
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
  const searchText=ownedMediaSearchText({
    title,originalName:String(original.original_name),tags,semantic,includeOriginalName:false
  });
  checked(await db().from('radar_owned_media_assets').update({
    title,tags,semantic,search_text:searchText,updated_at:new Date().toISOString()
  }).eq('id',input.assetId));
}

export async function reclassifyOwnedMediaTaxonomy(){
  const result=await db().from('radar_owned_media_assets')
    .select('id,original_name,title,tags,semantic,payload')
    .eq('status','ready')
    .order('created_at',{ascending:true})
    .limit(5000);
  if(result.error)throw new HttpError('Falha ao carregar assets para reclassificação.',502);
  let updated=0;
  let preservedVisual=0;
  for(const row of result.data??[]){
    const payload=row.payload&&typeof row.payload==='object'?row.payload as Record<string,unknown>:{};
    const visual=payload.visualIntelligence&&typeof payload.visualIntelligence==='object'
      ?payload.visualIntelligence as Record<string,unknown>
      :{};
    if(visual.status==='completed'){
      preservedVisual++;
      continue;
    }
    const parsed=parseOwnedMediaFilename(String(row.original_name??''));
    const existing=normalizedSemantic(row.semantic);
    const semantic=normalizedSemantic(Object.fromEntries(
      Object.keys(parsed.semantic).map(key=>[
        key,
        [...new Set([
          ...((existing as Record<string,string[]>)[key]??[]),
          ...((parsed.semantic as unknown as Record<string,string[]>)[key]??[])
        ])]
      ])
    ));
    const tags=[...new Set([...(row.tags??[]),...parsed.tags].map(value=>String(value).trim().toLowerCase()).filter(Boolean))].slice(0,50);
    const title=String(row.title??parsed.title);
    const searchText=ownedMediaSearchText({
      title,originalName:String(row.original_name??''),tags,semantic,includeOriginalName:false
    });
    const update=await db().from('radar_owned_media_assets').update({
      tags,semantic,search_text:searchText,
      payload:{...payload,filenameIntelligence:parsed,taxonomyVersion:MEDIA_TAXONOMY_VERSION,taxonomyReclassifiedAt:new Date().toISOString()},
      updated_at:new Date().toISOString()
    }).eq('id',row.id);
    if(update.error)throw new HttpError('Falha ao atualizar a taxonomia do acervo.',502);
    updated++;
  }
  return {updated,preservedVisual,taxonomyVersion:MEDIA_TAXONOMY_VERSION};
}

export async function deleteOwnedMediaAsset(assetId:string){
  const row=checked(await db().from('radar_owned_media_assets').select('id,storage_path').eq('id',assetId).maybeSingle());
  if(!row)throw new HttpError('Asset não encontrado.',404);
  try{await removeMedia(String(row.storage_path));}
  catch{throw new HttpError('Falha ao remover o arquivo do R2.',502);}
  checked(await db().from('radar_owned_media_assets').delete().eq('id',assetId));
}

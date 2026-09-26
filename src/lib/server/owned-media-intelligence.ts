import 'server-only';

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  OwnedMediaAsset, OwnedMediaIntelligenceResult, OwnedMediaVisualSegment, VisualSegmentSemantic
} from '@/lib/types';
import { classifyMediaTaxonomy } from '@/lib/media-taxonomy';
import { ownedMediaSearchText } from '@/lib/owned-media-policy';
import { normalizeMediaTags, scoreVisualIntent, visualSegmentSearchText, visualSemanticSearchText } from '@/lib/media-library-policy';
import { HttpError } from './auth';
import { checked, db } from './db';
import { downloadMediaToFile } from './media-storage';
import { probeVideoInput } from './media-probe';
import { providerSecret } from './providers';
import { indexOwnedMediaEmbeddings, searchOwnedMediaEmbeddings } from './media-embeddings';

const execFile=promisify(execFileCallback);
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';
const MAX_SEGMENTS=24;
const MAX_BATCH=6;
const MAX_VIDEO_BYTES=2*1024*1024*1024;

const GIB=1024*1024*1024;

async function ensureAnalysisDisk(sourceBytes:number,minimumBytes=2*GIB){
  const stats=await statfs(os.tmpdir());
  const freeBytes=Math.max(0,Number(stats.bavail)*Number(stats.bsize));
  const requiredBytes=Math.max(minimumBytes,Math.ceil(Math.max(0,sourceBytes)*2.2));
  if(freeBytes<requiredBytes){
    throw new HttpError(
      'Espaço temporário insuficiente para analisar este vídeo. '+
      'Livre: '+Math.round(freeBytes/1024/1024)+' MB · necessário: '+
      Math.round(requiredBytes/1024/1024)+' MB.',
      507
    );
  }
  return {freeBytes,requiredBytes};
}


type AssetRow={
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
  payload:unknown;
};

type AnalysisRow={
  asset_id:string;
  status:'processing'|'completed'|'failed';
  provider:string;
  model:string;
  asset_title:string;
  duration_seconds:number|string|null;
  payload:unknown;
  error:string|null;
  analyzed_at:string|null;
  created_at:string;
  updated_at:string;
};

type SegmentRow={
  id:string;
  asset_id:string;
  sequence:number;
  start_seconds:number|string;
  end_seconds:number|string;
  duration_seconds:number|string;
  title:string;
  summary:string;
  semantic:unknown;
  confidence:number|string;
  quality_score:number|string;
  usable:boolean;
  quality_issues:string[]|null;
  search_text:string;
  keyframe_seconds:number|string;
  created_at:string;
  updated_at:string;
};

function list(value:unknown,limit=80){
  if(!Array.isArray(value))return [] as string[];
  return [...new Set(value.map(item=>String(item??'').trim().toLowerCase()).filter(Boolean))].slice(0,limit);
}

function visualSemantic(value:unknown):VisualSegmentSemantic{
  const item=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  return {
    subjects:list(item.subjects),locations:list(item.locations),landmarks:list(item.landmarks),
    activities:list(item.activities),objects:list(item.objects),environments:list(item.environments),
    timeOfDay:list(item.timeOfDay),weather:list(item.weather),shotTypes:list(item.shotTypes),
    cameraMotion:list(item.cameraMotion),moods:list(item.moods),visualStyle:list(item.visualStyle),
    periods:list(item.periods)
  };
}

function ownedSemantic(value:unknown):OwnedMediaAsset['semantic']{
  const item=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  return {
    subjects:list(item.subjects),locations:list(item.locations),periods:list(item.periods),
    countries:list(item.countries),regions:list(item.regions),cities:list(item.cities),
    districts:list(item.districts),landmarks:list(item.landmarks),scenes:list(item.scenes),
    objects:list(item.objects),activities:list(item.activities),people:list(item.people),
    timeOfDay:list(item.timeOfDay),weather:list(item.weather),seasons:list(item.seasons),
    shotTypes:list(item.shotTypes),cameraMotion:list(item.cameraMotion),moods:list(item.moods)
  };
}

function segment(row:SegmentRow):OwnedMediaVisualSegment{
  return {
    id:String(row.id),assetId:String(row.asset_id),sequence:Number(row.sequence),
    startSeconds:Number(row.start_seconds),endSeconds:Number(row.end_seconds),durationSeconds:Number(row.duration_seconds),
    title:String(row.title??''),summary:String(row.summary??''),semantic:visualSemantic(row.semantic),
    confidence:Math.max(0,Math.min(1,Number(row.confidence??0))),
    qualityScore:Math.max(0,Math.min(1,Number(row.quality_score??0.5))),
    usable:Boolean(row.usable),
    qualityIssues:list(row.quality_issues,20),
    searchText:String(row.search_text??''),
    keyframeSeconds:Number(row.keyframe_seconds??0),createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

async function ownedAsset(assetId:string):Promise<AssetRow>{
  const row=checked(await db().from('radar_owned_media_assets')
    .select('id,asset_kind,status,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,title,tags,semantic,search_text,payload')
    .eq('id',assetId).maybeSingle());
  if(!row)throw new HttpError('Asset OWNED não encontrado.',404);
  const item=row as AssetRow;
  if(item.status!=='ready'||!item.storage_path)throw new HttpError('A mídia precisa estar pronta na Biblioteca.',409);
  if(Number(item.bytes)>MAX_VIDEO_BYTES)throw new HttpError('Mídia acima do limite de análise de 2 GB.',413);
  return item;
}

function normalizeBoundaries(times:number[],duration:number){
  const clean=[0,...times.filter(value=>Number.isFinite(value)&&value>1&&value<duration-1),duration].sort((a,b)=>a-b);
  const unique:number[]=[];
  for(const value of clean)if(!unique.length||value-unique[unique.length-1]>=1)unique.push(value);
  if(unique[unique.length-1]!==duration)unique.push(duration);
  const expanded:number[]=[unique[0]??0];
  for(let i=1;i<unique.length;i++){
    const prev=expanded[expanded.length-1],next=unique[i],gap=next-prev;
    if(gap>10){
      const parts=Math.ceil(gap/8);
      for(let p=1;p<parts;p++)expanded.push(prev+gap*(p/parts));
    }
    expanded.push(next);
  }
  if(expanded.length-1>MAX_SEGMENTS){
    return Array.from({length:MAX_SEGMENTS+1},(_,i)=>duration*(i/MAX_SEGMENTS));
  }
  return expanded;
}

async function detectBoundaries(file:string,duration:number){
  try{
    const {stderr}=await execFile(FFMPEG,[
      '-hide_banner','-loglevel','info','-i',file,
      '-vf',"select='gt(scene,0.30)',showinfo",'-an','-f','null','-'
    ],{maxBuffer:12*1024*1024,timeout:180000});
    return normalizeBoundaries([...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match=>Number(match[1])),duration);
  }catch{
    return normalizeBoundaries([],duration);
  }
}

async function frame(file:string,target:string,time:number){
  await execFile(FFMPEG,[
    '-hide_banner','-loglevel','error','-ss',time.toFixed(3),'-i',file,
    '-frames:v','1','-vf',"scale='min(960,iw)':-2",'-q:v','4','-y',target
  ],{maxBuffer:2*1024*1024,timeout:90000});
  return readFile(target);
}

async function resolveVisionModel(key:string){
  const configured=(process.env.VISUAL_INTELLIGENCE_MODEL??'').trim();
  if(configured)return configured.startsWith('models/')?configured:'models/'+configured;
  try{
    const response=await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?key='+encodeURIComponent(key),
      {signal:AbortSignal.timeout(15000),cache:'no-store'}
    );
    if(response.ok){
      const body=await response.json() as {models?:Array<{name?:string;supportedGenerationMethods?:string[]}>};
      const names=(body.models??[])
        .filter(item=>(item.supportedGenerationMethods??[]).includes('generateContent'))
        .map(item=>String(item.name??''));
      for(const wanted of [
        'models/gemini-3.5-flash-lite','models/gemini-3.6-flash','models/gemini-3.8-flash',
        'models/gemini-3.5-flash','models/gemini-2.5-flash-lite','models/gemini-2.5-flash'
      ])if(names.includes(wanted))return wanted;
      const flash=names.find(name=>/gemini.*flash/i.test(name));
      if(flash)return flash;
    }
  }catch{}
  return 'models/gemini-2.5-flash';
}

const responseSchema={
  type:'OBJECT',
  properties:{segments:{type:'ARRAY',items:{type:'OBJECT',properties:{
    sequence:{type:'INTEGER'},title:{type:'STRING'},summary:{type:'STRING'},confidence:{type:'NUMBER'},
    qualityScore:{type:'NUMBER'},usable:{type:'BOOLEAN'},qualityIssues:{type:'ARRAY',items:{type:'STRING'}},
    subjects:{type:'ARRAY',items:{type:'STRING'}},locations:{type:'ARRAY',items:{type:'STRING'}},
    landmarks:{type:'ARRAY',items:{type:'STRING'}},activities:{type:'ARRAY',items:{type:'STRING'}},
    objects:{type:'ARRAY',items:{type:'STRING'}},environments:{type:'ARRAY',items:{type:'STRING'}},
    timeOfDay:{type:'ARRAY',items:{type:'STRING'}},weather:{type:'ARRAY',items:{type:'STRING'}},
    shotTypes:{type:'ARRAY',items:{type:'STRING'}},cameraMotion:{type:'ARRAY',items:{type:'STRING'}},
    moods:{type:'ARRAY',items:{type:'STRING'}},visualStyle:{type:'ARRAY',items:{type:'STRING'}},
    periods:{type:'ARRAY',items:{type:'STRING'}}
  },required:[
    'sequence','title','summary','confidence','qualityScore','usable','qualityIssues',
    'subjects','locations','landmarks','activities','objects',
    'environments','timeOfDay','weather','shotTypes','cameraMotion','moods','visualStyle','periods'
  ]}}},
  required:['segments']
};

async function analyzeFrames(input:{
  key:string;
  model:string;
  items:Array<{sequence:number;start:number;end:number;mid:number;bytes:Buffer}>;
  sourceHint:string;
}){
  const parts:Array<Record<string,unknown>>=[{text:[
    'You are the visual indexing engine for a private professional image and video library.',
    'Analyze only what is visually supported by each supplied keyframe.',
    'Do not infer an exact city, district or landmark unless the visual evidence is recognizable.',
    'The filename/source hint is context only and must never override what the frame shows: '+input.sourceHint,
    'Return concise searchable English metadata.',
    'For people, prefer useful production terms such as pedestrians, commuters, tourists, workers or crowd only when visible.',
    'For environments, use labels such as skyline, street, avenue, bridge, park, library, waterfront, traffic, restaurant, office, mountains or desert when supported.',
    'For shotTypes and cameraMotion describe the actual framing/viewpoint and apparent movement conservatively.',
    'Judge production usability from the supplied frame: sharpness, exposure, occlusion, compression, framing and whether the visual is genuinely useful as documentary B-roll.',
    'qualityScore is 0..1. usable=false only for material with a serious production defect or no meaningful visual content. qualityIssues must be concise labels such as blur, underexposed, overexposed, compression, obstruction, black-frame or weak-composition.',
    'Confidence is 0..1 for the overall visual description.'
  ].join('\n')}];
  for(const item of input.items){
    parts.push({text:`SEGMENT ${item.sequence} | ${item.start.toFixed(2)}s-${item.end.toFixed(2)}s | keyframe ${item.mid.toFixed(2)}s`});
    parts.push({inline_data:{mime_type:'image/jpeg',data:item.bytes.toString('base64')}});
  }
  let response:Response;
  try{
    response=await fetch('https://generativelanguage.googleapis.com/v1beta/'+input.model+':generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':input.key},
      body:JSON.stringify({
        contents:[{role:'user',parts}],
        generationConfig:{temperature:.1,responseMimeType:'application/json',responseSchema}
      }),
      signal:AbortSignal.timeout(90000),
      cache:'no-store'
    });
  }catch{
    throw new HttpError('A Google AI excedeu o tempo durante a análise visual.',504);
  }
  if(response.status===429)throw new HttpError('A Google AI atingiu quota ou limite durante a análise visual.',429);
  if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial para análise visual.',422);
  if(!response.ok){
    const detail=(await response.text().catch(()=>'')).replace(/\s+/g,' ').slice(0,500);
    throw new HttpError('A Google AI falhou durante a análise visual (HTTP '+response.status+')'+(detail?' · '+detail:''),502);
  }
  const body=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
  const text=(body.candidates?.[0]?.content?.parts??[]).map(item=>item.text??'').join('').trim();
  if(!text)throw new HttpError('A análise visual não devolveu metadados.',502);
  try{
    return JSON.parse(text) as {segments?:Array<Record<string,unknown>>};
  }catch{
    throw new HttpError('A análise visual devolveu JSON inválido.',502);
  }
}

function aggregateTitle(segments:Array<{title:string;semantic:VisualSegmentSemantic}>){
  const values=(selector:(item:(typeof segments)[number])=>string[])=>{
    const counts=new Map<string,number>();
    for(const item of segments)for(const value of selector(item))counts.set(value,(counts.get(value)??0)+1);
    return [...counts.entries()]
      .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
      .map(([value])=>value);
  };
  const locations=values(item=>[...item.semantic.landmarks,...item.semantic.locations]);
  const subjects=values(item=>[...item.semantic.activities,...item.semantic.subjects,...item.semantic.environments]);
  const time=values(item=>item.semantic.timeOfDay);
  const pieces=[locations[0],subjects[0],time[0]].filter(Boolean).slice(0,3);
  return pieces.length
    ?pieces.map(value=>value.replace(/\b\w/g,m=>m.toUpperCase())).join(' — ')
    :'Analyzed owned video';
}

function mergeUnique(...values:string[][]){
  return [...new Set(values.flat().map(value=>value.trim().toLowerCase()).filter(Boolean))].slice(0,80);
}

async function enrichOwnedAsset(
  source:AssetRow,
  segments:OwnedMediaVisualSegment[],
  metadata:Awaited<ReturnType<typeof probeVideoInput>>,
  assetTitle:string
){
  const credible=segments.filter(item=>item.usable&&item.confidence>=.60);
  const evidence=credible.length?credible:segments.filter(item=>item.usable).length
    ?segments.filter(item=>item.usable)
    :segments;
  const all=(selector:(item:OwnedMediaVisualSegment)=>string[])=>mergeUnique(...evidence.map(selector));
  const visualText=evidence.map(item=>item.searchText).join(' ');
  const taxonomy=classifyMediaTaxonomy(visualText);
  const previous=ownedSemantic(source.semantic);
  const payload=source.payload&&typeof source.payload==='object'?source.payload as Record<string,unknown>:{};
  const filenameIntelligence=payload.filenameIntelligence&&typeof payload.filenameIntelligence==='object'
    ?payload.filenameIntelligence as Record<string,unknown>
    :{};
  const filenameSemantic=ownedSemantic(filenameIntelligence.semantic);

  const visualLandmarks=mergeUnique(all(item=>item.semantic.landmarks),taxonomy.landmarks);
  const visualScenes=mergeUnique(all(item=>item.semantic.environments),taxonomy.scenes);
  const visualObjects=mergeUnique(all(item=>item.semantic.objects),taxonomy.objects);
  const visualActivities=mergeUnique(all(item=>item.semantic.activities),taxonomy.activities);
  const visualTime=mergeUnique(all(item=>item.semantic.timeOfDay),taxonomy.timeOfDay);
  const visualWeather=mergeUnique(all(item=>item.semantic.weather),taxonomy.weather);
  const visualShots=mergeUnique(all(item=>item.semantic.shotTypes),taxonomy.shotTypes);
  const visualMotion=mergeUnique(all(item=>item.semantic.cameraMotion),taxonomy.cameraMotion);
  const visualMoods=mergeUnique(all(item=>[
    ...item.semantic.moods,...item.semantic.visualStyle
  ]),taxonomy.moods);
  const geoContext=mergeUnique(
    previous.countries,previous.regions,previous.cities,previous.districts
  );

  const semantic:OwnedMediaAsset['semantic']={
    subjects:mergeUnique(all(item=>[
      ...item.semantic.subjects,...item.semantic.activities,...item.semantic.objects,...item.semantic.environments
    ]),taxonomy.scenes,taxonomy.objects),
    locations:mergeUnique(
      geoContext,
      all(item=>item.semantic.locations),
      visualLandmarks,
      taxonomy.locations
    ),
    periods:mergeUnique(
      all(item=>[...item.semantic.periods,...item.semantic.timeOfDay]),
      taxonomy.periods
    ),
    countries:mergeUnique(previous.countries,taxonomy.countries),
    regions:mergeUnique(previous.regions,taxonomy.regions),
    cities:mergeUnique(previous.cities,taxonomy.cities),
    districts:mergeUnique(previous.districts,taxonomy.districts),
    landmarks:visualLandmarks.length?visualLandmarks:previous.landmarks,
    scenes:visualScenes.length?visualScenes:previous.scenes,
    objects:visualObjects.length?visualObjects:previous.objects,
    activities:visualActivities.length?visualActivities:previous.activities,
    people:taxonomy.people.length?mergeUnique(taxonomy.people):previous.people,
    timeOfDay:visualTime.length?visualTime:previous.timeOfDay,
    weather:visualWeather.length?visualWeather:previous.weather,
    seasons:taxonomy.seasons.length?mergeUnique(taxonomy.seasons):previous.seasons,
    shotTypes:visualShots.length?visualShots:previous.shotTypes,
    cameraMotion:visualMotion.length?visualMotion:previous.cameraMotion,
    moods:visualMoods.length?visualMoods:previous.moods
  };

  const tags=normalizeMediaTags([
    ...semantic.countries,...semantic.regions,...semantic.cities,...semantic.districts,
    ...semantic.landmarks,...semantic.scenes,...semantic.objects,...semantic.activities,
    ...semantic.people,...semantic.timeOfDay,...semantic.weather,...semantic.shotTypes,
    ...semantic.cameraMotion,...semantic.moods
  ]).slice(0,50);

  const semanticTitle=assetTitle||source.title||source.original_name;
  const searchText=ownedMediaSearchText({
    title:semanticTitle,
    originalName:source.original_name,
    tags,
    semantic,
    includeOriginalName:false
  });

  const contested={
    landmarks:filenameSemantic.landmarks.filter(value=>!semantic.landmarks.includes(value)),
    scenes:filenameSemantic.scenes.filter(value=>!semantic.scenes.includes(value)),
    locations:filenameSemantic.locations.filter(value=>!semantic.locations.includes(value))
  };

  checked(await db().from('radar_owned_media_assets').update({
    width:metadata.width,
    height:metadata.height,
    duration_seconds:metadata.durationSeconds,
    title:semanticTitle,
    tags,
    semantic,
    search_text:searchText,
    payload:{
      ...payload,
      technical:{
        ...(payload.technical&&typeof payload.technical==='object'?payload.technical as Record<string,unknown>:{}),
        fps:metadata.fps,codec:metadata.codec,bitrate:metadata.bitrate,probedAt:new Date().toISOString()
      },
      visualAuthority:{
        mode:'visual-over-filename',
        confidenceFloor:.60,
        contestedFilename:contested,
        reconciledAt:new Date().toISOString()
      },
      visualIntelligence:{
        status:'completed',
        assetTitle:semanticTitle,
        segmentCount:segments.length,
        usableSegmentCount:segments.filter(item=>item.usable).length,
        meanQuality:segments.length
          ?Number((segments.reduce((sum,item)=>sum+item.qualityScore,0)/segments.length).toFixed(4))
          :0,
        analyzedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',source.id));
  return {semanticTitle,searchText};
}

async function refreshEmbeddingIndex(
  source:AssetRow,
  enriched:{semanticTitle:string;searchText:string},
  segments:OwnedMediaVisualSegment[]
){
  try{
    const result=await indexOwnedMediaEmbeddings({
      assetId:source.id,
      assetTitle:enriched.semanticTitle,
      assetText:enriched.searchText,
      segments:segments.map(item=>({id:item.id,title:item.title,searchText:item.searchText}))
    });
    return {status:'completed' as const,...result};
  }catch(error){
    return {
      status:'failed' as const,
      error:(error instanceof Error?error.message:'embedding-index-failed').slice(0,500)
    };
  }
}

export async function loadOwnedMediaIntelligence(assetId:string):Promise<OwnedMediaIntelligenceResult>{
  const analysis=checked(await db().from('radar_owned_media_visual_analysis')
    .select('asset_id,status,provider,model,asset_title,duration_seconds,payload,error,analyzed_at,created_at,updated_at')
    .eq('asset_id',assetId).maybeSingle()) as AnalysisRow|null;
  if(!analysis){
    return {assetId,status:'idle',provider:'googleai',model:'',assetTitle:'',durationSeconds:null,segments:[]};
  }
  const rows=checked(await db().from('radar_owned_media_segments')
    .select('id,asset_id,sequence,start_seconds,end_seconds,duration_seconds,title,summary,semantic,confidence,quality_score,usable,quality_issues,search_text,keyframe_seconds,created_at,updated_at')
    .eq('asset_id',assetId).order('sequence',{ascending:true})) as SegmentRow[];
  return {
    assetId,status:analysis.status,provider:'googleai',model:String(analysis.model??''),
    assetTitle:String(analysis.asset_title??''),
    durationSeconds:analysis.duration_seconds===null?null:Number(analysis.duration_seconds),
    analyzedAt:analysis.analyzed_at?String(analysis.analyzed_at):undefined,
    error:analysis.error?String(analysis.error):undefined,
    segments:(rows??[]).map(segment)
  };
}

export async function rebuildOwnedMediaVisualMetadata(assetId:string):Promise<OwnedMediaIntelligenceResult>{
  const source=await ownedAsset(assetId);
  const analysis=checked(await db().from('radar_owned_media_visual_analysis')
    .select('asset_id,status,provider,model,asset_title,duration_seconds,payload,error,analyzed_at,created_at,updated_at')
    .eq('asset_id',assetId).maybeSingle()) as AnalysisRow|null;
  if(!analysis||analysis.status!=='completed')throw new HttpError('O asset ainda não possui análise visual concluída.',409);

  const rows=checked(await db().from('radar_owned_media_segments')
    .select('id,asset_id,sequence,start_seconds,end_seconds,duration_seconds,title,summary,semantic,confidence,quality_score,usable,quality_issues,search_text,keyframe_seconds,created_at,updated_at')
    .eq('asset_id',assetId).order('sequence',{ascending:true})) as SegmentRow[];
  const segments=(rows??[]).map(segment);
  if(!segments.length)throw new HttpError('A análise visual não possui segmentos para reconciliar.',409);

  const payload=source.payload&&typeof source.payload==='object'?source.payload as Record<string,unknown>:{};
  const technical=payload.technical&&typeof payload.technical==='object'
    ?payload.technical as Record<string,unknown>
    :{};
  const numberOrNull=(value:unknown)=>{
    const parsed=Number(value);
    return Number.isFinite(parsed)&&parsed>0?parsed:null;
  };
  const metadata:Awaited<ReturnType<typeof probeVideoInput>>={
    durationSeconds:numberOrNull(source.duration_seconds)??numberOrNull(analysis.duration_seconds),
    width:numberOrNull(source.width),
    height:numberOrNull(source.height),
    fps:numberOrNull(technical.fps),
    codec:String(technical.codec??'').trim()||null,
    bitrate:numberOrNull(technical.bitrate)
  };
  const assetTitle=String(analysis.asset_title??'').trim()||aggregateTitle(
    segments.map(item=>({title:item.title,semantic:item.semantic}))
  );
  const enriched=await enrichOwnedAsset(source,segments,metadata,assetTitle);
  const embedding=await refreshEmbeddingIndex(source,enriched,segments);
  const analysisPayload=analysis.payload&&typeof analysis.payload==='object'
    ?analysis.payload as Record<string,unknown>
    :{};
  const meanQuality=segments.length
    ?Number((segments.reduce((sum,item)=>sum+item.qualityScore,0)/segments.length).toFixed(4))
    :0;
  checked(await db().from('radar_owned_media_visual_analysis').update({
    payload:{
      ...analysisPayload,
      stage:'completed',
      segmentCount:segments.length,
      usableSegmentCount:segments.filter(item=>item.usable).length,
      meanQuality,
      embedding
    },
    updated_at:new Date().toISOString()
  }).eq('asset_id',assetId));
  return loadOwnedMediaIntelligence(assetId);
}

export async function analyzeOwnedMediaAsset(assetId:string):Promise<OwnedMediaIntelligenceResult>{
  const source=await ownedAsset(assetId);
  const now=new Date().toISOString();
  checked(await db().from('radar_owned_media_visual_analysis').upsert({
    asset_id:source.id,status:'processing',provider:'googleai',model:'',asset_title:'',
    duration_seconds:source.duration_seconds,payload:{stage:'starting',assetKind:source.asset_kind},error:null,updated_at:now
  },{onConflict:'asset_id'}));
  let root:string|null=null;
  try{
    const disk=await ensureAnalysisDisk(
      Number(source.bytes),
      source.asset_kind==='image'?256*1024*1024:2*GIB
    );
    root=await mkdtemp(path.join(os.tmpdir(),'cacadores-owned-vision-'));
    const fallbackExtension=source.asset_kind==='image'?'.jpg':'.mp4';
    const inputFile=path.join(root,'input'+(path.extname(source.original_name)||fallbackExtension));
    checked(await db().from('radar_owned_media_visual_analysis').update({
      payload:{
        stage:'downloading',assetKind:source.asset_kind,
        bytes:Number(source.bytes),
        freeBytesBeforeDownload:disk.freeBytes,
        requiredBytes:disk.requiredBytes
      },
      updated_at:new Date().toISOString()
    }).eq('asset_id',source.id));
    await downloadMediaToFile(source.storage_path,inputFile);

    const probed=await probeVideoInput(inputFile);
    const metadata={
      ...probed,
      durationSeconds:source.asset_kind==='image'?null:probed.durationSeconds
    };
    if(source.asset_kind==='video'&&!metadata.durationSeconds){
      throw new HttpError('Não foi possível determinar a duração do vídeo.',422);
    }

    const normalizedSpecs=source.asset_kind==='image'
      ?[{sequence:1,start:0,end:1,mid:0}]
      :await (async()=>{
        const boundaries=await detectBoundaries(inputFile,metadata.durationSeconds!);
        return boundaries.slice(0,-1)
          .map((start,index)=>{
            const end=boundaries[index+1];
            return {sequence:index+1,start,end,mid:start+(end-start)/2};
          })
          .filter(item=>item.end-item.start>=.35);
      })();
    if(!normalizedSpecs.length)throw new HttpError('Nenhum segmento visual utilizável foi detectado.',422);

    const key=await providerSecret('googleai');
    const model=await resolveVisionModel(key);
    checked(await db().from('radar_owned_media_visual_analysis').update({
      model,
      duration_seconds:metadata.durationSeconds,
      payload:{
        stage:'extracting',assetKind:source.asset_kind,segmentCount:normalizedSpecs.length,
        width:metadata.width,height:metadata.height,fps:metadata.fps,codec:metadata.codec
      },
      updated_at:new Date().toISOString()
    }).eq('asset_id',source.id));

    const analyzed:Array<{
      sequence:number;start:number;end:number;mid:number;title:string;summary:string;
      confidence:number;qualityScore:number;usable:boolean;qualityIssues:string[];
      semantic:VisualSegmentSemantic;
    }>=[];
    for(let offset=0;offset<normalizedSpecs.length;offset+=MAX_BATCH){
      const batch=normalizedSpecs.slice(offset,offset+MAX_BATCH);
      const frames:Array<{sequence:number;start:number;end:number;mid:number;bytes:Buffer}>=[];
      for(const spec of batch){
        const target=path.join(root,'frame-'+String(spec.sequence).padStart(3,'0')+'.jpg');
        frames.push({...spec,bytes:await frame(inputFile,target,spec.mid)});
      }
      const result=await analyzeFrames({
        key,model,items:frames,sourceHint:source.title||source.original_name
      });
      const map=new Map((result.segments??[]).map(item=>[Number(item.sequence),item]));
      for(const spec of batch){
        const item=map.get(spec.sequence)??{};
        const confidence=Math.max(0,Math.min(1,Number(item.confidence??0)));
        const rawQuality=Math.max(0,Math.min(1,Number(item.qualityScore??confidence??.5)));
        const minDimension=Math.min(Number(metadata.width??0),Number(metadata.height??0));
        const lowResolution=Boolean(minDimension&&minDimension<480);
        const qualityScore=Math.max(0,Math.min(1,rawQuality-(lowResolution?.12:0)));
        const qualityIssues=mergeUnique(
          list(item.qualityIssues,20),
          lowResolution?['low-resolution']:[]
        );
        analyzed.push({
          ...spec,
          title:String(item.title??'Visual segment '+spec.sequence).trim().slice(0,220),
          summary:String(item.summary??'').trim().slice(0,1200),
          confidence,
          qualityScore,
          usable:item.usable!==false&&qualityScore>=.25&&confidence>=.25,
          qualityIssues,
          semantic:visualSemantic(item)
        });
      }
      checked(await db().from('radar_owned_media_visual_analysis').update({
        payload:{
          stage:'analyzing',assetKind:source.asset_kind,segmentCount:normalizedSpecs.length,
          completedSegments:Math.min(offset+batch.length,normalizedSpecs.length),
          width:metadata.width,height:metadata.height
        },
        updated_at:new Date().toISOString()
      }).eq('asset_id',source.id));
    }

    checked(await db().from('radar_owned_media_segments').delete().eq('asset_id',source.id));
    const rows=analyzed.map(item=>({
      id:crypto.randomUUID(),asset_id:source.id,sequence:item.sequence,
      start_seconds:item.start,end_seconds:item.end,duration_seconds:item.end-item.start,
      title:item.title,summary:item.summary,semantic:item.semantic,confidence:item.confidence,
      quality_score:item.qualityScore,usable:item.usable,quality_issues:item.qualityIssues,
      search_text:visualSegmentSearchText({title:item.title,summary:item.summary,semantic:item.semantic}),
      keyframe_seconds:item.mid
    }));
    checked(await db().from('radar_owned_media_segments').insert(rows));
    const createdAt=new Date().toISOString();
    const segments=rows.map(row=>segment({...row,created_at:createdAt,updated_at:createdAt} as SegmentRow));
    const assetTitle=aggregateTitle(analyzed);
    const enriched=await enrichOwnedAsset(source,segments,metadata,assetTitle);
    const embedding=await refreshEmbeddingIndex(source,enriched,segments);
    const meanQuality=segments.length
      ?Number((segments.reduce((sum,item)=>sum+item.qualityScore,0)/segments.length).toFixed(4))
      :0;

    checked(await db().from('radar_owned_media_visual_analysis').update({
      status:'completed',model,asset_title:assetTitle,duration_seconds:metadata.durationSeconds,
      payload:{
        stage:'completed',assetKind:source.asset_kind,segmentCount:segments.length,
        usableSegmentCount:segments.filter(item=>item.usable).length,meanQuality,
        width:metadata.width,height:metadata.height,
        fps:metadata.fps,codec:metadata.codec,bitrate:metadata.bitrate,
        embedding
      },
      error:null,analyzed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('asset_id',source.id));
    return loadOwnedMediaIntelligence(source.id);
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida na análise visual.';
    await db().from('radar_owned_media_visual_analysis').update({
      status:'failed',error:message.slice(0,1000),payload:{stage:'failed',assetKind:source.asset_kind},updated_at:new Date().toISOString()
    }).eq('asset_id',source.id);
    const payload=source.payload&&typeof source.payload==='object'?source.payload as Record<string,unknown>:{};
    await db().from('radar_owned_media_assets').update({
      payload:{...payload,visualIntelligence:{status:'failed',error:message.slice(0,500)}},
      updated_at:new Date().toISOString()
    }).eq('id',source.id);
    throw error;
  }finally{
    if(root)await rm(root,{recursive:true,force:true}).catch(()=>{});
  }
}

function assetMatchesFilters(
  semantic:OwnedMediaAsset['semantic'],
  filters:{country?:string;city?:string;scene?:string;timeOfDay?:string}
){
  const has=(values:string[],value?:string)=>!value||values.includes(value.trim().toLowerCase());
  return has(semantic.countries,filters.country)&&has(semantic.cities,filters.city)&&
    has(semantic.scenes,filters.scene)&&has(semantic.timeOfDay,filters.timeOfDay);
}

export async function matchOwnedMediaSegments(input:{
  query:string;
  desiredDurationSeconds:number;
  limit?:number;
  country?:string;
  city?:string;
  scene?:string;
  timeOfDay?:string;
  orientation?:'landscape'|'portrait'|'any';
}){
  const query=input.query.trim();
  if(query.length<3)throw new HttpError('Informe uma intenção visual mais específica.',400);
  const analysisRows=await db().from('radar_owned_media_visual_analysis')
    .select('asset_id')
    .eq('status','completed')
    .limit(5000);
  if(analysisRows.error)throw new HttpError('Falha ao consultar o índice visual.',502);
  const ids=(analysisRows.data??[]).map(row=>String(row.asset_id));
  if(!ids.length)return [];

  const semanticMatches=await searchOwnedMediaEmbeddings(query,120).catch(()=>[]);
  const semanticScores=new Map(
    semanticMatches.map(item=>[item.resourceId,item.similarity])
  );

  const assetRows=await db().from('radar_owned_media_assets')
    .select('id,asset_kind,title,original_name,width,height,duration_seconds,search_text,semantic,storage_path')
    .in('id',ids)
    .eq('status','ready')
    .limit(5000);
  if(assetRows.error)throw new HttpError('Falha ao consultar os assets OWNED.',502);
  const assets=new Map((assetRows.data??[]).map(row=>[String(row.id),row]));

  const segmentRows=await db().from('radar_owned_media_segments')
    .select('id,asset_id,sequence,start_seconds,end_seconds,duration_seconds,title,summary,semantic,confidence,quality_score,usable,quality_issues,search_text,keyframe_seconds,created_at,updated_at')
    .in('asset_id',ids)
    .limit(10000);
  if(segmentRows.error)throw new HttpError('Falha ao consultar os segmentos visuais.',502);

  const targetOrientation=input.orientation??'landscape';
  const requestedTaxonomy=classifyMediaTaxonomy(query);
  const requestedLandmarks=requestedTaxonomy.landmarks;
  const ranked=(segmentRows.data??[]).flatMap(row=>{
    const asset=assets.get(String(row.asset_id));
    if(!asset)return [];
    const semantic=ownedSemantic(asset.semantic);
    if(!assetMatchesFilters(semantic,input))return [];

    const width=asset.width===null?null:Number(asset.width);
    const height=asset.height===null?null:Number(asset.height);
    if(targetOrientation!=='any'&&width&&height){
      const landscape=width>=height;
      if(targetOrientation==='landscape'&&!landscape)return [];
      if(targetOrientation==='portrait'&&landscape)return [];
    }

    const item=segment(row as SegmentRow);
    if(!item.usable)return [];
    if(requestedLandmarks.length){
      const observedLandmarks=mergeUnique(item.semantic.landmarks,semantic.landmarks);
      if(!requestedLandmarks.every(landmark=>observedLandmarks.includes(landmark)))return [];
    }

    const visualText=visualSemanticSearchText(item.semantic);
    const contextText=[
      ...semantic.countries,...semantic.regions,...semantic.cities,...semantic.districts
    ].join(' ');
    const intent=scoreVisualIntent(query,visualText,contextText);
    const semanticSimilarity=semanticScores.get(item.id)??0;
    const semanticStrong=semanticSimilarity>=.58;
    const locationOnlyEvidence=
      item.semantic.locations.length>0||
      item.semantic.landmarks.length>0||
      item.semantic.environments.length>0;

    if(intent.hasVisualIntent&&!semanticStrong){
      const minimumCoverage=intent.intentTokenCount>=3?.40:intent.intentTokenCount===2?.50:1;
      if(intent.visualRelevance<.22||intent.visualCoverage<minimumCoverage)return [];
    }
    if(!intent.hasVisualIntent&&!locationOnlyEvidence&&!semanticStrong)return [];

    const desired=Math.max(.25,input.desiredDurationSeconds);
    const assetKind=String(asset.asset_kind)==='image'?'image':'video';
    const durationFit=assetKind==='image'?1:Math.min(1,item.durationSeconds/desired);
    const resolutionBonus=Number(width??0)>=3840 ? .04 : Number(width??0)>=1920 ? .02 : 0;
    const visualRelevance=intent.hasVisualIntent?intent.visualRelevance:.30;
    const lexicalRelevance=Math.min(1,visualRelevance*.82+intent.contextRelevance*.18);
    const relevance=semanticSimilarity>0
      ?Math.min(1,semanticSimilarity*.65+lexicalRelevance*.35)
      :lexicalRelevance;
    const score=semanticSimilarity>0
      ?Math.min(
        1,
        semanticSimilarity*.50+
        visualRelevance*.20+
        intent.contextRelevance*.08+
        item.qualityScore*.10+
        item.confidence*.05+
        durationFit*.05+
        resolutionBonus
      )
      :Math.min(
        1,
        visualRelevance*.57+
        intent.contextRelevance*.15+
        item.qualityScore*.10+
        item.confidence*.08+
        durationFit*.06+
        resolutionBonus
      );
    const sourceStart=assetKind==='image'?0:item.startSeconds;
    const sourceEnd=assetKind==='image'?1:Math.min(item.endSeconds,sourceStart+desired);
    return [{
      assetId:String(asset.id),
      assetKind,
      title:String(asset.title??asset.original_name),
      originalName:String(asset.original_name??''),
      width,
      height,
      assetDurationSeconds:asset.duration_seconds===null?null:Number(asset.duration_seconds),
      segment:item,
      relevance,
      semanticSimilarity,
      visualRelevance,
      visualCoverage:intent.visualCoverage,
      matchedIntentTokens:intent.matchedIntentTokens,
      intentTokenCount:intent.intentTokenCount,
      contextRelevance:intent.contextRelevance,
      durationFit,
      qualityScore:item.qualityScore,
      requestedLandmarks,
      score,
      sourceStartSeconds:sourceStart,
      sourceEndSeconds:sourceEnd
    }];
  }).sort((a,b)=>b.score-a.score);

  const limit=Math.max(1,Math.min(Number(input.limit??5)||5,20));
  return ranked.slice(0,limit);
}

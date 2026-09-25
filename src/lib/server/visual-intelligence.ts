import 'server-only';

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VisualAssetSegment, VisualIntelligenceResult, VisualSegmentSemantic } from '@/lib/types';
import { HttpError } from './auth';
import { checked, db } from './db';
import { downloadMedia } from './media-storage';
import { providerSecret } from './providers';
import { normalizeMediaSemantic, normalizeMediaTags, scoreExactVisualSegment, scoreVisualSegment, visualSegmentSearchText } from '@/lib/media-library-policy';\nimport type { ExactVisualMatchIntent } from '@/lib/media-library-policy';

const execFile=promisify(execFileCallback);
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';
const FFPROBE=process.env.FFPROBE_PATH||'ffprobe';
const MAX_SEGMENTS=24;
const MAX_BATCH=6;
const MAX_VIDEO_BYTES=750*1024*1024;

type AssetRow={id:string;channel_id:string;asset_kind:string;status:string;storage_path:string;mime_type:string;bytes:number;duration_seconds:number|null;original_name:string|null;};
type AnalysisRow={asset_id:string;channel_id:string;status:'processing'|'completed'|'failed';provider:string;model:string;asset_title:string;duration_seconds:number|null;payload:unknown;error:string|null;analyzed_at:string|null;created_at:string;updated_at:string;};
type SegmentRow={id:string;channel_id:string;asset_id:string;sequence:number;start_seconds:number;end_seconds:number;duration_seconds:number;title:string;summary:string;semantic:unknown;confidence:number;search_text:string;keyframe_seconds:number;created_at:string;updated_at:string;};

function normalizeList(value:unknown,limit=20){
  if(!Array.isArray(value))return [] as string[];
  return [...new Set(value.map(item=>String(item??'').trim().toLowerCase()).filter(Boolean))].slice(0,limit);
}
function normalizeSemantic(value:unknown):VisualSegmentSemantic{
  const item=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  return {
    subjects:normalizeList(item.subjects),locations:normalizeList(item.locations),landmarks:normalizeList(item.landmarks),
    activities:normalizeList(item.activities),objects:normalizeList(item.objects),environments:normalizeList(item.environments),
    timeOfDay:normalizeList(item.timeOfDay),weather:normalizeList(item.weather),shotTypes:normalizeList(item.shotTypes),
    cameraMotion:normalizeList(item.cameraMotion),moods:normalizeList(item.moods),visualStyle:normalizeList(item.visualStyle),
    periods:normalizeList(item.periods)
  };
}
function normalizeSegment(row:SegmentRow):VisualAssetSegment{
  return {
    id:String(row.id),channelId:String(row.channel_id),assetId:String(row.asset_id),sequence:Number(row.sequence),
    startSeconds:Number(row.start_seconds),endSeconds:Number(row.end_seconds),durationSeconds:Number(row.duration_seconds),
    title:String(row.title??''),summary:String(row.summary??''),semantic:normalizeSemantic(row.semantic),
    confidence:Math.max(0,Math.min(1,Number(row.confidence??0))),searchText:String(row.search_text??''),
    keyframeSeconds:Number(row.keyframe_seconds??0),createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

async function asset(assetId:string):Promise<AssetRow>{
  const row=checked(await db().from('radar_scene_assets')
    .select('id,channel_id,asset_kind,status,storage_path,mime_type,bytes,duration_seconds,original_name')
    .eq('id',assetId).maybeSingle());
  if(!row)throw new HttpError('Asset não encontrado.',404);
  const item=row as AssetRow;
  if(item.asset_kind!=='video')throw new HttpError('Visual Intelligence analisa vídeos. Selecione um asset de vídeo.',409);
  if(item.status!=='ready'||!item.storage_path)throw new HttpError('O vídeo precisa estar pronto no Asset Vault.',409);
  if(Number(item.bytes)>MAX_VIDEO_BYTES)throw new HttpError('Vídeo muito grande para análise interativa. Limite atual: 750 MB.',413);
  return item;
}

async function probe(file:string){
  const {stdout}=await execFile(FFPROBE,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration:format=duration','-of','json',file],{maxBuffer:2*1024*1024});
  const data=JSON.parse(stdout) as {streams?:Array<{width?:number;height?:number;duration?:string}>;format?:{duration?:string}};
  const stream=data.streams?.[0]??{};
  const duration=Number(stream.duration??data.format?.duration??0);
  if(!Number.isFinite(duration)||duration<=0)throw new HttpError('Não foi possível determinar a duração do vídeo.',422);
  return {duration,width:Number(stream.width)||null,height:Number(stream.height)||null};
}
function normalizeBoundaries(times:number[],duration:number){
  const clean=[0,...times.filter(value=>Number.isFinite(value)&&value>1&&value<duration-1),duration].sort((a,b)=>a-b);
  const unique:number[]=[];
  for(const value of clean)if(!unique.length||value-unique[unique.length-1]>=1)unique.push(value);
  if(unique[unique.length-1]!==duration)unique.push(duration);
  const expanded:number[]=[unique[0]??0];
  for(let i=1;i<unique.length;i++){
    const prev=expanded[expanded.length-1],next=unique[i],gap=next-prev;
    if(gap>10){const parts=Math.ceil(gap/8);for(let p=1;p<parts;p++)expanded.push(prev+gap*(p/parts));}
    expanded.push(next);
  }
  if(expanded.length-1>MAX_SEGMENTS)return Array.from({length:MAX_SEGMENTS+1},(_,i)=>duration*(i/MAX_SEGMENTS));
  return expanded;
}
async function detectBoundaries(file:string,duration:number){
  try{
    const {stderr}=await execFile(FFMPEG,['-hide_banner','-loglevel','info','-i',file,'-vf',"select='gt(scene,0.30)',showinfo",'-an','-f','null','-'],{maxBuffer:12*1024*1024});
    return normalizeBoundaries([...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match=>Number(match[1])),duration);
  }catch{return normalizeBoundaries([],duration);}
}
async function frame(file:string,target:string,time:number){
  await execFile(FFMPEG,['-hide_banner','-loglevel','error','-ss',time.toFixed(3),'-i',file,'-frames:v','1','-vf',"scale='min(960,iw)':-2",'-q:v','4','-y',target],{maxBuffer:2*1024*1024});
  return readFile(target);
}

async function resolveVisionModel(key:string){
  const configured=(process.env.VISUAL_INTELLIGENCE_MODEL??'').trim();
  if(configured)return configured.startsWith('models/')?configured:'models/'+configured;
  try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(response.ok){
      const body=await response.json() as {models?:Array<{name?:string;supportedGenerationMethods?:string[]}>};
      const names=(body.models??[]).filter(item=>(item.supportedGenerationMethods??[]).includes('generateContent')).map(item=>String(item.name??''));
      for(const wanted of [
        'models/gemini-3.5-flash-lite',
        'models/gemini-3.6-flash',
        'models/gemini-3.8-flash',
        'models/gemini-3.5-flash',
        'models/gemini-2.5-flash-lite',
        'models/gemini-2.5-flash'
      ])if(names.includes(wanted))return wanted;
      const flash=names.find(name=>/gemini.*flash/i.test(name));if(flash)return flash;
    }
  }catch{}
  return 'models/gemini-2.5-flash';
}

const responseSchema={
  type:'OBJECT',
  properties:{segments:{type:'ARRAY',items:{type:'OBJECT',properties:{
    sequence:{type:'INTEGER'},title:{type:'STRING'},summary:{type:'STRING'},confidence:{type:'NUMBER'},
    subjects:{type:'ARRAY',items:{type:'STRING'}},locations:{type:'ARRAY',items:{type:'STRING'}},landmarks:{type:'ARRAY',items:{type:'STRING'}},
    activities:{type:'ARRAY',items:{type:'STRING'}},objects:{type:'ARRAY',items:{type:'STRING'}},environments:{type:'ARRAY',items:{type:'STRING'}},
    timeOfDay:{type:'ARRAY',items:{type:'STRING'}},weather:{type:'ARRAY',items:{type:'STRING'}},shotTypes:{type:'ARRAY',items:{type:'STRING'}},
    cameraMotion:{type:'ARRAY',items:{type:'STRING'}},moods:{type:'ARRAY',items:{type:'STRING'}},visualStyle:{type:'ARRAY',items:{type:'STRING'}},
    periods:{type:'ARRAY',items:{type:'STRING'}}
  },required:['sequence','title','summary','confidence','subjects','locations','landmarks','activities','objects','environments','timeOfDay','weather','shotTypes','cameraMotion','moods','visualStyle','periods']}}},
  required:['segments']
};

async function analyzeFrames(input:{key:string;model:string;items:Array<{sequence:number;start:number;end:number;mid:number;bytes:Buffer}>;}){
  const parts:Array<Record<string,unknown>>=[{text:[
    'You are the visual indexing engine for a private video asset library.',
    'Analyze only what is visually supported by each supplied keyframe. Do not infer exact landmarks unless recognizable.',
    'Return concise searchable English metadata. Location and landmark claims must be conservative.',
    'Use useful production labels for activities, objects, environment, time of day, shot type, camera motion, mood and period.',
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
      body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:.1,responseMimeType:'application/json',responseSchema}}),
      signal:AbortSignal.timeout(90000),cache:'no-store'
    });
  }catch{throw new HttpError('A Google AI excedeu o tempo durante a análise visual.',504);}
  if(response.status===429)throw new HttpError('A Google AI atingiu quota ou limite durante a análise visual.',429);
  if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a credencial para análise visual.',422);
  if(!response.ok){
    const detail=(await response.text().catch(()=>'')).replace(/\s+/g,' ').slice(0,500);
    throw new HttpError('A Google AI falhou durante a análise visual (HTTP '+response.status+')'+(detail?' · '+detail:''),502);
  }
  const body=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
  const text=(body.candidates?.[0]?.content?.parts??[]).map(item=>item.text??'').join('').trim();
  if(!text)throw new HttpError('A análise visual não devolveu metadados.',502);
  try{return JSON.parse(text) as {segments?:Array<Record<string,unknown>>};}catch{throw new HttpError('A análise visual devolveu JSON inválido.',502);}
}

function aggregateTitle(segments:Array<{title:string;semantic:VisualSegmentSemantic}>){
  const values=(selector:(item:(typeof segments)[number])=>string[])=>{
    const counts=new Map<string,number>();for(const item of segments)for(const value of selector(item))counts.set(value,(counts.get(value)??0)+1);
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([value])=>value);
  };
  const locations=values(item=>[...item.semantic.landmarks,...item.semantic.locations]);
  const subjects=values(item=>[...item.semantic.activities,...item.semantic.subjects,...item.semantic.environments]);
  const time=values(item=>item.semantic.timeOfDay);
  const pieces=[locations[0],subjects[0],time[0]].filter(Boolean).slice(0,3);
  return pieces.length?pieces.map(value=>value.replace(/\b\w/g,m=>m.toUpperCase())).join(' — '):'Analyzed video asset';
}

async function syncAssetMetadata(assetRow:AssetRow,segments:VisualAssetSegment[],assetTitle:string){
  const existing=checked(await db().from('radar_media_library_metadata').select('favorite,tags,notes,semantic')
    .eq('resource_type','scene_asset').eq('resource_id',assetRow.id).maybeSingle());
  const all=(selector:(item:VisualAssetSegment)=>string[])=>normalizeMediaTags(segments.flatMap(selector));
  const tags=normalizeMediaTags([...(existing?.tags??[]),
    ...all(item=>item.semantic.landmarks),...all(item=>item.semantic.activities),...all(item=>item.semantic.objects),
    ...all(item=>item.semantic.environments),...all(item=>item.semantic.timeOfDay),...all(item=>item.semantic.weather),
    ...all(item=>item.semantic.cameraMotion),...all(item=>item.semantic.visualStyle)
  ]);
  const previous=normalizeMediaSemantic(existing?.semantic as never);
  const semantic=normalizeMediaSemantic({
    subjects:[...previous.subjects,...all(item=>item.semantic.subjects),...all(item=>item.semantic.activities),...all(item=>item.semantic.objects)],
    locations:[...previous.locations,...all(item=>item.semantic.locations),...all(item=>item.semantic.landmarks)],
    periods:[...previous.periods,...all(item=>item.semantic.periods),...all(item=>item.semantic.timeOfDay)],
    shotTypes:[...previous.shotTypes,...all(item=>item.semantic.shotTypes),...all(item=>item.semantic.cameraMotion)],
    moods:[...previous.moods,...all(item=>item.semantic.moods),...all(item=>item.semantic.visualStyle)]
  });
  checked(await db().from('radar_media_library_metadata').upsert({
    media_key:'scene_asset:'+assetRow.id,channel_id:assetRow.channel_id,resource_type:'scene_asset',resource_id:assetRow.id,
    favorite:Boolean(existing?.favorite),tags,notes:String(existing?.notes??''),semantic,updated_at:new Date().toISOString()
  },{onConflict:'media_key'}));
  checked(await db().from('radar_asset_visual_analysis').update({asset_title:assetTitle,updated_at:new Date().toISOString()}).eq('asset_id',assetRow.id));
}

export async function loadVisualIntelligence(assetId:string):Promise<VisualIntelligenceResult>{
  const analysis=checked(await db().from('radar_asset_visual_analysis')
    .select('asset_id,channel_id,status,provider,model,asset_title,duration_seconds,payload,error,analyzed_at,created_at,updated_at')
    .eq('asset_id',assetId).maybeSingle()) as AnalysisRow|null;
  if(!analysis)return {assetId,status:'idle',provider:'googleai',model:'',assetTitle:'',durationSeconds:null,segments:[]};
  const rows=checked(await db().from('radar_asset_segments')
    .select('id,channel_id,asset_id,sequence,start_seconds,end_seconds,duration_seconds,title,summary,semantic,confidence,search_text,keyframe_seconds,created_at,updated_at')
    .eq('asset_id',assetId).order('sequence',{ascending:true})) as SegmentRow[];
  return {assetId,status:analysis.status,provider:'googleai',model:String(analysis.model??''),assetTitle:String(analysis.asset_title??''),
    durationSeconds:analysis.duration_seconds===null?null:Number(analysis.duration_seconds),analyzedAt:analysis.analyzed_at?String(analysis.analyzed_at):undefined,
    error:analysis.error?String(analysis.error):undefined,segments:(rows??[]).map(normalizeSegment)};
}

export async function analyzeVisualAsset(assetId:string):Promise<VisualIntelligenceResult>{
  const source=await asset(assetId),now=new Date().toISOString();
  checked(await db().from('radar_asset_visual_analysis').upsert({
    asset_id:source.id,channel_id:source.channel_id,status:'processing',provider:'googleai',model:'',asset_title:'',
    duration_seconds:source.duration_seconds,payload:{stage:'starting'},error:null,updated_at:now
  },{onConflict:'asset_id'}));
  const root=await mkdtemp(path.join(os.tmpdir(),'cacadores-vision-'));
  try{
    const inputFile=path.join(root,'input'+(path.extname(source.original_name??'')||'.mp4'));
    await writeFile(inputFile,await downloadMedia(source.storage_path));
    const metadata=await probe(inputFile),boundaries=await detectBoundaries(inputFile,metadata.duration);
    const specs=boundaries.slice(0,-1).map((start,index)=>{const end=boundaries[index+1];return {sequence:index+1,start,end,mid:start+(end-start)/2};})
      .filter(item=>item.end-item.start>=.35);
    if(!specs.length)throw new HttpError('Nenhum segmento visual utilizável foi detectado.',422);
    const key=await providerSecret('googleai'),model=await resolveVisionModel(key);
    checked(await db().from('radar_asset_visual_analysis').update({
      model,duration_seconds:metadata.duration,payload:{stage:'extracting',segmentCount:specs.length,width:metadata.width,height:metadata.height},updated_at:new Date().toISOString()
    }).eq('asset_id',source.id));

    const analyzed:Array<{sequence:number;start:number;end:number;mid:number;title:string;summary:string;confidence:number;semantic:VisualSegmentSemantic}>=[];
    for(let offset=0;offset<specs.length;offset+=MAX_BATCH){
      const batch=specs.slice(offset,offset+MAX_BATCH),frames=[] as Array<{sequence:number;start:number;end:number;mid:number;bytes:Buffer}>;
      for(const spec of batch){const target=path.join(root,'frame-'+String(spec.sequence).padStart(3,'0')+'.jpg');frames.push({...spec,bytes:await frame(inputFile,target,spec.mid)});}
      const result=await analyzeFrames({key,model,items:frames}),map=new Map((result.segments??[]).map(item=>[Number(item.sequence),item]));
      for(const spec of batch){
        const item=map.get(spec.sequence)??{},semantic=normalizeSemantic(item);
        analyzed.push({...spec,title:String(item.title??'Visual segment '+spec.sequence).trim().slice(0,220),
          summary:String(item.summary??'').trim().slice(0,1200),confidence:Math.max(0,Math.min(1,Number(item.confidence??0))),semantic});
      }
      checked(await db().from('radar_asset_visual_analysis').update({
        payload:{stage:'analyzing',segmentCount:specs.length,completedSegments:Math.min(offset+batch.length,specs.length),width:metadata.width,height:metadata.height},
        updated_at:new Date().toISOString()
      }).eq('asset_id',source.id));
    }
    checked(await db().from('radar_asset_segments').delete().eq('asset_id',source.id));
    const rows=analyzed.map(item=>({id:crypto.randomUUID(),channel_id:source.channel_id,asset_id:source.id,sequence:item.sequence,
      start_seconds:item.start,end_seconds:item.end,duration_seconds:item.end-item.start,title:item.title,summary:item.summary,
      semantic:item.semantic,confidence:item.confidence,search_text:visualSegmentSearchText({title:item.title,summary:item.summary,semantic:item.semantic}),keyframe_seconds:item.mid}));
    checked(await db().from('radar_asset_segments').insert(rows));
    const segments=rows.map(row=>normalizeSegment({...row,created_at:now,updated_at:now} as SegmentRow)),assetTitle=aggregateTitle(analyzed);
    await syncAssetMetadata(source,segments,assetTitle);
    checked(await db().from('radar_scene_assets').update({duration_seconds:metadata.duration,width:metadata.width,height:metadata.height,updated_at:new Date().toISOString()}).eq('id',source.id));
    checked(await db().from('radar_asset_visual_analysis').update({
      status:'completed',model,asset_title:assetTitle,duration_seconds:metadata.duration,payload:{stage:'completed',segmentCount:segments.length,width:metadata.width,height:metadata.height},
      error:null,analyzed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq('asset_id',source.id));
    return loadVisualIntelligence(source.id);
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida na análise visual.';
    await db().from('radar_asset_visual_analysis').update({status:'failed',error:message.slice(0,1000),payload:{stage:'failed'},updated_at:new Date().toISOString()}).eq('asset_id',source.id);
    throw error;
  }finally{await rm(root,{recursive:true,force:true}).catch(()=>{});}
}

export async function bestVisualSegment(input:{
  assetId:string;
  query:string;
  desiredDurationSeconds:number;
  exactMatch?:ExactVisualMatchIntent;
}){
  const rows=checked(await db().from('radar_asset_segments')
    .select('id,channel_id,asset_id,sequence,start_seconds,end_seconds,duration_seconds,title,summary,semantic,confidence,search_text,keyframe_seconds,created_at,updated_at')
    .eq('asset_id',input.assetId).order('sequence',{ascending:true})) as SegmentRow[];
  const ranked=(rows??[]).map(row=>{
    const segment=normalizeSegment(row);
    const exact=input.exactMatch?scoreExactVisualSegment({query:input.query,intent:input.exactMatch,segment}):null;
    const relevance=exact?.relevance??scoreVisualSegment(input.query,segment.searchText);
    return {
      segment,
      relevance,
      eligible:exact?.eligible??true,
      score:exact?.score??(relevance*.88+segment.confidence*.12),
      exactMatch:exact??undefined
    };
  }).filter(item=>item.eligible).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(!best)return null;
  if(input.exactMatch?best.score<.35:best.relevance<.08)return null;
  const desired=Math.max(.25,input.desiredDurationSeconds),sourceStart=best.segment.startSeconds;
  return {
    segment:best.segment,
    score:best.score,
    exactMatch:best.exactMatch,
    sourceStartSeconds:sourceStart,
    sourceEndSeconds:Math.min(best.segment.endSeconds,sourceStart+desired)
  };
}

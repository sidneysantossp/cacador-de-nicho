import 'server-only';

import { spawn } from 'node:child_process';
import type {
  ProductionQualityChapterTechnical, ProductionQualityCheckCode, ProductionQualityReport,
  ProductionQualityReportPayload, ProductionQualityReportVersion, ProductionQualityTechnical,
  RenderJob
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { signedMediaUrl } from './media-storage';
import { listRenderJobs, loadRenderJob } from './render-engine';
import { loadVideoEdit, loadVideoEditWorkspace } from './video-editor';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { assetIsStale } from '@/lib/asset-factory-policy';
import { stockVisualConstraintsSatisfied } from '@/lib/stock-media-policy';
import {
  qualityApprovalIssues, qualityInitialStatus, qualitySummary,
  structuralQualityChecks, technicalQualityChecks,
  type ProductionQualityAssetFact, type ProductionQualityCharacterFact,
  type ProductionQualityMediaDiversity
} from '@/lib/production-quality-policy';
import { ownedMediaDiversityMetrics } from './media-embeddings';

const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';
const FFPROBE=process.env.FFPROBE_PATH||'ffprobe';
const MAX_CAPTURE=256000;

type ReportRow={
  id:string;channel_id:string;episode_id:string;render_job_id:string;
  video_edit_id:string;video_edit_version:number;version:number;
  status:ProductionQualityReport['status'];payload:unknown;
  created_at:string;updated_at:string;
};

function normalizeRow(row:ReportRow):ProductionQualityReport{
  const payload=row.payload as ProductionQualityReportPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    renderJobId:row.render_job_id,
    videoEditId:row.video_edit_id,
    videoEditVersion:Number(row.video_edit_version),
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

const selection='id,channel_id,episode_id,render_job_id,video_edit_id,video_edit_version,version,status,payload,created_at,updated_at';

export async function listProductionQualityReports(channelId:string):Promise<ProductionQualityReport[]>{
  const rows=checked(await db().from('radar_production_quality_reports')
    .select(selection)
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeRow(row as ReportRow));
}

export async function loadProductionQualityReport(reportId:string):Promise<ProductionQualityReport|null>{
  const row=checked(await db().from('radar_production_quality_reports')
    .select(selection)
    .eq('id',reportId)
    .maybeSingle());
  return row?normalizeRow(row as ReportRow):null;
}

async function loadProductionQualityByRender(renderJobId:string):Promise<ProductionQualityReport|null>{
  const row=checked(await db().from('radar_production_quality_reports')
    .select(selection)
    .eq('render_job_id',renderJobId)
    .maybeSingle());
  return row?normalizeRow(row as ReportRow):null;
}

export async function loadProductionQualityHistory(reportId:string,limit=20):Promise<ProductionQualityReportVersion[]>{
  const rows=checked(await db().from('radar_production_quality_versions')
    .select('version,status,payload,created_at')
    .eq('quality_report_id',reportId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as ProductionQualityReport['status'],
    payload:row.payload as ProductionQualityReportPayload,
    createdAt:String(row.created_at)
  }));
}

async function saveReport(
  payload:ProductionQualityReportPayload,
  status:ProductionQualityReport['status'],
  expectedVersion:number|null
):Promise<ProductionQualityReport>{
  const result=await db().rpc('save_production_quality_report',{
    p_report_id:payload.id,
    p_channel_id:payload.channelId,
    p_episode_id:payload.episodeId,
    p_render_job_id:payload.renderJobId,
    p_video_edit_id:payload.videoEditId,
    p_video_edit_version:payload.videoEditVersion,
    p_status:status,
    p_payload:payload,
    p_expected_version:expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('production quality version conflict')){
      throw new HttpError('Production QA desatualizado. Recarregue antes de salvar novamente.',409);
    }
    if(message.includes('render job already has production quality report')){
      throw new HttpError('Este render já possui um relatório de Production QA.',409);
    }
    if(message.includes('render job not eligible for production quality')){
      throw new HttpError('Somente renders concluídos com output podem passar pelo Production QA.',409);
    }
    throw new HttpError('Falha ao salvar o Production QA no Supabase.',502);
  }
  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Production QA.',502);
  return {...payload,version,status};
}

function runCapture(command:string,args:string[],timeoutMs=180000){
  return new Promise<{code:number;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',done=false;
    const timer=setTimeout(()=>{
      if(done)return;
      child.kill('SIGKILL');
    },timeoutMs);
    const append=(current:string,chunk:Buffer)=>(
      current+chunk.toString()
    ).slice(-MAX_CAPTURE);
    child.stdout.on('data',(chunk:Buffer)=>{stdout=append(stdout,chunk);});
    child.stderr.on('data',(chunk:Buffer)=>{stderr=append(stderr,chunk);});
    child.on('error',error=>{
      if(done)return;
      done=true;clearTimeout(timer);reject(error);
    });
    child.on('close',code=>{
      if(done)return;
      done=true;clearTimeout(timer);
      resolve({code:code??-1,stdout,stderr});
    });
  });
}

function rational(value:unknown):number|null{
  const raw=String(value??'').trim();
  if(!raw)return null;
  if(raw.includes('/')){
    const [a,b]=raw.split('/').map(Number);
    return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null;
  }
  const parsed=Number(raw);
  return Number.isFinite(parsed)?parsed:null;
}

function numeric(value:unknown):number|null{
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

function sumMatches(text:string,re:RegExp){
  let total=0;
  for(const match of text.matchAll(re)){
    const value=Number(match[1]);
    if(Number.isFinite(value)&&value>0)total+=value;
  }
  return total;
}

function clampRatio(value:number,duration:number|null){
  if(!duration||duration<=0)return null;
  return Math.max(0,Math.min(1,value/duration));
}

async function outputSignedUrl(job:RenderJob){
  if(!job.outputPath)throw new HttpError('O render concluído não possui output.',409);
  const signed=await signedMediaUrl(job.outputPath,900);
  if(!signed)throw new HttpError('Não foi possível abrir o MP4 privado para QA.',502);
  return signed;
}

type QualityChapterCacheRow={
  id:string;
  render_job_id:string;
  chapter_id:string;
  sequence:number;
  label:string;
  content_hash:string;
  start_seconds:number|string;
  end_seconds:number|string;
  duration_seconds:number|string;
  status:'completed'|'failed';
  cache_hit:boolean;
  technical:unknown;
  analysis_seconds:number|string|null;
  error:string|null;
  created_at:string;
  completed_at:string|null;
  updated_at:string;
};

function emptyTechnical():ProductionQualityTechnical{
  return {
    durationSeconds:null,width:null,height:null,fps:null,videoCodec:null,
    audioCodec:null,sampleRate:null,audioChannels:null,maxVolumeDb:null,
    silenceSeconds:null,silenceRatio:null,blackSeconds:null,blackRatio:null,
    decodeOk:false
  };
}

async function masterProbeAndAudio(job:RenderJob){
  const url=await outputSignedUrl(job);
  const probe=await runCapture(FFPROBE,[
    '-v','error',
    '-show_entries','format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-of','json',
    url
  ],60000);
  if(probe.code!==0)return {url,technical:emptyTechnical()};

  let parsed:{format?:{duration?:string};streams?:Array<Record<string,unknown>>};
  try{parsed=JSON.parse(probe.stdout) as typeof parsed;}
  catch{return {url,technical:emptyTechnical()};}

  const streams=parsed.streams??[];
  const video=streams.find(stream=>stream.codec_type==='video');
  const audio=streams.find(stream=>stream.codec_type==='audio');
  const duration=numeric(parsed.format?.duration);
  let silenceSeconds:number|null=audio?0:null;
  let maxVolumeDb:number|null=null;
  let audioOk=true;

  if(audio){
    const analysis=await runCapture(FFMPEG,[
      '-hide_banner','-nostats','-i',url,
      '-vn','-map','0:a:0',
      '-af','silencedetect=noise=-45dB:d=0.4,volumedetect',
      '-f','null','-'
    ],180000);
    audioOk=analysis.code===0;
    silenceSeconds=sumMatches(analysis.stderr,/silence_duration:\\s*([0-9.]+)/g);
    const maxMatch=analysis.stderr.match(/max_volume:\\s*(-?[0-9.]+)\\s*dB/i);
    maxVolumeDb=maxMatch?numeric(maxMatch[1]):null;
  }

  return {
    url,
    technical:{
      durationSeconds:duration,
      width:numeric(video?.width),
      height:numeric(video?.height),
      fps:rational(video?.r_frame_rate),
      videoCodec:video?.codec_name?String(video.codec_name):null,
      audioCodec:audio?.codec_name?String(audio.codec_name):null,
      sampleRate:numeric(audio?.sample_rate),
      audioChannels:numeric(audio?.channels),
      maxVolumeDb,
      silenceSeconds,
      silenceRatio:audio&&silenceSeconds!==null?clampRatio(silenceSeconds,duration):null,
      blackSeconds:null,
      blackRatio:null,
      decodeOk:probe.code===0&&audioOk
    } satisfies ProductionQualityTechnical
  };
}

async function inspectOutputLegacy(job:RenderJob):Promise<ProductionQualityTechnical>{
  const url=await outputSignedUrl(job);
  const probe=await runCapture(FFPROBE,[
    '-v','error',
    '-show_entries','format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-of','json',
    url
  ],60000);
  if(probe.code!==0)return emptyTechnical();

  let parsed:{format?:{duration?:string};streams?:Array<Record<string,unknown>>};
  try{parsed=JSON.parse(probe.stdout) as typeof parsed;}
  catch{return emptyTechnical();}

  const streams=parsed.streams??[];
  const video=streams.find(stream=>stream.codec_type==='video');
  const audio=streams.find(stream=>stream.codec_type==='audio');
  const duration=numeric(parsed.format?.duration);
  const analysisArgs=[
    '-hide_banner','-nostats','-i',url,
    '-map','0:v:0',
    '-vf','blackdetect=d=0.15:pix_th=0.10'
  ];
  if(audio){
    analysisArgs.push(
      '-map','0:a:0',
      '-af','silencedetect=noise=-45dB:d=0.4,volumedetect'
    );
  }
  analysisArgs.push('-f','null','-');

  const analysis=await runCapture(FFMPEG,analysisArgs,180000);
  const diagnostics=analysis.stderr;
  const blackSeconds=sumMatches(diagnostics,/black_duration:([0-9.]+)/g);
  const silenceSeconds=audio?sumMatches(diagnostics,/silence_duration:\\s*([0-9.]+)/g):0;
  const maxMatch=diagnostics.match(/max_volume:\\s*(-?[0-9.]+)\\s*dB/i);
  const maxVolumeDb=maxMatch?numeric(maxMatch[1]):null;

  return {
    durationSeconds:duration,
    width:numeric(video?.width),
    height:numeric(video?.height),
    fps:rational(video?.r_frame_rate),
    videoCodec:video?.codec_name?String(video.codec_name):null,
    audioCodec:audio?.codec_name?String(audio.codec_name):null,
    sampleRate:numeric(audio?.sample_rate),
    audioChannels:numeric(audio?.channels),
    maxVolumeDb,
    silenceSeconds:audio?silenceSeconds:null,
    silenceRatio:audio?clampRatio(silenceSeconds,duration):null,
    blackSeconds,
    blackRatio:clampRatio(blackSeconds,duration),
    decodeOk:analysis.code===0
  };
}

function chapterTechnicalFromRow(
  row:QualityChapterCacheRow,
  input:{
    chapterId:string;
    sequence:number;
    label:string;
    contentHash:string;
    startSeconds:number;
    endSeconds:number;
    durationSeconds:number;
    cacheHit:boolean;
  }
):ProductionQualityChapterTechnical{
  const technical=row.technical&&typeof row.technical==='object'
    ?row.technical as Record<string,unknown>
    :{};
  return {
    ...input,
    decodeOk:Boolean(technical.decodeOk),
    width:numeric(technical.width),
    height:numeric(technical.height),
    fps:numeric(technical.fps),
    videoCodec:technical.videoCodec?String(technical.videoCodec):null,
    blackSeconds:numeric(technical.blackSeconds),
    blackRatio:numeric(technical.blackRatio),
    analysisSeconds:row.analysis_seconds===null?null:Number(row.analysis_seconds),
    error:row.error??undefined
  };
}

async function reusableChapterQa(hashes:string[]){
  if(!hashes.length)return new Map<string,QualityChapterCacheRow>();
  const rows=checked(await db().from('radar_production_quality_chapters')
    .select('id,render_job_id,chapter_id,sequence,label,content_hash,start_seconds,end_seconds,duration_seconds,status,cache_hit,technical,analysis_seconds,error,created_at,completed_at,updated_at')
    .in('content_hash',hashes)
    .eq('status','completed')
    .order('completed_at',{ascending:false})
    .limit(1000)) as QualityChapterCacheRow[];
  const result=new Map<string,QualityChapterCacheRow>();
  for(const row of rows??[])if(!result.has(row.content_hash))result.set(row.content_hash,row);
  return result;
}

async function inspectChapterVideo(input:{
  outputPath:string;
  chapterId:string;
  sequence:number;
  label:string;
  contentHash:string;
  startSeconds:number;
  endSeconds:number;
  durationSeconds:number;
}):Promise<ProductionQualityChapterTechnical>{
  const started=Date.now();
  const url=await signedMediaUrl(input.outputPath,900);
  if(!url){
    return {
      ...input,cacheHit:false,decodeOk:false,width:null,height:null,fps:null,videoCodec:null,
      blackSeconds:null,blackRatio:null,analysisSeconds:(Date.now()-started)/1000,
      error:'chapter-output-unavailable'
    };
  }
  const probe=await runCapture(FFPROBE,[
    '-v','error',
    '-show_entries','format=duration:stream=codec_name,codec_type,width,height,r_frame_rate',
    '-of','json',
    url
  ],60000);
  let parsed:{format?:{duration?:string};streams?:Array<Record<string,unknown>>}={};
  try{parsed=probe.code===0?JSON.parse(probe.stdout) as typeof parsed:{};}catch{}
  const streams=parsed.streams??[];
  const video=streams.find(stream=>stream.codec_type==='video');

  const analysis=probe.code===0
    ?await runCapture(FFMPEG,[
      '-hide_banner','-nostats','-i',url,
      '-map','0:v:0','-an',
      '-vf','blackdetect=d=0.15:pix_th=0.10',
      '-f','null','-'
    ],180000)
    :{code:-1,stdout:'',stderr:''};
  const blackSeconds=analysis.code===0
    ?sumMatches(analysis.stderr,/black_duration:([0-9.]+)/g)
    :null;
  const duration=numeric(parsed.format?.duration)??input.durationSeconds;
  return {
    ...input,
    cacheHit:false,
    decodeOk:probe.code===0&&analysis.code===0,
    width:numeric(video?.width),
    height:numeric(video?.height),
    fps:rational(video?.r_frame_rate),
    videoCodec:video?.codec_name?String(video.codec_name):null,
    blackSeconds,
    blackRatio:blackSeconds===null?null:clampRatio(blackSeconds,duration),
    analysisSeconds:(Date.now()-started)/1000,
    error:probe.code===0&&analysis.code===0?undefined:'chapter-decode-failed'
  };
}

async function saveChapterQa(
  jobId:string,
  chapter:ProductionQualityChapterTechnical
){
  const technical={
    decodeOk:chapter.decodeOk,
    width:chapter.width,
    height:chapter.height,
    fps:chapter.fps,
    videoCodec:chapter.videoCodec,
    blackSeconds:chapter.blackSeconds,
    blackRatio:chapter.blackRatio
  };
  const result=await db().from('radar_production_quality_chapters').upsert({
    render_job_id:jobId,
    chapter_id:chapter.chapterId,
    sequence:chapter.sequence,
    label:chapter.label,
    content_hash:chapter.contentHash,
    start_seconds:chapter.startSeconds,
    end_seconds:chapter.endSeconds,
    duration_seconds:chapter.durationSeconds,
    status:chapter.decodeOk?'completed':'failed',
    cache_hit:chapter.cacheHit,
    technical,
    analysis_seconds:chapter.analysisSeconds,
    error:chapter.error??null,
    completed_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  },{onConflict:'render_job_id,chapter_id'});
  if(result.error)throw new HttpError('Falha ao persistir QA técnico do capítulo.',502);
}

async function inspectChapterAwareOutput(job:RenderJob):Promise<{
  technical:ProductionQualityTechnical;
  chapterTechnical:ProductionQualityChapterTechnical[];
}>{
  const allChapters=[...(job.chapters??[])].sort((a,b)=>a.sequence-b.sequence);
  const expectedCount=job.payload.chapterPlan?.length??job.payload.manifest.chapters?.length??0;
  if(!allChapters.length||expectedCount!==allChapters.length){
    throw new HttpError('O render-v4 não possui todos os capítulos esperados para QA.',409);
  }
  const incomplete=allChapters.filter(chapter=>chapter.status!=='completed'||!chapter.outputPath);
  if(incomplete.length){
    throw new HttpError('O render-v4 possui capítulo sem output concluído. Reexecute o render antes do QA.',409);
  }
  const chapters=allChapters;

  const {url:masterUrl,technical:master}=await masterProbeAndAudio(job);
  const cache=await reusableChapterQa(chapters.map(chapter=>chapter.contentHash));
  const results:ProductionQualityChapterTechnical[]=[];

  for(const chapter of chapters){
    const input={
      chapterId:chapter.id,
      sequence:chapter.sequence,
      label:chapter.label,
      contentHash:chapter.contentHash,
      startSeconds:chapter.startSeconds,
      endSeconds:chapter.endSeconds,
      durationSeconds:chapter.durationSeconds
    };
    const cached=cache.get(chapter.contentHash);
    const technical=cached
      ?chapterTechnicalFromRow(cached,{...input,cacheHit:true})
      :await inspectChapterVideo({...input,outputPath:chapter.outputPath!});
    results.push(technical);
    await saveChapterQa(job.id,technical);
  }

  let boundariesOk=true;
  for(const chapter of chapters.slice(0,-1)){
    const start=Math.max(0,chapter.endSeconds-.5);
    const boundary=await runCapture(FFMPEG,[
      '-hide_banner','-loglevel','error','-ss',String(start),
      '-i',masterUrl,'-t','1.0','-map','0:v:0','-an','-f','null','-'
    ],30000);
    if(boundary.code!==0)boundariesOk=false;
  }

  const blackValues=results.map(item=>item.blackSeconds);
  const blackSeconds=blackValues.every((value):value is number=>value!==null)
    ?blackValues.reduce((sum,value)=>sum+value,0)
    :null;
  const decodeOk=master.decodeOk&&boundariesOk&&results.every(item=>item.decodeOk);
  return {
    technical:{
      ...master,
      blackSeconds,
      blackRatio:blackSeconds===null?null:clampRatio(blackSeconds,master.durationSeconds),
      decodeOk
    },
    chapterTechnical:results
  };
}

async function inspectOutput(job:RenderJob):Promise<{
  technical:ProductionQualityTechnical;
  chapterTechnical:ProductionQualityChapterTechnical[];
  technicalMode:'master-v1'|'chapter-v2';
}>{
  if(job.payload.compilerVersion==='render-v4'&&(job.chapters?.length??0)>0){
    const result=await inspectChapterAwareOutput(job);
    return {...result,technicalMode:'chapter-v2'};
  }
  return {
    technical:await inspectOutputLegacy(job),
    chapterTechnical:[],
    technicalMode:'master-v1'
  };
}

async function projectFacts(job:RenderJob):Promise<{
  assetFacts:ProductionQualityAssetFact[];
  characterFacts?:ProductionQualityCharacterFact[];
  mediaDiversity:ProductionQualityMediaDiversity;
}>{
  const clips=job.payload.manifest.visualClips;
  const ids=[...new Set(clips.map(clip=>clip.assetId))];
  const rows=ids.length
    ?checked(await db().from('radar_scene_assets')
      .select('id,scene_id,status,storage_path,source_type,provider,payload')
      .in('id',ids))
    :[];
  const rowMap=new Map((rows??[]).map(row=>[String(row.id),row]));

  let exactContext:false|{
    promptSet:Awaited<ReturnType<typeof loadVisualPromptSet>>;
    workspace:Awaited<ReturnType<typeof loadVideoEditWorkspace>>;
  }=false;

  try{
    const edit=await loadVideoEdit(job.videoEditId);
    if(edit&&edit.version===job.videoEditVersion){
      const workspace=await loadVideoEditWorkspace(edit);
      const promptSet=await loadVisualPromptSet(workspace.timeline.visualPromptSetId);
      if(
        promptSet&&
        promptSet.version===workspace.timeline.visualPromptSetVersion&&
        workspace.timeline.version===job.payload.manifest.timelineVersion
      ){
        exactContext={promptSet,workspace};
      }
    }
  }catch{
    exactContext=false;
  }

  const promptMap=exactContext
    ?new Map(exactContext.promptSet!.scenePrompts.map(prompt=>[prompt.sceneId,prompt]))
    :new Map();

  const payloadOf=(row:Record<string,unknown>)=>(
    row.payload&&typeof row.payload==='object'
      ?row.payload as Record<string,unknown>
      :{}
  );
  const objectField=(value:unknown)=>(
    value&&typeof value==='object'
      ?value as Record<string,unknown>
      :{}
  );

  const ownedSegmentIds=[...new Set((rows??[]).flatMap(row=>{
    const owned=objectField(payloadOf(row).owned);
    const id=String(owned.segmentId??'').trim();
    return id?[id]:[];
  }))];
  const ownedSegments=ownedSegmentIds.length
    ?checked(await db().from('radar_owned_media_segments')
      .select('id,semantic')
      .in('id',ownedSegmentIds))
    :[];
  const ownedSemanticBySegment=new Map(
    (ownedSegments??[]).map(row=>[
      String(row.id),
      objectField(row.semantic)
    ])
  );

  const stockAnalysisIds=[...new Set((rows??[]).flatMap(row=>{
    if(String(row.source_type??'')!=='stock')return [];
    const verified=objectField(payloadOf(row).verifiedStock);
    const id=String(verified.cachedFromAssetId??row.id??'').trim();
    return id?[id]:[];
  }))];
  const stockSegments=stockAnalysisIds.length
    ?checked(await db().from('radar_asset_segments')
      .select('asset_id,start_seconds,end_seconds,semantic')
      .in('asset_id',stockAnalysisIds))
    :[];
  const stockSegmentsByAsset=new Map<string,Array<{
    start:number;end:number;semantic:Record<string,unknown>;
  }>>();
  for(const row of stockSegments??[]){
    const key=String(row.asset_id);
    const list=stockSegmentsByAsset.get(key)??[];
    list.push({
      start:Number(row.start_seconds??0),
      end:Number(row.end_seconds??0),
      semantic:objectField(row.semantic)
    });
    stockSegmentsByAsset.set(key,list);
  }

  function timeOfDayForRow(row:Record<string,unknown>){
    const payload=payloadOf(row);
    const owned=objectField(payload.owned);
    const ownedSegmentId=String(owned.segmentId??'').trim();
    if(ownedSegmentId){
      const semantic=ownedSemanticBySegment.get(ownedSegmentId)??{};
      return Array.isArray(semantic.timeOfDay)
        ?semantic.timeOfDay.map(String)
        :[];
    }

    if(String(row.source_type??'')==='stock'){
      const verified=objectField(payload.verifiedStock);
      const analysisId=String(verified.cachedFromAssetId??row.id??'').trim();
      const start=Number(verified.sourceStartSeconds??0);
      const end=Number(verified.sourceEndSeconds??start);
      const candidates=stockSegmentsByAsset.get(analysisId)??[];
      const best=[...candidates].sort((a,b)=>{
        const overlapA=Math.max(0,Math.min(a.end,end)-Math.max(a.start,start));
        const overlapB=Math.max(0,Math.min(b.end,end)-Math.max(b.start,start));
        return overlapB-overlapA;
      })[0];
      const semantic=best?.semantic??{};
      return Array.isArray(semantic.timeOfDay)
        ?semantic.timeOfDay.map(String)
        :[];
    }

    return [];
  }

  function sourceIdentity(row:Record<string,unknown>){
    const payload=payloadOf(row);
    const owned=objectField(payload.owned);
    const ownedId=String(owned.assetId??'').trim();
    if(ownedId)return 'owned:'+ownedId;

    const stock=objectField(payload.stock);
    const providerId=String(stock.providerAssetId??'').trim();
    if(providerId){
      return 'stock:'+String(row.provider??'unknown')+':'+providerId;
    }

    const storage=String(row.storage_path??'').trim();
    return storage?'storage:'+storage:'asset:'+String(row.id??'');
  }

  const clipSources=clips.map(clip=>{
    const row=rowMap.get(clip.assetId);
    return row?sourceIdentity(row as Record<string,unknown>):'asset:'+clip.assetId;
  });
  const uniqueClipSources=new Set(clipSources).size;
  const sourceDiversity=clips.length?uniqueClipSources/clips.length:0;
  const ownedSegmentSequence=clips.flatMap(clip=>{
    const row=rowMap.get(clip.assetId);
    if(!row)return [];
    const owned=objectField(payloadOf(row).owned);
    const id=String(owned.segmentId??'').trim();
    return id?[id]:[];
  });
  const vectorDiversity=ownedSegmentSequence.length>=2
    ?await ownedMediaDiversityMetrics(ownedSegmentSequence).catch(()=>null)
    :null;
  const embeddedClipCount=vectorDiversity?.embeddedClipCount??0;
  const semanticCoverage=clips.length?embeddedClipCount/clips.length:0;
  const semanticDiversity=vectorDiversity&&vectorDiversity.pairCount>0
    ?vectorDiversity.semanticDiversity
    :null;
  const semanticWeight=semanticDiversity===null
    ?0
    :Math.min(.80,.80*semanticCoverage);
  const diversityScore=Math.max(0,Math.min(
    1,
    sourceDiversity*(1-semanticWeight)+(semanticDiversity??0)*semanticWeight
  ));
  const mediaDiversity:ProductionQualityMediaDiversity={
    score:diversityScore,
    sourceDiversity,
    semanticDiversity,
    semanticCoverage,
    maxSimilarity:vectorDiversity&&vectorDiversity.pairCount>0?vectorDiversity.maxSimilarity:null,
    embeddedClipCount,
    ownedClipCount:ownedSegmentSequence.length,
    clipCount:clips.length
  };

  const assetFacts=clips.map(clip=>{
    const row=rowMap.get(clip.assetId);
    if(!row){
      return {
        assetId:clip.assetId,sceneId:clip.sceneId,exists:false,ready:false,
        storagePathMatches:false,sceneMatches:false,promptAligned:null,
        promptReason:'asset '+clip.assetId.slice(0,8)+' não existe mais'
      } satisfies ProductionQualityAssetFact;
    }

    let promptAligned:boolean|null=null;
    let promptReason:string|undefined;
    if(exactContext){
      const currentPrompt=promptMap.get(clip.sceneId);
      if(!currentPrompt){
        promptAligned=false;
        promptReason='cena '+clip.sceneId.slice(0,8)+' não existe no Visual Prompt Set atual da versão';
      }else{
        const payload=payloadOf(row);
        const stale=assetIsStale({
          promptSetVersion:Number(payload.promptSetVersion??0),
          prompt:String(payload.prompt??'')
        },exactContext.promptSet!.version,currentPrompt);
        if(stale){
          promptAligned=false;
          promptReason='asset '+clip.assetId.slice(0,8)+' diverge do prompt/versionamento esperado';
        }else{
          const validationText=[currentPrompt.direction,currentPrompt.prompt].filter(Boolean).join(' ');
          const observedTimeOfDay=timeOfDayForRow(row as Record<string,unknown>);
          const temporal=stockVisualConstraintsSatisfied({
            query:validationText,
            timeOfDay:observedTimeOfDay
          });
          if(temporal.expected&&observedTimeOfDay.length===0){
            promptAligned=null;
            promptReason='asset '+clip.assetId.slice(0,8)+' exige '+temporal.expected+
              ', mas a Visual Intelligence não possui evidência de timeOfDay para o trecho.';
          }else if(!temporal.ok){
            promptAligned=false;
            promptReason='asset '+clip.assetId.slice(0,8)+' '+String(temporal.reason??'falhou no constraint temporal');
          }else{
            promptAligned=true;
          }
        }
      }
    }else{
      promptReason='contexto exato da versão do Video Edit/Timeline não disponível';
    }

    const payload=(row.payload??{}) as Record<string,unknown>;
    const license=payload.license&&typeof payload.license==='object'
      ?payload.license as Record<string,unknown>
      :null;

    return {
      assetId:clip.assetId,
      sceneId:clip.sceneId,
      exists:true,
      ready:String(row.status)==='ready',
      storagePathMatches:String(row.storage_path??'')===clip.storagePath,
      sceneMatches:String(row.scene_id??'')===clip.sceneId,
      promptAligned,
      promptReason,
      sourceType:String(row.source_type??''),
      provider:row.provider?String(row.provider):null,
      licenseType:license?.type?String(license.type):null,
      licenseLabel:license?.label?String(license.label):null,
      sourceIdentity:sourceIdentity(row as Record<string,unknown>)
    } satisfies ProductionQualityAssetFact;
  });

  if(!exactContext)return {assetFacts,characterFacts:undefined,mediaDiversity};

  const counts=new Map<string,number>();
  for(const scene of exactContext.workspace.scenePlan.scenes){
    for(const characterId of scene.characterIds){
      counts.set(characterId,(counts.get(characterId)??0)+1);
    }
  }
  const refs=new Map(exactContext.promptSet!.characterReferences.map(ref=>[ref.characterId,ref]));
  const names=new Map((exactContext.workspace.productionDna?.characters??[]).map(character=>[character.id,character.name]));
  const characterFacts:ProductionQualityCharacterFact[]=[...counts.entries()].map(([characterId,sceneCount])=>({
    characterId,
    name:names.get(characterId)??characterId,
    sceneCount,
    referenceReady:refs.get(characterId)?.assetReady??false
  }));

  return {assetFacts,characterFacts,mediaDiversity};
}

export async function runProductionQuality(renderJobId:string):Promise<ProductionQualityReport>{
  const job=await loadRenderJob(renderJobId);
  if(!job)throw new HttpError('Render job não encontrado.',404);
  if(job.status!=='completed'||!job.outputPath)throw new HttpError('Conclua o render antes de executar Production QA.',409);

  const existing=await loadProductionQualityByRender(job.id);
  const [inspection,facts]=await Promise.all([
    inspectOutput(job),
    projectFacts(job)
  ]);
  const checks=[
    ...structuralQualityChecks({job,...facts}),
    ...technicalQualityChecks(job,inspection.technical)
  ];
  const now=new Date().toISOString();
  const id=existing?.id??crypto.randomUUID();
  const payload:ProductionQualityReportPayload={
    kind:'production-quality-report',
    id,
    channelId:job.channelId,
    episodeId:job.episodeId,
    renderJobId:job.id,
    videoEditId:job.videoEditId,
    videoEditVersion:job.videoEditVersion,
    renderCompilerVersion:job.payload.compilerVersion,
    checkedAt:now,
    checks,
    summary:qualitySummary(checks),
    technical:inspection.technical,
    chapterTechnical:inspection.chapterTechnical,
    technicalMode:inspection.technicalMode,
    review:{
      notes:existing?.review.notes??'',
      overrides:[]
    },
    createdAt:existing?.createdAt??now,
    updatedAt:now
  };
  return saveReport(payload,qualityInitialStatus(checks),existing?.version??0);
}

export async function approveProductionQuality(input:{
  reportId:string;
  expectedVersion:number;
  notes:string;
  overrides:ProductionQualityCheckCode[];
}):Promise<ProductionQualityReport>{
  const report=await loadProductionQualityReport(input.reportId);
  if(!report)throw new HttpError('Production QA não encontrado.',404);
  if(report.version!==input.expectedVersion)throw new HttpError('Production QA desatualizado. Recarregue antes de aprovar.',409);

  const overrides=[...new Set(input.overrides)];
  const issues=qualityApprovalIssues(report,overrides);
  if(issues.length){
    if(issues.includes('quality-blockers-present')){
      throw new HttpError('Existem blockers no Production QA. Corrija e reexecute antes de aprovar.',409);
    }
    throw new HttpError('Confirme todos os itens de revisão manual antes de aprovar.',409);
  }

  const now=new Date().toISOString();
  const payload:ProductionQualityReportPayload={
    ...report,
    review:{
      notes:input.notes.trim().slice(0,5000),
      overrides,
      approvedAt:now,
      approvedBy:'operator'
    },
    updatedAt:now
  };
  const {version:_version,status:_status,...clean}=payload as ProductionQualityReport;
  return saveReport(clean,'approved',report.version);
}

export async function productionQualityChannelState(channelId:string){
  const [reports,jobs]=await Promise.all([
    listProductionQualityReports(channelId),
    listRenderJobs(channelId)
  ]);
  return {
    reports,
    renders:jobs.filter(job=>job.status==='completed')
  };
}

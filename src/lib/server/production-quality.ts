import 'server-only';

import { spawn } from 'node:child_process';
import type {
  ProductionQualityCheckCode, ProductionQualityReport, ProductionQualityReportPayload,
  ProductionQualityReportVersion, ProductionQualityTechnical, RenderJob
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

async function inspectOutput(job:RenderJob):Promise<ProductionQualityTechnical>{
  const url=await outputSignedUrl(job);
  const probe=await runCapture(FFPROBE,[
    '-v','error',
    '-show_entries','format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-of','json',
    url
  ],60000);
  if(probe.code!==0){
    return {
      durationSeconds:null,width:null,height:null,fps:null,videoCodec:null,
      audioCodec:null,sampleRate:null,audioChannels:null,maxVolumeDb:null,
      silenceSeconds:null,silenceRatio:null,blackSeconds:null,blackRatio:null,
      decodeOk:false
    };
  }

  let parsed:{format?:{duration?:string};streams?:Array<Record<string,unknown>>};
  try{parsed=JSON.parse(probe.stdout) as typeof parsed;}
  catch{
    return {
      durationSeconds:null,width:null,height:null,fps:null,videoCodec:null,
      audioCodec:null,sampleRate:null,audioChannels:null,maxVolumeDb:null,
      silenceSeconds:null,silenceRatio:null,blackSeconds:null,blackRatio:null,
      decodeOk:false
    };
  }

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
  const silenceSeconds=audio?sumMatches(diagnostics,/silence_duration:\s*([0-9.]+)/g):0;
  const maxMatch=diagnostics.match(/max_volume:\s*(-?[0-9.]+)\s*dB/i);
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

async function projectFacts(job:RenderJob):Promise<{
  assetFacts:ProductionQualityAssetFact[];
  characterFacts?:ProductionQualityCharacterFact[];
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
  const [technical,facts]=await Promise.all([
    inspectOutput(job),
    projectFacts(job)
  ]);
  const checks=[
    ...structuralQualityChecks({job,...facts}),
    ...technicalQualityChecks(job,technical)
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
    technical,
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

import 'server-only';

import type {
  PerformanceObservation, PerformanceObservationPayload, PerformanceReport,
  PerformanceReportPayload, PerformanceReportVersion, PerformanceMetrics,
  YouTubePublishJob
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { buildPerformanceReport } from '@/lib/performance-policy';
import { loadPublicationPackage } from './publication-package';
import { loadProductionQualityReport } from './production-quality';
import { loadRenderJob } from './render-engine';
import {
  loadYouTubeConnection, loadYouTubeConnectionSecret, refreshYouTubeAccessToken
} from './youtube-oauth';

const ANALYTICS_SCOPE='https://www.googleapis.com/auth/yt-analytics.readonly';
const ANALYTICS_BASE=(process.env.YOUTUBE_ANALYTICS_API_BASE||'https://youtubeanalytics.googleapis.com/v2').replace(/\/$/,'');
const DATA_API_BASE=(process.env.YOUTUBE_API_BASE||'https://www.googleapis.com/youtube/v3').replace(/\/$/,'');

type ObservationRow={
  id:string;channel_id:string;episode_id:string;external_video_id:string|null;
  source_type:PerformanceObservationPayload['sourceType'];observed_at:string;
  payload:unknown;created_at:string;
};
type ReportRow={
  id:string;channel_id:string;episode_id:string;observation_id:string;
  version:number;status:PerformanceReport['status'];payload:unknown;
  created_at:string;updated_at:string;
};

const observationSelection='id,channel_id,episode_id,external_video_id,source_type,observed_at,payload,created_at';
const reportSelection='id,channel_id,episode_id,observation_id,version,status,payload,created_at,updated_at';

function normalizeObservation(row:ObservationRow):PerformanceObservation{
  return {
    ...(row.payload as PerformanceObservationPayload),
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    externalVideoId:row.external_video_id??undefined,
    sourceType:row.source_type,
    observedAt:row.observed_at,
    createdAt:(row.payload as PerformanceObservationPayload).createdAt??row.created_at
  };
}

function normalizeReport(row:ReportRow):PerformanceReport{
  return {
    ...(row.payload as PerformanceReportPayload),
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    observationId:row.observation_id,
    version:Number(row.version),
    status:row.status,
    createdAt:(row.payload as PerformanceReportPayload).createdAt??row.created_at,
    updatedAt:(row.payload as PerformanceReportPayload).updatedAt??row.updated_at
  };
}

export async function listPerformanceObservations(channelId:string):Promise<PerformanceObservation[]>{
  const rows=checked(await db().from('radar_performance_observations')
    .select(observationSelection)
    .eq('channel_id',channelId)
    .order('observed_at',{ascending:false})
    .limit(500));
  return (rows??[]).map(row=>normalizeObservation(row as ObservationRow));
}

export async function loadPerformanceObservation(observationId:string):Promise<PerformanceObservation|null>{
  const row=checked(await db().from('radar_performance_observations')
    .select(observationSelection)
    .eq('id',observationId)
    .maybeSingle());
  return row?normalizeObservation(row as ObservationRow):null;
}

export async function listPerformanceReports(channelId:string):Promise<PerformanceReport[]>{
  const rows=checked(await db().from('radar_performance_reports')
    .select(reportSelection)
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(500));
  return (rows??[]).map(row=>normalizeReport(row as ReportRow));
}

export async function loadPerformanceReport(reportId:string):Promise<PerformanceReport|null>{
  const row=checked(await db().from('radar_performance_reports')
    .select(reportSelection).eq('id',reportId).maybeSingle());
  return row?normalizeReport(row as ReportRow):null;
}

export async function loadPerformanceReportHistory(reportId:string,limit=30):Promise<PerformanceReportVersion[]>{
  const rows=checked(await db().from('radar_performance_report_versions')
    .select('version,status,payload,created_at')
    .eq('report_id',reportId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,100))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as PerformanceReport['status'],
    payload:row.payload as PerformanceReportPayload,
    createdAt:String(row.created_at)
  }));
}

async function saveReport(
  payload:PerformanceReportPayload,
  status:PerformanceReport['status'],
  expectedVersion:number|null
){
  const result=await db().rpc('save_performance_report',{
    p_report_id:payload.id,
    p_channel_id:payload.channelId,
    p_episode_id:payload.episodeId,
    p_observation_id:payload.observationId,
    p_status:status,
    p_payload:payload,
    p_expected_version:expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('performance report version conflict')){
      throw new HttpError('Performance Report desatualizado. Recarregue antes de salvar.',409);
    }
    if(message.includes('performance observation already has report')){
      throw new HttpError('Esta observação já possui Performance Report.',409);
    }
    if(message.includes('performance observation not eligible')){
      throw new HttpError('A observação não pertence ao canal/episódio deste report.',409);
    }
    throw new HttpError('Falha ao versionar Performance Report.',502);
  }
  const saved=await loadPerformanceReport(payload.id);
  if(!saved)throw new HttpError('Report salvo, mas não pôde ser recarregado.',502);
  return saved;
}

async function insertObservation(payload:PerformanceObservationPayload){
  const result=await db().from('radar_performance_observations').insert({
    id:payload.id,
    channel_id:payload.channelId,
    episode_id:payload.episodeId,
    external_video_id:payload.externalVideoId??null,
    source_type:payload.sourceType,
    observed_at:payload.observedAt,
    payload
  });
  if(result.error)throw new HttpError('Falha ao persistir Performance Observation.',502);
  return payload as PerformanceObservation;
}

async function reportForObservation(observationId:string):Promise<PerformanceReport|null>{
  const row=checked(await db().from('radar_performance_reports')
    .select(reportSelection)
    .eq('observation_id',observationId)
    .maybeSingle());
  return row?normalizeReport(row as ReportRow):null;
}

async function reportFromObservation(observation:PerformanceObservation){
  const history=(await listPerformanceObservations(observation.channelId))
    .filter(item=>item.id!==observation.id&&item.episodeId!==observation.episodeId);
  const payload=buildPerformanceReport(observation,history);
  if(observation.sourceType==='youtube-analytics'){
    payload.limitations=[
      ...payload.limitations,
      'Impressões e CTR de thumbnail não são coletados pelo reports.query usado nesta integração; esses dados exigem a camada de Reach do YouTube Reporting API.',
      'Receita e RPM não são coletados automaticamente porque o scope monetário do YouTube Analytics não foi solicitado.'
    ];
  }
  payload.updatedAt=new Date().toISOString();
  return saveReport(payload,'review',0);
}

export async function createManualPerformanceObservation(payload:PerformanceObservationPayload){
  const channel=checked(await db().from('radar_managed_channels')
    .select('id').eq('id',payload.channelId).maybeSingle());
  if(!channel)throw new HttpError('Canal não encontrado.',404);
  const episode=checked(await db().from('radar_episodes')
    .select('id,channel_id').eq('id',payload.episodeId).maybeSingle());
  if(!episode||episode.channel_id!==payload.channelId)throw new HttpError('Episódio inválido para este canal.',400);
  if(payload.sourceType==='youtube-analytics')throw new HttpError('Use a coleta automática para sourceType youtube-analytics.',400);
  await insertObservation(payload);
  return {observation:payload as PerformanceObservation,report:await reportFromObservation(payload as PerformanceObservation)};
}

type AnalyticsTable={
  columnHeaders?:Array<{name?:string;columnType?:string;dataType?:string}>;
  rows?:Array<Array<string|number|null>>;
  errors?:Array<{message?:string}>;
};
function rowObject(table:AnalyticsTable,row:Array<string|number|null>){
  const result:Record<string,string|number|null>={};
  (table.columnHeaders??[]).forEach((header,index)=>{
    if(header.name)result[header.name]=row[index]??null;
  });
  return result;
}
function numeric(value:unknown){
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
async function analyticsQuery(
  accessToken:string,
  params:Record<string,string>
):Promise<AnalyticsTable>{
  const url=new URL(ANALYTICS_BASE+'/reports');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const result=await response.json().catch(()=>({})) as AnalyticsTable&{error?:{message?:string}};
  if(!response.ok){
    throw new HttpError('YouTube Analytics falhou: '+(result.error?.message??response.statusText)+'.',502);
  }
  return result;
}

async function commentSample(accessToken:string,videoId:string){
  const url=new URL(DATA_API_BASE+'/commentThreads');
  url.searchParams.set('part','snippet');
  url.searchParams.set('videoId',videoId);
  url.searchParams.set('maxResults','50');
  url.searchParams.set('order','relevance');
  url.searchParams.set('textFormat','plainText');
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const result=await response.json().catch(()=>({})) as {
    items?:Array<{snippet?:{topLevelComment?:{snippet?:{textDisplay?:string;textOriginal?:string;likeCount?:number}}}}>;
    error?:{errors?:Array<{reason?:string}>;message?:string};
  };
  if(!response.ok){
    if(result.error?.errors?.some(item=>item.reason==='commentsDisabled'))return [];
    throw new HttpError('Falha ao coletar comentários do YouTube: '+(result.error?.message??response.statusText)+'.',502);
  }
  return (result.items??[]).map(item=>{
    const snippet=item.snippet?.topLevelComment?.snippet;
    return {
      text:(snippet?.textOriginal??snippet?.textDisplay??'').trim(),
      likes:Number(snippet?.likeCount??0)
    };
  }).filter(item=>item.text).slice(0,50);
}

function isoDay(value:string|undefined){
  const date=value?new Date(value):new Date();
  if(!Number.isFinite(date.getTime()))return new Date().toISOString().slice(0,10);
  return date.toISOString().slice(0,10);
}
function sampleRetention(curve:Array<{second:number;audiencePercent:number}>,second:number){
  if(!curve.length)return undefined;
  return [...curve].sort((a,b)=>Math.abs(a.second-second)-Math.abs(b.second-second))[0]?.audiencePercent;
}

export async function collectYouTubePerformance(
  publishJobId:string,
  options:{observationId?:string}={}
){
  const jobRow=checked(await db().from('radar_youtube_publish_jobs')
    .select('id,channel_id,package_id,connection_id,status,youtube_video_id,completed_at,created_at,payload')
    .eq('id',publishJobId).maybeSingle());
  if(!jobRow)throw new HttpError('Publicação YouTube não encontrada.',404);
  if(jobRow.status!=='completed'||!jobRow.youtube_video_id){
    throw new HttpError('Somente vídeos já publicados podem alimentar o Performance Analyst.',409);
  }

  const [pkg,connection]=await Promise.all([
    loadPublicationPackage(String(jobRow.package_id)),
    loadYouTubeConnection(String(jobRow.channel_id))
  ]);
  if(!pkg)throw new HttpError('Publication Package da publicação não foi encontrado.',404);
  if(!connection||connection.status!=='connected')throw new HttpError('Conexão YouTube precisa ser reautorizada.',409);
  if(!connection.scopes.includes(ANALYTICS_SCOPE)){
    throw new HttpError('Reconecte o canal para conceder acesso ao YouTube Analytics.',409);
  }

  if(options.observationId){
    const existing=await loadPerformanceObservation(options.observationId);
    if(existing){
      if(existing.channelId!==pkg.channelId||
         existing.episodeId!==pkg.episodeId||
         existing.externalVideoId!==String(jobRow.youtube_video_id)){
        throw new HttpError('Observation ID já pertence a outro snapshot de performance.',409);
      }
      const report=await reportForObservation(existing.id)??await reportFromObservation(existing);
      return {observation:existing,report};
    }
  }

  const secret=await loadYouTubeConnectionSecret(String(jobRow.connection_id));
  const token=await refreshYouTubeAccessToken(secret.refreshToken);
  const accessToken=token.access_token!;
  const videoId=String(jobRow.youtube_video_id);
  const startDate=isoDay(String(jobRow.completed_at??jobRow.created_at));
  const endDate=isoDay(undefined);

  const [basic,traffic,quality,render,comments]=await Promise.all([
    analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      metrics:'views,comments,likes,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost',
      filters:'video=='+videoId
    }),
    analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      dimensions:'insightTrafficSourceType',
      metrics:'views,estimatedMinutesWatched',
      filters:'video=='+videoId,
      sort:'-views'
    }),
    loadProductionQualityReport(pkg.qualityReportId),
    loadRenderJob(pkg.renderJobId),
    commentSample(accessToken,videoId)
  ]);

  const basicRow=basic.rows?.[0];
  if(!basicRow){
    throw new HttpError('O YouTube Analytics ainda não disponibilizou métricas para este vídeo. Tente novamente mais tarde.',409);
  }
  const basicValues=rowObject(basic,basicRow);
  const durationSeconds=quality?.technical.durationSeconds
    ??render?.payload?.manifest?.durationSeconds
    ??null;

  let retentionCurve:Array<{second:number;audiencePercent:number}>=[];
  if(durationSeconds&&durationSeconds>0){
    const retention=await analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      dimensions:'elapsedVideoTimeRatio',
      metrics:'audienceWatchRatio',
      filters:'video=='+videoId
    });
    retentionCurve=(retention.rows??[]).map(row=>{
      const value=rowObject(retention,row);
      const ratio=numeric(value.elapsedVideoTimeRatio);
      const audience=numeric(value.audienceWatchRatio);
      return ratio===null||audience===null?null:{
        second:Math.max(0,ratio*durationSeconds),
        audiencePercent:Math.max(0,audience*100)
      };
    }).filter((item):item is {second:number;audiencePercent:number}=>Boolean(item))
      .sort((a,b)=>a.second-b.second);
  }

  const metrics:PerformanceMetrics={};
  const assign=(key:keyof PerformanceMetrics,value:unknown,multiplier=1)=>{
    const number=numeric(value);
    if(number!==null)metrics[key]=number*multiplier;
  };
  assign('views',basicValues.views);
  assign('commentCount',basicValues.comments);
  assign('likes',basicValues.likes);
  assign('shares',basicValues.shares);
  assign('watchTimeMinutes',basicValues.estimatedMinutesWatched);
  assign('averageViewDurationSeconds',basicValues.averageViewDuration);
  assign('averagePercentageViewed',basicValues.averageViewPercentage);
  assign('subscribersGained',basicValues.subscribersGained);
  assign('subscribersLost',basicValues.subscribersLost);
  const r5=sampleRetention(retentionCurve,5);
  const r30=sampleRetention(retentionCurve,30);
  if(r5!==undefined)metrics.retentionFirstSecondsPercent=r5;
  if(r30!==undefined)metrics.retention30Percent=r30;

  const trafficSources=(traffic.rows??[]).map(row=>{
    const value=rowObject(traffic,row);
    return {
      source:String(value.insightTrafficSourceType??'UNKNOWN'),
      views:Math.max(0,numeric(value.views)??0),
      watchTimeMinutes:Math.max(0,numeric(value.estimatedMinutesWatched)??0)
    };
  });

  const now=new Date().toISOString();
  const observation:PerformanceObservationPayload={
    kind:'performance-observation',
    id:options.observationId??crypto.randomUUID(),
    channelId:pkg.channelId,
    episodeId:pkg.episodeId,
    externalVideoId:videoId,
    sourceType:'youtube-analytics',
    observedAt:now,
    metrics,
    retentionCurve,
    trafficSources,
    comments,
    expectations:{},
    experiment:{changedVariables:[],notes:''},
    provenance:{
      sourceLabel:'YouTube Analytics API '+startDate+' → '+endDate+' · retenção amostrada em 5s/30s quando disponível'
    },
    createdAt:now
  };

  await insertObservation(observation);
  const report=await reportFromObservation(observation as PerformanceObservation);
  return {observation:observation as PerformanceObservation,report};
}

export async function approvePerformanceReport(input:{
  reportId:string;
  expectedVersion:number;
  notes:string;
}){
  const current=await loadPerformanceReport(input.reportId);
  if(!current)throw new HttpError('Performance Report não encontrado.',404);
  if(current.version!==input.expectedVersion)throw new HttpError('Performance Report desatualizado.',409);
  if(current.status==='approved')return current;
  const {version:_version,status:_status,...payload}=current;
  const next:PerformanceReportPayload={
    ...payload,
    review:{notes:input.notes.trim().slice(0,5000)},
    updatedAt:new Date().toISOString()
  };
  return saveReport(next,'approved',current.version);
}

export async function performanceAnalystChannelState(channelId:string){
  const [observations,reports,published,connection]=await Promise.all([
    listPerformanceObservations(channelId),
    listPerformanceReports(channelId),
    db().from('radar_youtube_publish_jobs')
      .select('id,channel_id,package_id,package_version,connection_id,status,progress,stage,attempts,youtube_video_id,youtube_url,actual_privacy_status,error,payload,created_at,started_at,completed_at,updated_at')
      .eq('channel_id',channelId)
      .eq('status','completed')
      .not('youtube_video_id','is',null)
      .order('completed_at',{ascending:false})
      .limit(100),
    loadYouTubeConnection(channelId)
  ]);
  const jobs=checked(published)??[];
  return {
    observations,
    reports,
    publishedVideos:jobs.map(row=>({
      id:String(row.id),
      channelId:String(row.channel_id),
      packageId:String(row.package_id),
      packageVersion:Number(row.package_version),
      connectionId:String(row.connection_id),
      status:row.status,
      progress:Number(row.progress),
      stage:String(row.stage),
      attempts:Number(row.attempts),
      youtubeVideoId:row.youtube_video_id?String(row.youtube_video_id):undefined,
      youtubeUrl:row.youtube_url?String(row.youtube_url):undefined,
      actualPrivacyStatus:row.actual_privacy_status?String(row.actual_privacy_status):undefined,
      error:row.error?String(row.error):undefined,
      payload:row.payload,
      createdAt:String(row.created_at),
      startedAt:row.started_at?String(row.started_at):undefined,
      completedAt:row.completed_at?String(row.completed_at):undefined,
      updatedAt:String(row.updated_at)
    } as YouTubePublishJob)),
    analyticsScopeGranted:Boolean(connection?.scopes.includes(ANALYTICS_SCOPE)),
    connection
  };
}

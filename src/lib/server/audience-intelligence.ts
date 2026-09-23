import 'server-only';

import type {
  AudienceIntelligencePayload, AudienceIntelligenceReport, AudienceIntelligenceVersion,
  PerformanceObservation, PerformanceReport
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  listPerformanceObservations, listPerformanceReports,
  loadPerformanceObservation, loadPerformanceReport
} from './performance-analyst';
import {
  buildAudienceCommentSample, compileAudienceModelResult
} from '@/lib/audience-intelligence-policy';
import { analyzeAudienceComments } from './audience-ai';

type Row={
  id:string;
  channel_id:string;
  episode_id:string;
  performance_report_id:string;
  observation_id:string;
  version:number;
  status:AudienceIntelligenceReport['status'];
  payload:unknown;
  created_at:string;
  updated_at:string;
};

const selection='id,channel_id,episode_id,performance_report_id,observation_id,version,status,payload,created_at,updated_at';

function normalize(row:Row):AudienceIntelligenceReport{
  const payload=row.payload as AudienceIntelligencePayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    performanceReportId:row.performance_report_id,
    observationId:row.observation_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??row.created_at,
    updatedAt:payload.updatedAt??row.updated_at
  };
}

export async function listAudienceIntelligenceReports(channelId:string){
  const rows=checked(await db().from('radar_audience_intelligence_reports')
    .select(selection)
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(300));
  return (rows??[]).map(row=>normalize(row as Row));
}

export async function loadAudienceIntelligenceReport(reportId:string){
  const row=checked(await db().from('radar_audience_intelligence_reports')
    .select(selection)
    .eq('id',reportId)
    .maybeSingle());
  return row?normalize(row as Row):null;
}

export async function loadAudienceIntelligenceHistory(
  reportId:string,
  limit=30
):Promise<AudienceIntelligenceVersion[]>{
  const rows=checked(await db().from('radar_audience_intelligence_versions')
    .select('version,status,payload,created_at')
    .eq('audience_report_id',reportId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,100))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as AudienceIntelligenceReport['status'],
    payload:row.payload as AudienceIntelligencePayload,
    createdAt:String(row.created_at)
  }));
}

async function saveReport(
  payload:AudienceIntelligencePayload,
  status:AudienceIntelligenceReport['status'],
  expectedVersion:number|null
){
  const result=await db().rpc('save_audience_intelligence_report',{
    p_report_id:payload.id,
    p_channel_id:payload.channelId,
    p_episode_id:payload.episodeId,
    p_performance_report_id:payload.performanceReportId,
    p_observation_id:payload.observationId,
    p_status:status,
    p_payload:payload,
    p_expected_version:expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('audience intelligence version conflict')){
      throw new HttpError('Audience Report desatualizado. Recarregue antes de salvar.',409);
    }
    if(message.includes('performance report already has audience intelligence')){
      throw new HttpError('Este Performance Report já possui Audience Intelligence.',409);
    }
    if(message.includes('audience intelligence source not eligible')){
      throw new HttpError('A origem do Audience Report não está mais elegível.',409);
    }
    throw new HttpError('Falha ao versionar Audience Intelligence.',502);
  }
  const saved=await loadAudienceIntelligenceReport(payload.id);
  if(!saved)throw new HttpError('Audience Report salvo, mas não pôde ser recarregado.',502);
  return saved;
}

async function episodeTitle(episodeId:string){
  const row=checked(await db().from('radar_episodes')
    .select('payload')
    .eq('id',episodeId)
    .maybeSingle());
  const payload=(row?.payload??{}) as Record<string,unknown>;
  return String(payload.title??'').trim();
}

async function sourceForPerformanceReport(performance:PerformanceReport){
  if(performance.status!=='approved'){
    throw new HttpError('Aprove o Performance Report antes de analisar a audiência.',409);
  }
  const observation=await loadPerformanceObservation(performance.observationId);
  if(!observation||
     observation.channelId!==performance.channelId||
     observation.episodeId!==performance.episodeId){
    throw new HttpError('A Performance Observation do report não foi encontrada.',409);
  }
  if(!observation.comments.length){
    throw new HttpError('Esta observação não possui comentários para Audience Intelligence.',409);
  }
  return observation;
}

export async function createAudienceIntelligence(performanceReportId:string){
  const performance=await loadPerformanceReport(performanceReportId);
  if(!performance)throw new HttpError('Performance Report não encontrado.',404);

  const existing=checked(await db().from('radar_audience_intelligence_reports')
    .select('id').eq('performance_report_id',performanceReportId).maybeSingle());
  if(existing){
    const report=await loadAudienceIntelligenceReport(String(existing.id));
    if(report)return {report,created:false};
  }

  const observation=await sourceForPerformanceReport(performance);
  const sample=buildAudienceCommentSample(observation,50);
  if(!sample.length)throw new HttpError('Nenhum comentário utilizável foi encontrado na amostra.',409);

  const title=await episodeTitle(performance.episodeId);
  const ai=await analyzeAudienceComments({videoTitle:title,comments:sample});

  let compiled;
  try{
    compiled=compileAudienceModelResult(sample,ai.result);
  }catch(error){
    throw new HttpError(
      'A análise de audiência devolveu referências incompatíveis com a amostra. Nenhum report foi salvo. '+
      (error instanceof Error?error.message:''),
      502
    );
  }
  if(!compiled.classifications.length){
    throw new HttpError('A análise não classificou nenhum comentário da amostra. Nenhum report foi salvo.',502);
  }

  const now=new Date().toISOString();
  const id=crypto.randomUUID();
  const payload:AudienceIntelligencePayload={
    kind:'audience-intelligence',
    id,
    channelId:performance.channelId,
    episodeId:performance.episodeId,
    performanceReportId:performance.id,
    performanceReportVersion:performance.version,
    observationId:observation.id,
    externalVideoId:observation.externalVideoId,
    sampleSize:sample.length,
    analyzedCommentRefs:compiled.analyzedCommentRefs,
    sentimentSampleCounts:compiled.sentimentSampleCounts,
    classifications:compiled.classifications,
    themes:compiled.themes,
    limitations:compiled.limitations,
    provenance:{
      model:ai.model,
      sourceLabel:observation.provenance.sourceLabel??'Performance Observation '+observation.id
    },
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };

  return {report:await saveReport(payload,'review',0),created:true};
}

export async function approveAudienceIntelligence(input:{
  reportId:string;
  expectedVersion:number;
  notes:string;
}){
  const current=await loadAudienceIntelligenceReport(input.reportId);
  if(!current)throw new HttpError('Audience Report não encontrado.',404);
  if(current.version!==input.expectedVersion)throw new HttpError('Audience Report desatualizado.',409);
  if(current.status==='approved')return current;

  const performance=await loadPerformanceReport(current.performanceReportId);
  if(!performance||
     performance.status!=='approved'||
     performance.version!==current.performanceReportVersion){
    throw new HttpError('O Performance Report de origem mudou. Gere uma nova Audience Intelligence.',409);
  }

  const now=new Date().toISOString();
  const {version:_version,status:_status,...payload}=current;
  const next:AudienceIntelligencePayload={
    ...payload,
    review:{
      notes:input.notes.trim().slice(0,5000),
      approvedAt:now,
      approvedBy:'operator'
    },
    updatedAt:now
  };
  return saveReport(next,'approved',current.version);
}

export async function audienceSourceSample(report:AudienceIntelligenceReport){
  const observation=await loadPerformanceObservation(report.observationId);
  if(!observation)return [];
  return buildAudienceCommentSample(observation,50);
}

export async function audienceIntelligenceChannelState(channelId:string){
  const [reports,performanceReports,observations]=await Promise.all([
    listAudienceIntelligenceReports(channelId),
    listPerformanceReports(channelId),
    listPerformanceObservations(channelId)
  ]);
  const observationById=new Map(observations.map(item=>[item.id,item]));
  const existingPerformanceIds=new Set(reports.map(item=>item.performanceReportId));

  const eligiblePerformanceReports=performanceReports.filter(report=>{
    if(report.status!=='approved'||existingPerformanceIds.has(report.id))return false;
    const observation=observationById.get(report.observationId);
    return Boolean(observation?.comments.length);
  });

  const samples=Object.fromEntries(await Promise.all(
    reports.map(async report=>[report.id,await audienceSourceSample(report)] as const)
  ));

  return {
    reports,
    eligiblePerformanceReports,
    samples
  };
}

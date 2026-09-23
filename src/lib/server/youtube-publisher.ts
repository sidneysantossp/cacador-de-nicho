import 'server-only';

import type {
  YouTubePublishJob, YouTubePublishJobStatus, YouTubePublishPayload
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadPublicationPackage, listPublicationPackages } from './publication-package';
import { loadYouTubeConnection } from './youtube-oauth';
import {
  buildYouTubePublishPayload, youtubePublishReadinessIssues, youtubeWatchUrl
} from '@/lib/youtube-publisher-policy';
import { youtubeOAuthConfig } from './youtube-secrets';

type JobRow={
  id:string;channel_id:string;package_id:string;package_version:number;connection_id:string;
  status:YouTubePublishJobStatus;progress:number;stage:string;attempts:number;
  youtube_video_id:string|null;youtube_url:string|null;actual_privacy_status:string|null;
  error:string|null;payload:unknown;created_at:string;started_at:string|null;
  completed_at:string|null;updated_at:string;
};

const selection='id,channel_id,package_id,package_version,connection_id,status,progress,stage,attempts,youtube_video_id,youtube_url,actual_privacy_status,error,payload,created_at,started_at,completed_at,updated_at';

function normalizeJob(row:JobRow):YouTubePublishJob{
  return {
    id:row.id,
    channelId:row.channel_id,
    packageId:row.package_id,
    packageVersion:Number(row.package_version),
    connectionId:row.connection_id,
    status:row.status,
    progress:Number(row.progress),
    stage:row.stage,
    attempts:Number(row.attempts),
    youtubeVideoId:row.youtube_video_id??undefined,
    youtubeUrl:row.youtube_url??undefined,
    actualPrivacyStatus:row.actual_privacy_status??undefined,
    error:row.error??undefined,
    payload:row.payload as YouTubePublishPayload,
    createdAt:row.created_at,
    startedAt:row.started_at??undefined,
    completedAt:row.completed_at??undefined,
    updatedAt:row.updated_at
  };
}

export async function listYouTubePublishJobs(channelId:string):Promise<YouTubePublishJob[]>{
  const rows=checked(await db().from('radar_youtube_publish_jobs')
    .select(selection)
    .eq('channel_id',channelId)
    .order('created_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeJob(row as JobRow));
}

export async function loadYouTubePublishJob(jobId:string):Promise<YouTubePublishJob|null>{
  const row=checked(await db().from('radar_youtube_publish_jobs')
    .select(selection).eq('id',jobId).maybeSingle());
  return row?normalizeJob(row as JobRow):null;
}

export async function queueYouTubePublication(packageId:string){
  const pkg=await loadPublicationPackage(packageId);
  if(!pkg)throw new HttpError('Publication Package não encontrado.',404);
  const connection=await loadYouTubeConnection(pkg.channelId);
  const issues=youtubePublishReadinessIssues(pkg,connection);
  if(issues.length){
    throw new HttpError('Publicação YouTube bloqueada: '+issues.join(' · ')+'.',409);
  }

  const existing=checked(await db().from('radar_youtube_publish_jobs')
    .select(selection).eq('package_id',packageId).maybeSingle());
  if(existing)return normalizeJob(existing as JobRow);

  const payload=buildYouTubePublishPayload(pkg,connection!);
  const id=crypto.randomUUID();
  const inserted=await db().from('radar_youtube_publish_jobs').insert({
    id,
    channel_id:pkg.channelId,
    package_id:pkg.id,
    package_version:pkg.version,
    connection_id:connection!.id,
    status:'queued',
    progress:0,
    stage:'queued',
    attempts:0,
    payload
  });
  if(inserted.error)throw new HttpError('Falha ao enfileirar publicação no YouTube.',502);
  const job=await loadYouTubePublishJob(id);
  if(!job)throw new HttpError('Publicação enfileirada, mas não pôde ser recarregada.',502);
  return job;
}

export async function cancelYouTubePublication(jobId:string){
  const job=await loadYouTubePublishJob(jobId);
  if(!job)throw new HttpError('Job de publicação não encontrado.',404);
  if(['completed','failed','cancelled'].includes(job.status))return job;
  checked(await db().from('radar_youtube_publish_jobs').update({
    status:'cancelled',
    stage:'cancelled',
    worker_token:null,
    lease_until:null,
    completed_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  }).eq('id',jobId).in('status',['queued','processing']));
  return loadYouTubePublishJob(jobId);
}

export async function retryYouTubePublication(jobId:string){
  const job=await loadYouTubePublishJob(jobId);
  if(!job)throw new HttpError('Job de publicação não encontrado.',404);
  if(job.status!=='failed'&&job.status!=='cancelled'){
    throw new HttpError('Somente publicações failed/cancelled podem ser reenfileiradas.',409);
  }
  const [pkg,connection]=await Promise.all([
    loadPublicationPackage(job.packageId),
    loadYouTubeConnection(job.channelId)
  ]);
  const issues=youtubePublishReadinessIssues(pkg,connection);
  if(issues.length)throw new HttpError('Retry bloqueado: '+issues.join(' · ')+'.',409);
  if(pkg!.version!==job.packageVersion){
    throw new HttpError('O Publication Package mudou desde este job. Crie uma nova publicação.',409);
  }

  checked(await db().from('radar_youtube_publish_jobs').update({
    status:'queued',
    progress:job.youtubeVideoId?88:0,
    stage:job.youtubeVideoId?'resume-after-video-upload':'queued',
    worker_token:null,
    lease_until:null,
    error:null,
    completed_at:null,
    updated_at:new Date().toISOString()
  }).eq('id',jobId).in('status',['failed','cancelled']));
  return loadYouTubePublishJob(jobId);
}

export async function youtubePublisherChannelState(channelId:string){
  const [connection,jobs,packages]=await Promise.all([
    loadYouTubeConnection(channelId),
    listYouTubePublishJobs(channelId),
    listPublicationPackages(channelId)
  ]);
  const jobPackages=new Set(jobs.map(job=>job.packageId));
  const config=youtubeOAuthConfig();
  return {
    configured:config.configured,
    missing:config.missing,
    connection,
    jobs,
    readyPackages:packages.filter(pkg=>pkg.status==='approved'&&!jobPackages.has(pkg.id))
  };
}

export async function recordPublishedVideo(input:{
  jobId:string;
  workerToken:string;
  youtubeVideoId:string;
  actualPrivacyStatus?:string;
}){
  const url=youtubeWatchUrl(input.youtubeVideoId);
  const result=await db().from('radar_youtube_publish_jobs').update({
    youtube_video_id:input.youtubeVideoId,
    youtube_url:url,
    actual_privacy_status:input.actualPrivacyStatus??null,
    progress:90,
    stage:'video-uploaded',
    updated_at:new Date().toISOString()
  }).eq('id',input.jobId)
    .eq('status','processing')
    .eq('worker_token',input.workerToken);
  if(result.error)throw new HttpError('Falha ao registrar vídeo enviado ao YouTube.',502);
  return url;
}

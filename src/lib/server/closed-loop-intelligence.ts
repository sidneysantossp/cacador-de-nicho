import 'server-only';

import type {
  LearningLoopJob, LearningLoopJobPayload, LearningLoopJobStatus, ManagedChannel
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  channelAutopilotLearningEnabled, channelLearningWindows, channelShouldAutoPlanNextEpisode,
  effectiveChannelAutopilot, nextEpisodeAutoAcceptIssues
} from '@/lib/channel-autopilot-policy';
import {
  approvePerformanceReport, collectYouTubePerformance
} from './performance-analyst';
import { applyPerformanceReportToBrain } from './learning-loop';
import {
  approveAudienceIntelligence, createAudienceIntelligence
} from './audience-intelligence';
import { applyAudienceReportToBrain } from './audience-learning-loop';
import {
  acceptNextEpisodeCandidate, generateNextEpisodePlan
} from './next-episode';
import { loadAutopilotOperationalIssues } from './autopilot-operational';
import { assertAutopilotControlRunning } from './autopilot-control';
import { recordAutopilotIncident } from './autopilot-incidents';

type JobRow={
  id:string;
  channel_id:string;
  publish_job_id:string;
  package_id:string;
  episode_id:string;
  window_hours:number;
  due_at:string;
  status:LearningLoopJobStatus;
  attempts:number;
  stage:string;
  observation_id:string|null;
  performance_report_id:string|null;
  audience_report_id:string|null;
  brain_version:number|null;
  next_episode_plan_id:string|null;
  next_episode_episode_id:string|null;
  next_episode_automation_run_id:string|null;
  next_episode_action:LearningLoopJob['nextEpisodeAction']|null;
  last_error:string|null;
  payload:unknown;
  completed_at:string|null;
  updated_at:string;
};

const selection=[
  'id','channel_id','publish_job_id','package_id','episode_id','window_hours','due_at',
  'status','attempts','stage','observation_id','performance_report_id','audience_report_id',
  'brain_version','next_episode_plan_id','next_episode_episode_id',
  'next_episode_automation_run_id','next_episode_action',
  'last_error','payload','completed_at','updated_at'
].join(',');

function normalizeJob(row:JobRow):LearningLoopJob{
  const payload=row.payload as LearningLoopJobPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    publishJobId:row.publish_job_id,
    packageId:row.package_id,
    episodeId:row.episode_id,
    windowHours:Number(row.window_hours),
    dueAt:row.due_at,
    status:row.status,
    attempts:Number(row.attempts),
    stage:row.stage,
    observationId:row.observation_id??undefined,
    performanceReportId:row.performance_report_id??undefined,
    audienceReportId:row.audience_report_id??undefined,
    brainVersion:row.brain_version??undefined,
    nextEpisodePlanId:row.next_episode_plan_id??undefined,
    nextEpisodeEpisodeId:row.next_episode_episode_id??undefined,
    nextEpisodeAutomationRunId:row.next_episode_automation_run_id??undefined,
    nextEpisodeAction:row.next_episode_action??undefined,
    lastError:row.last_error??undefined,
    completedAt:row.completed_at??undefined,
    updatedAt:row.updated_at
  };
}

async function managedChannel(channelId:string):Promise<ManagedChannel|null>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload').eq('id',channelId).maybeSingle());
  return row?(row.payload as ManagedChannel):null;
}

export async function loadLearningLoopJob(jobId:string):Promise<LearningLoopJob|null>{
  const row=checked(await db().from('radar_learning_loop_jobs')
    .select(selection).eq('id',jobId).maybeSingle());
  return row?normalizeJob(row as unknown as JobRow):null;
}

export async function listLearningLoopJobs(channelId:string):Promise<LearningLoopJob[]>{
  const rows=checked(await db().from('radar_learning_loop_jobs')
    .select(selection)
    .eq('channel_id',channelId)
    .order('due_at',{ascending:false})
    .limit(300));
  return (rows??[]).map(row=>normalizeJob(row as unknown as JobRow));
}

function addHours(value:string,hours:number){
  const date=new Date(value);
  return new Date(date.getTime()+hours*3600000).toISOString();
}

export async function scheduleClosedLoopJobs(channelId?:string){
  let query=db().from('radar_youtube_publish_jobs')
    .select('id,channel_id,package_id,status,youtube_video_id,completed_at')
    .eq('status','completed')
    .not('youtube_video_id','is',null)
    .not('completed_at','is',null)
    .order('completed_at',{ascending:false})
    .limit(1000);
  if(channelId)query=query.eq('channel_id',channelId);
  const published=checked(await query)??[];
  if(!published.length)return {created:0,eligibleVideos:0};

  const channelIds=[...new Set(published.map(row=>String(row.channel_id)))];
  const packageIds=[...new Set(published.map(row=>String(row.package_id)))];

  const [channelRows,packageRows]=await Promise.all([
    db().from('radar_managed_channels').select('id,payload').in('id',channelIds),
    db().from('radar_publication_packages').select('id,episode_id').in('id',packageIds)
  ]);
  const channels=new Map((checked(channelRows)??[]).map(row=>[String(row.id),row.payload as ManagedChannel]));
  const packages=new Map((checked(packageRows)??[]).map(row=>[String(row.id),String(row.episode_id)]));

  const rows:Array<Record<string,unknown>>=[];
  let eligibleVideos=0;
  for(const publishedJob of published){
    const channel=channels.get(String(publishedJob.channel_id));
    if(!channel||!channelAutopilotLearningEnabled(channel))continue;
    const episodeId=packages.get(String(publishedJob.package_id));
    if(!episodeId)continue;
    const windows=channelLearningWindows(channel);
    if(!windows.length)continue;
    eligibleVideos++;
    const autopilot=effectiveChannelAutopilot(channel);
    for(const windowHours of windows){
      const id=crypto.randomUUID();
      const dueAt=addHours(String(publishedJob.completed_at),windowHours);
      const payload:LearningLoopJobPayload={
        kind:'learning-loop-job',
        channelId:channel.id,
        publishJobId:String(publishedJob.id),
        packageId:String(publishedJob.package_id),
        episodeId,
        windowHours,
        dueAt,
        policy:{
          autoApprovePerformance:autopilot.autoApprovePerformance,
          autoAnalyzeAudience:autopilot.autoAnalyzeAudience,
          autoApproveAudience:autopilot.autoApproveAudience
        },
        createdAt:new Date().toISOString()
      };
      rows.push({
        id,
        channel_id:channel.id,
        publish_job_id:String(publishedJob.id),
        package_id:String(publishedJob.package_id),
        episode_id:episodeId,
        window_hours:windowHours,
        due_at:dueAt,
        status:'scheduled',
        attempts:0,
        stage:'scheduled',
        payload
      });
    }
  }

  if(!rows.length)return {created:0,eligibleVideos};
  const before=checked(await db().from('radar_learning_loop_jobs')
    .select('publish_job_id,window_hours')
    .in('publish_job_id',[...new Set(rows.map(row=>String(row.publish_job_id)))])
  )??[];
  const existing=new Set(before.map(row=>String(row.publish_job_id)+':'+Number(row.window_hours)));
  const newRows=rows.filter(row=>!existing.has(String(row.publish_job_id)+':'+Number(row.window_hours)));
  if(newRows.length){
    const result=await db().from('radar_learning_loop_jobs').insert(newRows);
    if(result.error){
      if(!String(result.error.message??'').includes('radar_learning_loop_jobs_publish_job_id_window_hours_key')){
        throw new HttpError('Falha ao agendar Closed Loop Intelligence.',502);
      }
    }
  }
  return {created:newRows.length,eligibleVideos};
}

async function assertClaim(jobId:string,workerToken:string){
  const row=checked(await db().from('radar_learning_loop_jobs')
    .select(selection)
    .eq('id',jobId)
    .eq('status','processing')
    .eq('worker_token',workerToken)
    .maybeSingle());
  if(!row)throw new HttpError('Lease do Closed Loop Worker não pertence mais a esta execução.',409);
  return normalizeJob(row as unknown as JobRow);
}

async function heartbeat(jobId:string,workerToken:string,stage:string){
  await assertAutopilotControlRunning('Closed Loop Intelligence');
  const result=await db().rpc('heartbeat_learning_loop_job',{
    p_job_id:jobId,
    p_worker_token:workerToken,
    p_stage:stage,
    p_lease_seconds:900
  });
  if(result.error||result.data!==true){
    throw new HttpError('Lease do Closed Loop Worker expirou.',409);
  }
}

async function ownedUpdate(jobId:string,workerToken:string,fields:Record<string,unknown>){
  const rows=checked(await db().from('radar_learning_loop_jobs').update({
    ...fields,updated_at:new Date().toISOString()
  }).eq('id',jobId).eq('status','processing').eq('worker_token',workerToken).select('id'));
  if(!rows?.length)throw new HttpError('Lease do Closed Loop Worker expirou.',409);
}

async function finish(job:LearningLoopJob,workerToken:string,input:{
  stage:string;
  observationId:string;
  performanceReportId:string;
  audienceReportId?:string;
  brainVersion:number;
  nextEpisodePlanId?:string;
  nextEpisodeEpisodeId?:string;
  nextEpisodeAutomationRunId?:string;
  nextEpisodeAction?:LearningLoopJob['nextEpisodeAction'];
}){
  await ownedUpdate(job.id,workerToken,{
    status:'completed',
    stage:input.stage,
    observation_id:input.observationId,
    performance_report_id:input.performanceReportId,
    audience_report_id:input.audienceReportId??null,
    brain_version:input.brainVersion,
    next_episode_plan_id:input.nextEpisodePlanId??null,
    next_episode_episode_id:input.nextEpisodeEpisodeId??null,
    next_episode_automation_run_id:input.nextEpisodeAutomationRunId??null,
    next_episode_action:input.nextEpisodeAction??null,
    worker_token:null,
    lease_until:null,
    last_error:null,
    completed_at:new Date().toISOString()
  });
  return (await loadLearningLoopJob(job.id))!;
}

async function wait(job:LearningLoopJob,workerToken:string,input:{
  stage:string;
  reason:string;
  observationId?:string;
  performanceReportId?:string;
  audienceReportId?:string;
  brainVersion?:number;
}){
  await ownedUpdate(job.id,workerToken,{
    status:'waiting',
    stage:input.stage,
    observation_id:input.observationId??null,
    performance_report_id:input.performanceReportId??null,
    audience_report_id:input.audienceReportId??null,
    brain_version:input.brainVersion??null,
    last_error:input.reason.slice(0,4000),
    worker_token:null,
    lease_until:null
  });
  return (await loadLearningLoopJob(job.id))!;
}

async function reschedule(job:LearningLoopJob,workerToken:string,reason:string,hours:number){
  await ownedUpdate(job.id,workerToken,{
    status:'scheduled',
    stage:'retry-scheduled',
    due_at:new Date(Date.now()+hours*3600000).toISOString(),
    last_error:reason.slice(0,4000),
    worker_token:null,
    lease_until:null
  });
  await recordAutopilotIncident({
    area:'closed-loop',
    channelId:job.channelId,
    entityId:job.id,
    severity:'warning',
    code:'closed-loop-retry',
    message:reason,
    payload:{windowHours:job.windowHours,attempts:job.attempts,retryHours:hours}
  }).catch(()=>{});
  return (await loadLearningLoopJob(job.id))!;
}

type NextEpisodeHandoff={
  stage?:string;
  planId?:string;
  episodeId?:string;
  automationRunId?:string;
  action?:LearningLoopJob['nextEpisodeAction'];
};

async function maybeAdvanceNextEpisode(
  channel:ManagedChannel,
  job:LearningLoopJob,
  workerToken:string
):Promise<NextEpisodeHandoff>{
  if(!channelShouldAutoPlanNextEpisode(channel,job.windowHours))return {};

  await heartbeat(job.id,workerToken,'planning-next-episode');
  const generated=await generateNextEpisodePlan(channel.id);
  const plan=generated.plan;
  await ownedUpdate(job.id,workerToken,{
    next_episode_plan_id:plan.id,
    next_episode_action:'planned',
    stage:'next-episode-plan'
  });

  const autopilot=effectiveChannelAutopilot(channel);
  if(autopilot.mode!=='autonomous'||!autopilot.autoAcceptNextEpisode){
    return {
      stage:'completed-next-episode-planned',
      planId:plan.id,
      action:'planned'
    };
  }

  const issues=nextEpisodeAutoAcceptIssues(channel,plan);
  if(!issues.length){
    issues.push(...await loadAutopilotOperationalIssues(channel.id));
  }
  if(issues.length){
    return {
      stage:'completed-next-episode-review',
      planId:plan.id,
      action:'review'
    };
  }

  const candidate=plan.candidates.find(item=>item.id===plan.recommendedCandidateId);
  if(!candidate){
    return {
      stage:'completed-next-episode-review',
      planId:plan.id,
      action:'review'
    };
  }

  await heartbeat(job.id,workerToken,'accepting-next-episode');
  const accepted=await acceptNextEpisodeCandidate({
    planId:plan.id,
    candidateId:candidate.id,
    expectedVersion:plan.version,
    notes:'Aceito automaticamente pelo Autopilot após Closed Loop · janela '+job.windowHours+'h.'
  });
  if(accepted.automationError){
    throw new HttpError(
      'Next Episode foi aceito, mas Episode Automation não iniciou: '+accepted.automationError,
      502
    );
  }

  return {
    stage:accepted.automationStarted
      ?'completed-next-episode-automation'
      :'completed-next-episode-accepted',
    planId:plan.id,
    episodeId:accepted.episodeId,
    automationRunId:accepted.automationRunId,
    action:accepted.automationStarted?'automation-started':'accepted'
  };
}

function nextEpisodeConflict(error:unknown){
  return error instanceof HttpError&&error.status===409&&(
    error.message.includes('Channel Brain mudou')||
    error.message.includes('desatualizado')||
    error.message.includes('já foi aceito')
  );
}

function isAnalyticsImmature(error:unknown){
  return error instanceof HttpError&&error.status===409&&
    error.message.includes('ainda não disponibilizou métricas');
}
function needsOperator(error:unknown){
  return error instanceof HttpError&&error.status===409&&(
    error.message.includes('Reconecte')||
    error.message.includes('reautorizada')||
    error.message.includes('scope')
  );
}
function transient(error:unknown){
  return error instanceof HttpError&&[429,502,503].includes(error.status);
}
function controlPlanePaused(error:unknown){
  return error instanceof HttpError&&error.status===409&&
    error.message.includes('Autopilot Control Plane está pausado');
}

export async function processClaimedLearningLoopJob(jobId:string,workerToken:string){
  let job=await assertClaim(jobId,workerToken);
  const channel=await managedChannel(job.channelId);
  if(!channel||!channelAutopilotLearningEnabled(channel)){
    await ownedUpdate(job.id,workerToken,{
      status:'cancelled',stage:'autopilot-disabled',worker_token:null,lease_until:null,
      completed_at:new Date().toISOString()
    });
    return (await loadLearningLoopJob(job.id))!;
  }
  const policy=effectiveChannelAutopilot(channel);

  try{
    await heartbeat(job.id,workerToken,'collecting-youtube');
    const collected=await collectYouTubePerformance(job.publishJobId,{observationId:job.id});
    job=await assertClaim(job.id,workerToken);
    await ownedUpdate(job.id,workerToken,{
      observation_id:collected.observation.id,
      performance_report_id:collected.report.id,
      stage:'performance-report'
    });

    let brainVersion=0;
    let performance=collected.report;
    if(!policy.autoApprovePerformance){
      return wait(job,workerToken,{
        stage:'performance-review',
        reason:'Performance Report aguardando revisão do operador.',
        observationId:collected.observation.id,
        performanceReportId:performance.id
      });
    }

    if(performance.status!=='approved'){
      performance=await approvePerformanceReport({
        reportId:performance.id,
        expectedVersion:performance.version,
        notes:'Aprovado automaticamente pelo Closed Loop Intelligence · janela '+job.windowHours+'h.'
      });
    }
    await heartbeat(job.id,workerToken,'applying-performance-learning');
    const perfLearning=await applyPerformanceReportToBrain(performance.id);
    brainVersion=Math.max(brainVersion,perfLearning.currentVersion);

    const commentCount=collected.observation.comments.length;
    if(!policy.autoAnalyzeAudience||commentCount<3){
      const nextEpisode=await maybeAdvanceNextEpisode(channel,job,workerToken);
      return finish(job,workerToken,{
        stage:nextEpisode.stage??(
          commentCount<3?'completed-insufficient-comment-sample':'completed-performance-only'
        ),
        observationId:collected.observation.id,
        performanceReportId:performance.id,
        brainVersion,
        nextEpisodePlanId:nextEpisode.planId,
        nextEpisodeEpisodeId:nextEpisode.episodeId,
        nextEpisodeAutomationRunId:nextEpisode.automationRunId,
        nextEpisodeAction:nextEpisode.action
      });
    }

    await heartbeat(job.id,workerToken,'analyzing-audience');
    const audienceResult=await createAudienceIntelligence(performance.id);
    let audience=audienceResult.report;
    await ownedUpdate(job.id,workerToken,{
      audience_report_id:audience.id,
      stage:'audience-report'
    });

    if(!policy.autoApproveAudience){
      return wait(job,workerToken,{
        stage:'audience-review',
        reason:'Audience Intelligence aguardando revisão do operador.',
        observationId:collected.observation.id,
        performanceReportId:performance.id,
        audienceReportId:audience.id,
        brainVersion
      });
    }

    if(audience.status!=='approved'){
      audience=await approveAudienceIntelligence({
        reportId:audience.id,
        expectedVersion:audience.version,
        notes:'Aprovado automaticamente pelo Closed Loop Intelligence · janela '+job.windowHours+'h.'
      });
    }
    await heartbeat(job.id,workerToken,'applying-audience-learning');
    const audienceLearning=await applyAudienceReportToBrain(audience.id);
    brainVersion=Math.max(brainVersion,audienceLearning.currentVersion);

    const nextEpisode=await maybeAdvanceNextEpisode(channel,job,workerToken);
    return finish(job,workerToken,{
      stage:nextEpisode.stage??(
        audienceLearning.nothingToApply
          ?'completed-no-audience-learning'
          :'completed'
      ),
      observationId:collected.observation.id,
      performanceReportId:performance.id,
      audienceReportId:audience.id,
      brainVersion,
      nextEpisodePlanId:nextEpisode.planId,
      nextEpisodeEpisodeId:nextEpisode.episodeId,
      nextEpisodeAutomationRunId:nextEpisode.automationRunId,
      nextEpisodeAction:nextEpisode.action
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida no Closed Loop Intelligence.';
    job=await loadLearningLoopJob(job.id)??job;
    if(job.status!=='processing')return job;

    if(controlPlanePaused(error)){
      await ownedUpdate(job.id,workerToken,{
        status:'scheduled',
        stage:'control-plane-paused',
        due_at:new Date().toISOString(),
        last_error:message.slice(0,4000),
        worker_token:null,
        lease_until:null
      });
      return (await loadLearningLoopJob(job.id))!;
    }
    if(isAnalyticsImmature(error)){
      return reschedule(job,workerToken,message,6);
    }
    if(needsOperator(error)){
      return wait(job,workerToken,{stage:'youtube-reauth-required',reason:message});
    }
    if(nextEpisodeConflict(error)&&job.attempts<4){
      return reschedule(job,workerToken,message,1);
    }
    if(transient(error)&&job.attempts<4){
      return reschedule(job,workerToken,message,Math.min(12,Math.pow(2,job.attempts)));
    }

    await ownedUpdate(job.id,workerToken,{
      status:'failed',
      stage:'failed',
      last_error:message.slice(0,4000),
      worker_token:null,
      lease_until:null,
      completed_at:new Date().toISOString()
    });
    await recordAutopilotIncident({
      area:'closed-loop',
      channelId:job.channelId,
      entityId:job.id,
      severity:'critical',
      code:'closed-loop-failed',
      message,
      payload:{windowHours:job.windowHours,attempts:job.attempts}
    }).catch(()=>{});
    return (await loadLearningLoopJob(job.id))!;
  }
}

export async function resumeLearningLoopJob(jobId:string){
  const job=await loadLearningLoopJob(jobId);
  if(!job)throw new HttpError('Closed Loop job não encontrado.',404);
  if(!['waiting','failed'].includes(job.status)){
    throw new HttpError('Somente jobs waiting/failed podem ser retomados.',409);
  }
  checked(await db().from('radar_learning_loop_jobs').update({
    status:'scheduled',
    stage:'resumed',
    due_at:new Date().toISOString(),
    worker_token:null,
    lease_until:null,
    last_error:null,
    completed_at:null,
    updated_at:new Date().toISOString()
  }).eq('id',jobId));
  return loadLearningLoopJob(jobId);
}

export async function closedLoopChannelState(channelId:string){
  const channel=await managedChannel(channelId);
  const jobs=await listLearningLoopJobs(channelId);
  const autopilot=channel?effectiveChannelAutopilot(channel):null;
  return {
    enabled:Boolean(channel&&channelAutopilotLearningEnabled(channel)),
    settings:autopilot,
    jobs,
    scheduled:jobs.filter(job=>job.status==='scheduled').length,
    processing:jobs.filter(job=>job.status==='processing').length,
    waiting:jobs.filter(job=>job.status==='waiting').length,
    failed:jobs.filter(job=>job.status==='failed').length,
    completed:jobs.filter(job=>job.status==='completed').length,
    nextDueAt:jobs
      .filter(job=>job.status==='scheduled')
      .map(job=>job.dueAt)
      .sort()[0]??null
  };
}

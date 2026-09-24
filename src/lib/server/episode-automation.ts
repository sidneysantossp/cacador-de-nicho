import 'server-only';

import type {
  EpisodeAutomationEvent, EpisodeAutomationMode, EpisodeAutomationPolicy,
  EpisodeAutomationRun, EpisodeAutomationRunPayload, EpisodeAutomationStatus,
  EpisodeAutomationStep, EpisodeAutomationStepState
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';

type RunRow={
  id:string;channel_id:string;episode_id:string;content_project_id:string;
  mode:EpisodeAutomationMode;status:EpisodeAutomationStatus;current_step:EpisodeAutomationStep;
  attempts:number;payload:unknown;last_error:string|null;created_at:string;updated_at:string;
};

const runSelection='id,channel_id,episode_id,content_project_id,mode,status,current_step,attempts,payload,last_error,created_at,updated_at';

export const assistedAutomationPolicy:EpisodeAutomationPolicy={
  autoGenerateScript:false,
  autoApproveObjectiveGates:false,
  autoGenerateVoice:false,
  autoCreateTranscript:false,
  autoCreateScenes:false,
  autoGenerateVisualPrompts:false,
  autoGenerateVisualAssets:false,
  autoBuildTimeline:false,
  autoCreateVideoEdit:false,
  autoRender:false,
  autoRunQuality:false,
  autoCreatePackage:false,
  autoPublish:false
};

export const autonomousAutomationPolicy:EpisodeAutomationPolicy={
  autoGenerateScript:true,
  autoApproveObjectiveGates:true,
  autoGenerateVoice:true,
  autoCreateTranscript:true,
  autoCreateScenes:true,
  autoGenerateVisualPrompts:true,
  autoGenerateVisualAssets:true,
  autoBuildTimeline:true,
  autoCreateVideoEdit:true,
  autoRender:true,
  autoRunQuality:true,
  autoCreatePackage:true,
  autoPublish:false
};

const labels:Record<EpisodeAutomationStep,string>={
  content:'Content Project',
  script:'Script',
  voice:'Voice',
  transcript:'Transcript',
  scenes:'Scene Plan',
  'visual-prompts':'Visual Prompts',
  'visual-assets':'Visual Assets',
  timeline:'Timeline',
  'video-edit':'Video Edit',
  render:'Render',
  quality:'Production QA',
  packaging:'Packaging',
  publish:'Publish',
  done:'Concluído'
};

function normalizeRun(row:RunRow):EpisodeAutomationRun{
  const payload=row.payload as EpisodeAutomationRunPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    contentProjectId:row.content_project_id,
    mode:row.mode,
    status:row.status,
    currentStep:row.current_step,
    attempts:Number(row.attempts),
    lastError:row.last_error??undefined,
    createdAt:payload.createdAt??row.created_at,
    updatedAt:payload.updatedAt??row.updated_at
  };
}

function step(
  name:EpisodeAutomationStep,
  status:EpisodeAutomationStepState['status'],
  options:{
    entityId?:string;
    entityVersion?:number;
    reason?:string;
    requiresOperator?:boolean;
  }={}
):EpisodeAutomationStepState{
  return {
    step:name,
    status,
    label:labels[name],
    entityId:options.entityId,
    entityVersion:options.entityVersion,
    reason:options.reason,
    requiresOperator:options.requiresOperator??false
  };
}

function rowPayload<T=Record<string,unknown>>(row:{payload?:unknown}|null|undefined){
  return (row?.payload??{}) as T;
}

function latest<T extends {updated_at?:string;created_at?:string}>(rows:T[]|null|undefined){
  return (rows??[])[0]??null;
}

async function sourceSnapshot(run:EpisodeAutomationRun){
  const client=db();
  const [
    projectResult,scriptResult,voiceResult,transcriptResult,sceneResult,promptResult,
    assetResult,timelineResult,editResult,renderResult,qualityResult,packageResult,dnaResult
  ]=await Promise.all([
    client.from('radar_content_projects')
      .select('id,version,status,payload,updated_at')
      .eq('id',run.contentProjectId).maybeSingle(),
    client.from('radar_episode_scripts')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_voice_assets')
      .select('id,status,selected,payload,updated_at')
      .eq('episode_id',run.episodeId).eq('selected',true)
      .order('updated_at',{ascending:false}).limit(1),
    client.from('radar_transcripts')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_scene_plans')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_visual_prompt_sets')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_scene_assets')
      .select('id,scene_id,status,selected,payload,updated_at')
      .eq('episode_id',run.episodeId).eq('selected',true),
    client.from('radar_timelines')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_video_edits')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_render_jobs')
      .select('id,status,progress,stage,error,payload,updated_at')
      .eq('episode_id',run.episodeId).order('created_at',{ascending:false}).limit(1),
    client.from('radar_production_quality_reports')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_publication_packages')
      .select('id,version,status,payload,updated_at')
      .eq('episode_id',run.episodeId).order('updated_at',{ascending:false}).limit(1),
    client.from('radar_production_dna')
      .select('id,version,payload,updated_at')
      .eq('channel_id',run.channelId).maybeSingle()
  ]);

  const project=checked(projectResult);
  if(!project)throw new HttpError('Content Project do Automation Run não existe mais.',409);

  const pkg=latest(checked(packageResult)??[]);
  const publishResult=pkg
    ?await client.from('radar_youtube_publish_jobs')
      .select('id,status,progress,stage,error,payload,updated_at')
      .eq('package_id',String(pkg.id)).order('created_at',{ascending:false}).limit(1)
    :{data:[],error:null};
  const publish=latest(checked(publishResult)??[]);

  return {
    project,
    script:latest(checked(scriptResult)??[]),
    voice:latest(checked(voiceResult)??[]),
    transcript:latest(checked(transcriptResult)??[]),
    scenePlan:latest(checked(sceneResult)??[]),
    promptSet:latest(checked(promptResult)??[]),
    assets:checked(assetResult)??[],
    timeline:latest(checked(timelineResult)??[]),
    videoEdit:latest(checked(editResult)??[]),
    render:latest(checked(renderResult)??[]),
    quality:latest(checked(qualityResult)??[]),
    package:pkg,
    publish,
    productionDna:checked(dnaResult)
  };
}

export async function inspectEpisodeAutomation(run:EpisodeAutomationRun){
  const src=await sourceSnapshot(run);
  const steps:EpisodeAutomationStepState[]=[];

  const projectPayload=rowPayload<{approval?:{status?:string}}>(src.project);
  const contentApproved=src.project.status==='approved'&&projectPayload.approval?.status==='approved';
  steps.push(contentApproved
    ?step('content','completed',{entityId:String(src.project.id),entityVersion:Number(src.project.version)})
    :step('content','waiting',{
      entityId:String(src.project.id),entityVersion:Number(src.project.version),
      reason:'Revise e aprove o Content Project antes da geração do roteiro.',
      requiresOperator:true
    }));

  const script=src.script;
  if(!contentApproved){
    steps.push(step('script','pending',{reason:'Aguardando Content Project aprovado.'}));
  }else if(!script){
    steps.push(step('script','ready',{reason:'Content Project aprovado; roteiro pode ser gerado.'}));
  }else if(script.status==='approved'){
    steps.push(step('script','completed',{entityId:String(script.id),entityVersion:Number(script.version)}));
  }else{
    const payload=rowPayload<{factCheckWarnings?:string[]}>(script);
    const warnings=Array.isArray(payload.factCheckWarnings)?payload.factCheckWarnings.length:0;
    steps.push(step('script','waiting',{
      entityId:String(script.id),entityVersion:Number(script.version),
      reason:warnings
        ?'Roteiro possui '+warnings+' alerta(s) de fact-check e precisa de revisão.'
        :'Roteiro gerado; aguarda gate de aprovação.',
      requiresOperator:warnings>0||!run.policy.autoApproveObjectiveGates
    }));
  }

  const scriptApproved=script?.status==='approved';
  const voice=src.voice;
  const dnaVoice=(rowPayload<{voice?:{voiceId?:string}}>(src.productionDna).voice?.voiceId??'').trim();
  if(!scriptApproved){
    steps.push(step('voice','pending',{reason:'Aguardando roteiro aprovado.'}));
  }else if(voice?.status==='ready'){
    steps.push(step('voice','completed',{entityId:String(voice.id)}));
  }else if(!dnaVoice){
    steps.push(step('voice','blocked',{
      reason:'Production DNA não possui voiceId. Configure a voz ou faça upload manual.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('voice','ready',{reason:'Roteiro aprovado e voz configurada no Production DNA.'}));
  }

  const voiceReady=voice?.status==='ready';
  const transcript=src.transcript;
  if(!voiceReady){
    steps.push(step('transcript','pending',{reason:'Aguardando take de voz selecionado e pronto.'}));
  }else if(transcript?.status==='approved'){
    steps.push(step('transcript','completed',{entityId:String(transcript.id),entityVersion:Number(transcript.version)}));
  }else if(transcript){
    steps.push(step('transcript','waiting',{
      entityId:String(transcript.id),entityVersion:Number(transcript.version),
      reason:'Transcript criado; aguarda gate de timing/match.',
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('transcript','ready',{reason:'Take pronto; transcript pode ser criado a partir do alignment ou Scribe.'}));
  }

  const transcriptApproved=transcript?.status==='approved';
  const scenePlan=src.scenePlan;
  if(!transcriptApproved){
    steps.push(step('scenes','pending',{reason:'Aguardando transcript aprovado.'}));
  }else if(scenePlan?.status==='approved'){
    steps.push(step('scenes','completed',{entityId:String(scenePlan.id),entityVersion:Number(scenePlan.version)}));
  }else if(scenePlan){
    steps.push(step('scenes','waiting',{
      entityId:String(scenePlan.id),entityVersion:Number(scenePlan.version),
      reason:'Scene Plan criado; revise duração, cortes e exceções antes da aprovação.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('scenes','ready',{reason:'Transcript aprovado; Scene Plan pode ser criado.'}));
  }

  const sceneApproved=scenePlan?.status==='approved';
  const promptSet=src.promptSet;
  if(!sceneApproved){
    steps.push(step('visual-prompts','pending',{reason:'Aguardando Scene Plan aprovado.'}));
  }else if(!src.productionDna){
    steps.push(step('visual-prompts','blocked',{
      reason:'Production DNA é obrigatório para gerar prompts visuais.',
      requiresOperator:true
    }));
  }else if(promptSet?.status==='approved'){
    steps.push(step('visual-prompts','completed',{entityId:String(promptSet.id),entityVersion:Number(promptSet.version)}));
  }else if(promptSet){
    steps.push(step('visual-prompts','waiting',{
      entityId:String(promptSet.id),entityVersion:Number(promptSet.version),
      reason:'Prompts visuais existem; aguarda referências recorrentes e aprovação.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('visual-prompts','ready',{reason:'Scene Plan e Production DNA prontos para direção visual.'}));
  }

  const scenePayload=rowPayload<{scenes?:Array<{id?:string}>}>(scenePlan);
  const sceneIds=new Set((scenePayload.scenes??[]).map(item=>String(item.id??'')).filter(Boolean));
  const selectedReady=new Set(
    src.assets
      .filter(item=>item.selected&&item.status==='ready')
      .map(item=>String(item.scene_id))
  );
  const missingAssets=[...sceneIds].filter(id=>!selectedReady.has(id));
  const promptsUsable=Boolean(promptSet);
  if(!promptsUsable){
    steps.push(step('visual-assets','pending',{reason:'Aguardando Visual Prompt Set.'}));
  }else if(sceneIds.size>0&&missingAssets.length===0){
    steps.push(step('visual-assets','completed',{reason:String(sceneIds.size)+' cena(s) com asset selecionado e pronto.'}));
  }else{
    steps.push(step('visual-assets','ready',{
      reason:missingAssets.length
        ?String(missingAssets.length)+' cena(s) ainda sem asset selecionado.'
        :'Nenhuma cena utilizável encontrada para assets.',
      requiresOperator:!run.policy.autoGenerateVisualAssets
    }));
  }

  const assetsComplete=sceneIds.size>0&&missingAssets.length===0;
  const timeline=src.timeline;
  if(!sceneApproved||!assetsComplete){
    steps.push(step('timeline','pending',{reason:'Aguardando Scene Plan aprovado e cobertura visual completa.'}));
  }else if(timeline?.status==='approved'){
    steps.push(step('timeline','completed',{entityId:String(timeline.id),entityVersion:Number(timeline.version)}));
  }else if(timeline){
    steps.push(step('timeline','waiting',{
      entityId:String(timeline.id),entityVersion:Number(timeline.version),
      reason:'Timeline criada; aguarda gate estrutural.',
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('timeline','ready',{reason:'Fontes aprovadas e assets cobrem todas as cenas.'}));
  }

  const timelineApproved=timeline?.status==='approved';
  const edit=src.videoEdit;
  if(!timelineApproved){
    steps.push(step('video-edit','pending',{reason:'Aguardando Timeline aprovada.'}));
  }else if(edit?.status==='approved'){
    steps.push(step('video-edit','completed',{entityId:String(edit.id),entityVersion:Number(edit.version)}));
  }else if(edit){
    steps.push(step('video-edit','waiting',{
      entityId:String(edit.id),entityVersion:Number(edit.version),
      reason:'Video Edit criado; aguarda revisão de finishing.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('video-edit','ready',{reason:'Timeline aprovada; Video Edit pode ser criado.'}));
  }

  const editApproved=edit?.status==='approved';
  const render=src.render;
  if(!editApproved){
    steps.push(step('render','pending',{reason:'Aguardando Video Edit aprovado.'}));
  }else if(render?.status==='completed'){
    steps.push(step('render','completed',{entityId:String(render.id)}));
  }else if(render?.status==='queued'||render?.status==='processing'){
    steps.push(step('render','running',{
      entityId:String(render.id),
      reason:String(render.stage??render.status)+' · '+String(render.progress??0)+'%'
    }));
  }else if(render?.status==='failed'){
    steps.push(step('render','failed',{
      entityId:String(render.id),reason:String(render.error??'Render falhou.')
    }));
  }else{
    steps.push(step('render','ready',{reason:'Video Edit aprovado; render pode ser enfileirado.'}));
  }

  const renderCompleted=render?.status==='completed';
  const quality=src.quality;
  if(!renderCompleted){
    steps.push(step('quality','pending',{reason:'Aguardando render concluído.'}));
  }else if(quality?.status==='approved'){
    steps.push(step('quality','completed',{entityId:String(quality.id),entityVersion:Number(quality.version)}));
  }else if(quality?.status==='blocked'){
    steps.push(step('quality','blocked',{
      entityId:String(quality.id),entityVersion:Number(quality.version),
      reason:'Production QA encontrou blocker(s).',
      requiresOperator:true
    }));
  }else if(quality){
    steps.push(step('quality','waiting',{
      entityId:String(quality.id),entityVersion:Number(quality.version),
      reason:'Production QA exige revisão/override manual antes da liberação.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('quality','ready',{reason:'Render concluído; QA pode ser executado.'}));
  }

  const qualityApproved=quality?.status==='approved';
  const pkg=src.package;
  if(!qualityApproved){
    steps.push(step('packaging','pending',{reason:'Aguardando Production QA aprovado.'}));
  }else if(pkg?.status==='approved'){
    steps.push(step('packaging','completed',{entityId:String(pkg.id),entityVersion:Number(pkg.version)}));
  }else if(pkg){
    steps.push(step('packaging','waiting',{
      entityId:String(pkg.id),entityVersion:Number(pkg.version),
      reason:'Package criado; thumbnail/compliance/metadados exigem revisão antes da aprovação.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('packaging','ready',{reason:'Release gate aprovado; Publication Package pode ser criado.'}));
  }

  const packageApproved=pkg?.status==='approved';
  const publish=src.publish;
  if(!packageApproved){
    steps.push(step('publish','pending',{reason:'Aguardando Publication Package aprovado.'}));
  }else if(publish?.status==='completed'){
    steps.push(step('publish','completed',{entityId:String(publish.id)}));
  }else if(publish?.status==='queued'||publish?.status==='processing'){
    steps.push(step('publish','running',{
      entityId:String(publish.id),
      reason:String(publish.stage??publish.status)+' · '+String(publish.progress??0)+'%'
    }));
  }else if(publish?.status==='failed'){
    steps.push(step('publish','failed',{
      entityId:String(publish.id),reason:String(publish.error??'Publicação falhou.'),
      requiresOperator:true
    }));
  }else{
    steps.push(step('publish','waiting',{
      reason:run.policy.autoPublish
        ?'Package aprovado; publicação automática está habilitada, aguardando worker.'
        :'Package aprovado; publicação exige comando explícito do operador.',
      requiresOperator:!run.policy.autoPublish
    }));
  }

  const actionable=steps.find(item=>item.status!=='completed'&&item.status!=='skipped');
  const currentStep=actionable?.step??'done';
  const blockers=steps
    .filter(item=>item.status==='blocked'||item.status==='failed')
    .map(item=>item.label+': '+(item.reason??item.status));
  const status:EpisodeAutomationStatus=currentStep==='done'
    ?'completed'
    :actionable?.status==='failed'
      ?'failed'
      :actionable?.status==='waiting'||actionable?.status==='blocked'
        ?'waiting'
        :'active';

  return {
    steps,
    currentStep,
    blockers,
    status,
    lastDecision:currentStep==='done'
      ?'Episódio concluiu toda a linha de produção.'
      :(actionable?.reason??labels[currentStep])
  };
}

async function appendEvent(runId:string,event:Omit<EpisodeAutomationEvent,'id'|'runId'|'createdAt'>){
  checked(await db().from('radar_episode_automation_events').insert({
    run_id:runId,
    step:event.step,
    status:event.status,
    message:event.message,
    payload:event.payload
  }));
}

export async function loadEpisodeAutomationRun(runId:string):Promise<EpisodeAutomationRun|null>{
  const row=checked(await db().from('radar_episode_automation_runs')
    .select(runSelection).eq('id',runId).maybeSingle());
  return row?normalizeRun(row as RunRow):null;
}

export async function listEpisodeAutomationRuns(channelId:string){
  const rows=checked(await db().from('radar_episode_automation_runs')
    .select(runSelection).eq('channel_id',channelId)
    .order('updated_at',{ascending:false}).limit(100));
  return (rows??[]).map(row=>normalizeRun(row as RunRow));
}

export async function listEpisodeAutomationEvents(runId:string,limit=100):Promise<EpisodeAutomationEvent[]>{
  const rows=checked(await db().from('radar_episode_automation_events')
    .select('id,run_id,step,status,message,payload,created_at')
    .eq('run_id',runId).order('created_at',{ascending:false})
    .limit(Math.max(1,Math.min(limit,300))));
  return (rows??[]).map(row=>({
    id:Number(row.id),
    runId:String(row.run_id),
    step:row.step as EpisodeAutomationStep,
    status:row.status as EpisodeAutomationEvent['status'],
    message:String(row.message),
    payload:(row.payload??{}) as Record<string,unknown>,
    createdAt:String(row.created_at)
  }));
}

export async function reconcileEpisodeAutomationRun(runId:string){
  const run=await loadEpisodeAutomationRun(runId);
  if(!run)throw new HttpError('Automation Run não encontrado.',404);
  if(run.status==='cancelled')return run;

  const previousStep=run.currentStep;
  const previousStatus=run.status;
  const inspection=await inspectEpisodeAutomation(run);
  const now=new Date().toISOString();
  const payload:EpisodeAutomationRunPayload={
    kind:'episode-automation-run',
    id:run.id,
    channelId:run.channelId,
    episodeId:run.episodeId,
    contentProjectId:run.contentProjectId,
    mode:run.mode,
    policy:run.policy,
    steps:inspection.steps,
    currentStep:inspection.currentStep,
    blockers:inspection.blockers,
    lastDecision:inspection.lastDecision,
    createdAt:run.createdAt,
    updatedAt:now
  };

  checked(await db().from('radar_episode_automation_runs').update({
    status:inspection.status,
    current_step:inspection.currentStep,
    payload,
    last_error:inspection.status==='failed'?inspection.lastDecision:null,
    updated_at:now
  }).eq('id',run.id));

  if(previousStep!==inspection.currentStep||previousStatus!==inspection.status){
    await appendEvent(run.id,{
      step:inspection.currentStep,
      status:inspection.status==='completed'
        ?'completed'
        :inspection.status==='failed'
          ?'failed'
          :inspection.status==='waiting'
            ?'waiting'
            :'info',
      message:inspection.lastDecision,
      payload:{previousStep,previousStatus}
    });
  }

  return (await loadEpisodeAutomationRun(run.id))!;
}

export async function createEpisodeAutomationRun(input:{
  contentProjectId:string;
  mode:EpisodeAutomationMode;
}){
  const project=checked(await db().from('radar_content_projects')
    .select('id,channel_id,episode_id').eq('id',input.contentProjectId).maybeSingle());
  if(!project)throw new HttpError('Content Project não encontrado.',404);

  const existing=checked(await db().from('radar_episode_automation_runs')
    .select(runSelection).eq('episode_id',String(project.episode_id)).maybeSingle());
  if(existing)return reconcileEpisodeAutomationRun(String(existing.id));

  const id=crypto.randomUUID();
  const now=new Date().toISOString();
  const policy=input.mode==='autonomous'?autonomousAutomationPolicy:assistedAutomationPolicy;
  const payload:EpisodeAutomationRunPayload={
    kind:'episode-automation-run',
    id,
    channelId:String(project.channel_id),
    episodeId:String(project.episode_id),
    contentProjectId:String(project.id),
    mode:input.mode,
    policy,
    steps:[],
    currentStep:'content',
    blockers:[],
    lastDecision:'Automation Run criado; reconciliando estado dos engines.',
    createdAt:now,
    updatedAt:now
  };

  checked(await db().from('radar_episode_automation_runs').insert({
    id,
    channel_id:payload.channelId,
    episode_id:payload.episodeId,
    content_project_id:payload.contentProjectId,
    mode:input.mode,
    status:'active',
    current_step:'content',
    attempts:0,
    payload
  }));
  await appendEvent(id,{
    step:'content',
    status:'started',
    message:'Automation Run criado em modo '+input.mode+'.',
    payload:{mode:input.mode}
  });
  return reconcileEpisodeAutomationRun(id);
}

export async function updateEpisodeAutomationRun(input:{
  runId:string;
  mode?:EpisodeAutomationMode;
  policy?:Partial<EpisodeAutomationPolicy>;
}){
  const run=await loadEpisodeAutomationRun(input.runId);
  if(!run)throw new HttpError('Automation Run não encontrado.',404);
  if(run.status==='cancelled')throw new HttpError('Automation Run cancelado não pode ser alterado.',409);
  const mode=input.mode??run.mode;
  const base=mode==='autonomous'?autonomousAutomationPolicy:assistedAutomationPolicy;
  const policy:{[K in keyof EpisodeAutomationPolicy]:boolean}={
    ...base,
    ...run.policy,
    ...(input.policy??{})
  };
  const payload:EpisodeAutomationRunPayload={
    ...run,
    mode,
    policy,
    updatedAt:new Date().toISOString()
  };
  const {
    status:_status,attempts:_attempts,lastError:_lastError,...clean
  }=payload as EpisodeAutomationRun;
  checked(await db().from('radar_episode_automation_runs').update({
    mode,
    status:'active',
    worker_token:null,
    lease_until:null,
    payload:clean,
    last_error:null,
    updated_at:new Date().toISOString()
  }).eq('id',run.id));
  await appendEvent(run.id,{
    step:run.currentStep,
    status:'info',
    message:'Política de automação atualizada para modo '+mode+'.',
    payload:{mode,policy}
  });
  return reconcileEpisodeAutomationRun(run.id);
}

export async function cancelEpisodeAutomationRun(runId:string){
  const run=await loadEpisodeAutomationRun(runId);
  if(!run)throw new HttpError('Automation Run não encontrado.',404);
  if(run.status==='completed'||run.status==='cancelled')return run;
  checked(await db().from('radar_episode_automation_runs').update({
    status:'cancelled',
    worker_token:null,
    lease_until:null,
    updated_at:new Date().toISOString()
  }).eq('id',runId));
  await appendEvent(runId,{
    step:run.currentStep,
    status:'blocked',
    message:'Automation Run cancelado pelo operador.',
    payload:{}
  });
  return (await loadEpisodeAutomationRun(runId))!;
}

export async function episodeAutomationChannelState(channelId:string){
  const runs=await listEpisodeAutomationRuns(channelId);
  const reconciled:EpisodeAutomationRun[]=[];
  for(const run of runs.slice(0,25)){
    reconciled.push(await reconcileEpisodeAutomationRun(run.id));
  }
  const projects=checked(await db().from('radar_content_projects')
    .select('id,episode_id,status,payload,updated_at')
    .eq('channel_id',channelId).order('updated_at',{ascending:false}).limit(100))??[];
  const runProjects=new Set(reconciled.map(run=>run.contentProjectId));
  return {
    runs:reconciled,
    availableProjects:projects
      .filter(project=>!runProjects.has(String(project.id)))
      .map(project=>({
        id:String(project.id),
        episodeId:String(project.episode_id),
        status:String(project.status),
        title:String((project.payload as {brief?:{workingTitle?:string}})?.brief?.workingTitle??'Untitled episode'),
        updatedAt:String(project.updated_at)
      }))
  };
}

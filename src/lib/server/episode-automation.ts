import 'server-only';

import type {
  EpisodeAutomationEvent, EpisodeAutomationMode, EpisodeAutomationPolicy,
  EpisodeAutomationRun, EpisodeAutomationRunPayload, EpisodeAutomationStatus,
  EpisodeAutomationStep, EpisodeAutomationStepState
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadContentProject, saveContentProject } from './content-os';
import { generateScriptForProject, loadEpisodeScript, saveEpisodeScript } from './episode-script';
import { generateElevenLabsVoice, loadVoiceAsset } from './voice-engine';
import {
  createTranscriptFromAlignment, loadTranscript, saveTranscript, transcribeWithScribe
} from './transcription-engine';
import {
  createScenePlanFromTranscript, loadScenePlan, saveScenePlan
} from './scene-timecode';
import {
  createVisualPromptSet, generateVisualPromptDrafts,
  loadVisualPromptSet, saveVisualPromptSet
} from './visual-prompt-engine';
import {
  generateGoogleImage, listSceneAssets, resolveOwnedMediaForScene, selectSceneAsset
} from './asset-factory';
import {
  enqueueVerifiedStockJob, loadVerifiedStockJob, restartVerifiedStockJob
} from './verified-stock-jobs';
import { loadProductionDna } from './production-dna';
import { stockFallbackEligible } from '@/lib/stock-media-policy';
import {
  createTimelineFromPlan, loadTimeline, refreshTimelineFromPlan, saveTimeline
} from './timeline-engine';
import {
  createVideoEditFromTimeline, loadVideoEdit, refreshVideoEditFromTimeline, saveVideoEdit
} from './video-editor';
import { createRenderJob } from './render-engine';
import {
  approveProductionQuality, loadProductionQualityReport, runProductionQuality
} from './production-quality';
import { createPublicationPackage } from './publication-package';
import { queueYouTubePublication } from './youtube-publisher';
import {
  assertAutopilotControlRunning, loadAutopilotControl
} from './autopilot-control';
import { recordAutopilotIncident } from './autopilot-incidents';
import {
  assistedAutomationPolicy, autonomousAutomationPolicy,
  automationHttpErrorShouldHold, automationPackageSnapshotIssues,
  automationPublishSnapshotIssues, automationQualitySnapshotIssues,
  automationRenderSnapshotIssues, automationTimelineSnapshotIssues,
  automationVideoEditSnapshotIssues, episodeAutomationLabels, inspectAutomationSteps
} from '@/lib/episode-automation-policy';

type RunRow={
  id:string;channel_id:string;episode_id:string;content_project_id:string;
  mode:EpisodeAutomationMode;status:EpisodeAutomationStatus;current_step:EpisodeAutomationStep;
  attempts:number;payload:unknown;last_error:string|null;
  hold_step:EpisodeAutomationStep|null;hold_reason:string|null;hold_created_at:string|null;
  created_at:string;updated_at:string;
};

const runSelection='id,channel_id,episode_id,content_project_id,mode,status,current_step,attempts,payload,last_error,hold_step,hold_reason,hold_created_at,created_at,updated_at';

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
    holdStep:row.hold_step??undefined,
    holdReason:row.hold_reason??undefined,
    holdCreatedAt:row.hold_created_at??undefined,
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
    label:episodeAutomationLabels[name],
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
    assetResult,stockJobResult,timelineResult,editResult,renderResult,qualityResult,packageResult,dnaResult
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
    client.from('radar_verified_stock_jobs')
      .select('id,scene_id,status,result,last_error,updated_at')
      .eq('episode_id',run.episodeId)
      .order('updated_at',{ascending:false})
      .limit(100),
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
      .eq('id',run.channelId).maybeSingle()
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
    stockJobs:checked(stockJobResult)??[],
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
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));

  const script=src.script;
  if(!contentApproved){
    steps.push(step('script','pending',{reason:'Aguardando Content Project aprovado.'}));
  }else if(!script){
    steps.push(step('script','ready',{
      reason:'Content Project aprovado; roteiro pode ser gerado.',
      requiresOperator:!run.policy.autoGenerateScript
    }));
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
    steps.push(step('voice','ready',{
      reason:'Roteiro aprovado e voz configurada no Production DNA.',
      requiresOperator:!run.policy.autoGenerateVoice
    }));
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
    steps.push(step('transcript','ready',{
      reason:'Take pronto; transcript pode ser criado a partir do alignment ou Scribe.',
      requiresOperator:!run.policy.autoCreateTranscript
    }));
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
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('scenes','ready',{
      reason:'Transcript aprovado; Scene Plan pode ser criado.',
      requiresOperator:!run.policy.autoCreateScenes
    }));
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
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('visual-prompts','ready',{
      reason:'Scene Plan e Production DNA prontos para direção visual.',
      requiresOperator:!run.policy.autoGenerateVisualPrompts
    }));
  }

  const scenePayload=rowPayload<{scenes?:Array<{id?:string}>}>(scenePlan);
  const sceneIds=new Set((scenePayload.scenes??[]).map(item=>String(item.id??'')).filter(Boolean));
  const selectedReadyRows=src.assets.filter(item=>item.selected&&item.status==='ready');
  const selectedReady=new Set(selectedReadyRows.map(item=>String(item.scene_id)));
  const missingAssets=[...sceneIds].filter(id=>!selectedReady.has(id));
  const promptsUsable=Boolean(promptSet);
  const activeStockJobs=(src.stockJobs??[]).filter(item=>
    missingAssets.includes(String(item.scene_id))&&
    (item.status==='queued'||item.status==='processing')
  );
  if(!promptsUsable){
    steps.push(step('visual-assets','pending',{reason:'Aguardando Visual Prompt Set.'}));
  }else if(sceneIds.size>0&&missingAssets.length===0){
    steps.push(step('visual-assets','completed',{reason:String(sceneIds.size)+' cena(s) com asset selecionado e pronto.'}));
  }else if(activeStockJobs.length){
    steps.push(step('visual-assets','running',{
      reason:String(activeStockJobs.length)+' fallback(s) stock verificado em fila/processamento.'
    }));
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
  const timelineSnapshotIssues=timeline&&scenePlan&&promptSet
    ?automationTimelineSnapshotIssues({
      payload:timeline.payload,
      scenePlanVersion:Number(scenePlan.version),
      visualPromptSetVersion:Number(promptSet.version),
      selectedAssets:selectedReadyRows.map(item=>({
        sceneId:String(item.scene_id),
        assetId:String(item.id)
      }))
    })
    :[];
  const timelineCurrent=timelineSnapshotIssues.length===0;
  if(!sceneApproved||!assetsComplete){
    steps.push(step('timeline','pending',{reason:'Aguardando Scene Plan aprovado e cobertura visual completa.'}));
  }else if(timeline&&!timelineCurrent){
    steps.push(step('timeline','ready',{
      entityId:String(timeline.id),entityVersion:Number(timeline.version),
      reason:'Timeline desatualizada: '+timelineSnapshotIssues.join(' · ')+'. Reconstrução necessária.',
      requiresOperator:!run.policy.autoBuildTimeline
    }));
  }else if(timeline?.status==='approved'){
    steps.push(step('timeline','completed',{entityId:String(timeline.id),entityVersion:Number(timeline.version)}));
  }else if(timeline){
    steps.push(step('timeline','waiting',{
      entityId:String(timeline.id),entityVersion:Number(timeline.version),
      reason:'Timeline criada; aguarda gate estrutural.',
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('timeline','ready',{
      reason:'Fontes aprovadas e assets cobrem todas as cenas.',
      requiresOperator:!run.policy.autoBuildTimeline
    }));
  }

  const timelineApproved=timeline?.status==='approved'&&timelineCurrent;
  const edit=src.videoEdit;
  const editSnapshotIssues=edit&&timeline&&transcript
    ?automationVideoEditSnapshotIssues({
      payload:edit.payload,
      timelineId:String(timeline.id),
      timelineVersion:Number(timeline.version),
      transcriptId:String(transcript.id),
      transcriptVersion:Number(transcript.version)
    })
    :[];
  const editCurrent=editSnapshotIssues.length===0;
  if(!timelineApproved){
    steps.push(step('video-edit','pending',{reason:'Aguardando Timeline aprovada e atual.'}));
  }else if(edit&&!editCurrent){
    steps.push(step('video-edit','ready',{
      entityId:String(edit.id),entityVersion:Number(edit.version),
      reason:'Video Edit desatualizado: '+editSnapshotIssues.join(' · ')+'. Reconstrução necessária.',
      requiresOperator:!run.policy.autoCreateVideoEdit
    }));
  }else if(edit?.status==='approved'){
    steps.push(step('video-edit','completed',{entityId:String(edit.id),entityVersion:Number(edit.version)}));
  }else if(edit){
    steps.push(step('video-edit','waiting',{
      entityId:String(edit.id),entityVersion:Number(edit.version),
      reason:'Video Edit criado; aguarda revisão de finishing.',
      requiresOperator:!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('video-edit','ready',{
      reason:'Timeline aprovada; Video Edit pode ser criado.',
      requiresOperator:!run.policy.autoCreateVideoEdit
    }));
  }

  const editApproved=edit?.status==='approved'&&editCurrent;
  const render=src.render;
  const renderSnapshotIssues=render&&edit&&timeline&&transcript
    ?automationRenderSnapshotIssues({
      payload:render.payload,
      videoEditId:String(edit.id),
      videoEditVersion:Number(edit.version),
      timelineId:String(timeline.id),
      timelineVersion:Number(timeline.version),
      transcriptId:String(transcript.id),
      transcriptVersion:Number(transcript.version)
    })
    :[];
  const renderCurrent=renderSnapshotIssues.length===0;
  if(!editApproved){
    steps.push(step('render','pending',{reason:'Aguardando Video Edit aprovado e atual.'}));
  }else if(render&&!renderCurrent){
    steps.push(step('render','ready',{
      reason:'Render anterior ficou desatualizado: '+renderSnapshotIssues.join(' · ')+'.',
      requiresOperator:!run.policy.autoRender
    }));
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
    steps.push(step('render','ready',{
      reason:'Video Edit aprovado; render pode ser enfileirado.',
      requiresOperator:!run.policy.autoRender
    }));
  }

  const renderCompleted=render?.status==='completed'&&renderCurrent;
  const quality=src.quality;
  const qualitySnapshotIssues=quality&&render&&edit
    ?automationQualitySnapshotIssues({
      payload:quality.payload,
      renderJobId:String(render.id),
      videoEditId:String(edit.id),
      videoEditVersion:Number(edit.version)
    })
    :[];
  const qualityCurrent=qualitySnapshotIssues.length===0;
  if(!renderCompleted){
    steps.push(step('quality','pending',{reason:'Aguardando render concluído e atual.'}));
  }else if(quality&&!qualityCurrent){
    steps.push(step('quality','ready',{
      reason:'Production QA anterior ficou desatualizado: '+qualitySnapshotIssues.join(' · ')+'.',
      requiresOperator:!run.policy.autoRunQuality
    }));
  }else if(quality?.status==='approved'){
    steps.push(step('quality','completed',{entityId:String(quality.id),entityVersion:Number(quality.version)}));
  }else if(quality?.status==='blocked'){
    steps.push(step('quality','blocked',{
      entityId:String(quality.id),entityVersion:Number(quality.version),
      reason:'Production QA encontrou blocker(s).',
      requiresOperator:true
    }));
  }else if(quality){
    const summary=rowPayload<{summary?:{blockers?:number;manualReview?:number}}>(quality).summary;
    const blockers=Number(summary?.blockers??0);
    const manual=Number(summary?.manualReview??0);
    steps.push(step('quality','waiting',{
      entityId:String(quality.id),entityVersion:Number(quality.version),
      reason:blockers
        ?'Production QA possui '+blockers+' blocker(s).'
        :manual
          ?'Production QA possui '+manual+' item(ns) de revisão manual.'
          :'Production QA passou nos checks objetivos e pode ser liberado.',
      requiresOperator:blockers>0||manual>0||!run.policy.autoApproveObjectiveGates
    }));
  }else{
    steps.push(step('quality','ready',{
      reason:'Render concluído; QA pode ser executado.',
      requiresOperator:!run.policy.autoRunQuality
    }));
  }

  const qualityApproved=quality?.status==='approved'&&qualityCurrent;
  const pkg=src.package;
  const packageSnapshotIssues=pkg&&quality&&render
    ?automationPackageSnapshotIssues({
      payload:pkg.payload,
      qualityReportId:String(quality.id),
      qualityReportVersion:Number(quality.version),
      renderJobId:String(render.id)
    })
    :[];
  const packageCurrent=packageSnapshotIssues.length===0;
  if(!qualityApproved){
    steps.push(step('packaging','pending',{reason:'Aguardando Production QA aprovado e atual.'}));
  }else if(pkg&&!packageCurrent){
    steps.push(step('packaging','ready',{
      reason:'Publication Package anterior ficou desatualizado: '+packageSnapshotIssues.join(' · ')+'.',
      requiresOperator:!run.policy.autoCreatePackage
    }));
  }else if(pkg?.status==='approved'){
    steps.push(step('packaging','completed',{entityId:String(pkg.id),entityVersion:Number(pkg.version)}));
  }else if(pkg){
    steps.push(step('packaging','waiting',{
      entityId:String(pkg.id),entityVersion:Number(pkg.version),
      reason:'Package criado; thumbnail/compliance/metadados exigem revisão antes da aprovação.',
      requiresOperator:true
    }));
  }else{
    steps.push(step('packaging','ready',{
      reason:'Release gate aprovado; Publication Package pode ser criado.',
      requiresOperator:!run.policy.autoCreatePackage
    }));
  }

  const packageApproved=pkg?.status==='approved'&&packageCurrent;
  const publish=src.publish;
  const publishSnapshotIssues=publish&&pkg
    ?automationPublishSnapshotIssues({
      payload:publish.payload,
      packageId:String(pkg.id),
      packageVersion:Number(pkg.version)
    })
    :[];
  const publishCurrent=publishSnapshotIssues.length===0;
  if(!packageApproved){
    steps.push(step('publish','pending',{reason:'Aguardando Publication Package aprovado e atual.'}));
  }else if(publish&&!publishCurrent){
    steps.push(step('publish','waiting',{
      reason:'Job de publicação pertence a uma versão anterior do package.',
      requiresOperator:true
    }));
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

  return {
    steps,
    ...inspectAutomationSteps(steps)
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
  const holdStillApplies=!!run.holdStep&&run.holdStep===inspection.currentStep;
  if(holdStillApplies){
    const current=inspection.steps.find(item=>item.step===inspection.currentStep);
    if(current){
      current.status='blocked';
      current.requiresOperator=true;
      current.reason=run.holdReason??current.reason??'Etapa pausada por um gate anterior.';
    }
    inspection.status='waiting';
    inspection.blockers=[
      ...inspection.blockers,
      (current?.label??inspection.currentStep)+': '+(run.holdReason??'Etapa pausada.')
    ];
    inspection.lastDecision=run.holdReason??'Etapa pausada por um gate anterior.';
  }
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
    hold_step:holdStillApplies?run.holdStep:null,
    hold_reason:holdStillApplies?run.holdReason:null,
    hold_created_at:holdStillApplies?run.holdCreatedAt:null,
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
  if(input.mode==='autonomous'){
    await assertAutopilotControlRunning('Episode Automation');
  }

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
  if(mode==='autonomous'&&run.mode!=='autonomous'){
    await assertAutopilotControlRunning('Episode Automation');
  }
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

export async function resumeEpisodeAutomationRun(runId:string){
  const run=await loadEpisodeAutomationRun(runId);
  if(!run)throw new HttpError('Automation Run não encontrado.',404);
  if(run.status==='cancelled'||run.status==='completed'){
    throw new HttpError('Este Automation Run não pode ser retomado.',409);
  }
  if(run.mode==='autonomous'){
    await assertAutopilotControlRunning('Episode Automation');
  }
  checked(await db().from('radar_episode_automation_runs').update({
    status:'active',
    hold_step:null,
    hold_reason:null,
    hold_created_at:null,
    last_error:null,
    worker_token:null,
    lease_until:null,
    updated_at:new Date().toISOString()
  }).eq('id',runId));
  await appendEvent(runId,{
    step:run.currentStep,
    status:'info',
    message:'Hold removido pelo operador; run liberado para nova tentativa.',
    payload:{previousHold:run.holdReason??null}
  });
  return reconcileEpisodeAutomationRun(runId);
}


function automationOperatorHold(error:unknown){
  return error instanceof HttpError&&automationHttpErrorShouldHold(error.status);
}

async function holdAutomationRun(
  run:EpisodeAutomationRun,
  stepName:EpisodeAutomationStep,
  message:string
){
  const now=new Date().toISOString();
  checked(await db().from('radar_episode_automation_runs').update({
    status:'waiting',
    current_step:stepName,
    hold_step:stepName,
    hold_reason:message.slice(0,4000),
    hold_created_at:now,
    worker_token:null,
    lease_until:null,
    last_error:null,
    updated_at:now
  }).eq('id',run.id));
  await appendEvent(run.id,{
    step:stepName,
    status:'blocked',
    message:message.slice(0,4000),
    payload:{kind:'automation-hold'}
  });
  await recordAutopilotIncident({
    area:'episode-automation',
    channelId:run.channelId,
    entityId:run.id,
    severity:'warning',
    code:'episode-automation-hold',
    message,
    payload:{step:stepName}
  }).catch(()=>{});
  return reconcileEpisodeAutomationRun(run.id);
}

async function failAutomationRun(
  run:EpisodeAutomationRun,
  stepName:EpisodeAutomationStep,
  message:string
){
  const now=new Date().toISOString();
  checked(await db().from('radar_episode_automation_runs').update({
    status:'failed',
    current_step:stepName,
    worker_token:null,
    lease_until:null,
    last_error:message.slice(0,4000),
    updated_at:now
  }).eq('id',run.id));
  await appendEvent(run.id,{
    step:stepName,
    status:'failed',
    message:message.slice(0,4000),
    payload:{kind:'automation-failure'}
  });
  await recordAutopilotIncident({
    area:'episode-automation',
    channelId:run.channelId,
    entityId:run.id,
    severity:'critical',
    code:'episode-automation-failed',
    message,
    payload:{step:stepName}
  }).catch(()=>{});
  return (await loadEpisodeAutomationRun(run.id))!;
}

function payloadOnly<T extends {version:number;status:string}>(value:T){
  const {version:_version,status:_status,...payload}=value;
  return payload;
}

function automationStep(run:EpisodeAutomationRun,name:EpisodeAutomationStep){
  return run.steps.find(item=>item.step===name);
}

async function executeAutomationTransition(
  run:EpisodeAutomationRun,
  current:EpisodeAutomationStepState
){
  switch(current.step){
    case 'content':{
      if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática do Content Project está desativada.',409);
      const project=await loadContentProject(run.contentProjectId);
      if(!project)throw new HttpError('Content Project não encontrado.',404);
      const payload=payloadOnly(project);
      await saveContentProject({
        ...payload,
        approval:{
          ...payload.approval,
          status:'approved',
          notes:payload.approval.notes.trim()||
            'Aprovado pelo Episode Automation após passar no gate objetivo do Content OS.'
        }
      },project.version);
      return 'Content Project aprovado pelo gate objetivo.';
    }

    case 'script':{
      if(current.status==='ready'){
        if(!run.policy.autoGenerateScript)throw new HttpError('Geração automática de roteiro está desativada.',409);
        const script=await generateScriptForProject(run.contentProjectId);
        return 'Roteiro gerado como draft: '+script.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de roteiro está desativada.',409);
        if(!current.entityId)throw new HttpError('Roteiro atual não identificado.',409);
        const script=await loadEpisodeScript(current.entityId);
        if(!script)throw new HttpError('Roteiro não encontrado.',404);
        await saveEpisodeScript(payloadOnly(script),'approved',script.version);
        return 'Roteiro aprovado pelo gate objetivo.';
      }
      throw new HttpError('Roteiro não está elegível para avanço automático.',409);
    }

    case 'voice':{
      if(!run.policy.autoGenerateVoice)throw new HttpError('Geração automática de voz está desativada.',409);
      const scriptId=automationStep(run,'script')?.entityId;
      if(!scriptId)throw new HttpError('Roteiro aprovado não identificado para Voice Engine.',409);
      const asset=await generateElevenLabsVoice({scriptId});
      return 'Narração gerada e selecionada: take '+asset.take+'.';
    }

    case 'transcript':{
      if(current.status==='ready'){
        if(!run.policy.autoCreateTranscript)throw new HttpError('Criação automática de transcript está desativada.',409);
        const voiceId=automationStep(run,'voice')?.entityId;
        if(!voiceId)throw new HttpError('Take de voz selecionado não identificado.',409);
        const voice=await loadVoiceAsset(voiceId);
        if(!voice)throw new HttpError('Take de voz não encontrado.',404);
        const transcript=voice.alignment
          ?await createTranscriptFromAlignment(voice.id)
          :await transcribeWithScribe(voice.id);
        return 'Transcript criado como draft: '+transcript.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de transcript está desativada.',409);
        if(!current.entityId)throw new HttpError('Transcript atual não identificado.',409);
        const transcript=await loadTranscript(current.entityId);
        if(!transcript)throw new HttpError('Transcript não encontrado.',404);
        await saveTranscript(payloadOnly(transcript),'approved',transcript.version);
        return 'Transcript aprovado pelo gate objetivo.';
      }
      throw new HttpError('Transcript não está elegível para avanço automático.',409);
    }

    case 'scenes':{
      if(current.status==='ready'){
        if(!run.policy.autoCreateScenes)throw new HttpError('Criação automática de cenas está desativada.',409);
        const transcriptId=automationStep(run,'transcript')?.entityId;
        if(!transcriptId)throw new HttpError('Transcript aprovado não identificado.',409);
        const plan=await createScenePlanFromTranscript(transcriptId);
        return 'Scene Plan criado como draft: '+plan.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de Scene Plan está desativada.',409);
        if(!current.entityId)throw new HttpError('Scene Plan atual não identificado.',409);
        const plan=await loadScenePlan(current.entityId);
        if(!plan)throw new HttpError('Scene Plan não encontrado.',404);
        await saveScenePlan(payloadOnly(plan),'approved',plan.version);
        return 'Scene Plan aprovado pelo gate objetivo.';
      }
      throw new HttpError('Scene Plan não está elegível para avanço automático.',409);
    }

    case 'visual-prompts':{
      if(current.status==='ready'){
        if(!run.policy.autoGenerateVisualPrompts)throw new HttpError('Geração automática de prompts visuais está desativada.',409);
        const scenePlanId=automationStep(run,'scenes')?.entityId;
        if(!scenePlanId)throw new HttpError('Scene Plan aprovado não identificado.',409);
        const created=await createVisualPromptSet(scenePlanId);
        const generated=await generateVisualPromptDrafts(created.id);
        return 'Visual Prompt Set gerado como draft: '+generated.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de prompts visuais está desativada.',409);
        if(!current.entityId)throw new HttpError('Visual Prompt Set atual não identificado.',409);
        const promptSet=await loadVisualPromptSet(current.entityId);
        if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
        await saveVisualPromptSet(payloadOnly(promptSet),'approved',promptSet.version,true);
        return 'Visual Prompt Set aprovado pelo gate objetivo.';
      }
      throw new HttpError('Visual Prompt Set não está elegível para avanço automático.',409);
    }

    case 'visual-assets':{
      if(!run.policy.autoGenerateVisualAssets)throw new HttpError('Geração automática de assets visuais está desativada.',409);
      const promptSetId=automationStep(run,'visual-prompts')?.entityId;
      if(!promptSetId)throw new HttpError('Visual Prompt Set aprovado não identificado.',409);
      const [promptSet,assets]=await Promise.all([
        loadVisualPromptSet(promptSetId),
        listSceneAssets(promptSetId)
      ]);
      if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
      if(promptSet.status!=='approved')throw new HttpError('Visual Prompt Set precisa estar aprovado.',409);
      const selectedReady=new Set(
        assets.filter(asset=>asset.selected&&asset.status==='ready'&&!asset.stale)
          .map(asset=>asset.sceneId)
      );
      const target=promptSet.scenePrompts.find(item=>!selectedReady.has(item.sceneId));
      if(!target)return 'Todos os assets visuais já estão cobertos.';

      const libraryFirst=await resolveOwnedMediaForScene({
        promptSetId:promptSet.id,
        sceneId:target.sceneId
      });
      if(libraryFirst.status==='matched'){
        return 'Library First selecionou mídia OWNED para '+target.timecodeLabel+
          ' · score '+libraryFirst.match.score.toFixed(3)+
          ' · trim '+libraryFirst.match.sourceStartSeconds.toFixed(2)+
          '–'+libraryFirst.match.sourceEndSeconds.toFixed(2)+'s.';
      }
      if(libraryFirst.status==='skipped'){
        return 'A cena '+target.timecodeLabel+' já possui mídia selecionada e atual.';
      }

      const stockInstruction=[target.direction,target.prompt].filter(Boolean).join(' ');
      if(stockFallbackEligible(stockInstruction)){
        const dna=await loadProductionDna(promptSet.channelId);
        const orientation=!dna||dna.format.width===dna.format.height
          ?'any'
          :dna.format.width>dna.format.height?'landscape':'portrait';
        const query=libraryFirst.query||target.direction||target.prompt;
        const existingJob=await loadVerifiedStockJob(promptSet.id,target.sceneId);

        if(existingJob&&(existingJob.status==='queued'||existingJob.status==='processing')){
          return 'Fallback stock verificado já está em fila/processamento para '+target.timecodeLabel+'.';
        }

        if(existingJob?.status==='completed'){
          const result=existingJob.result as {status?:string;provider?:string;combinedScore?:number};
          if(result.status==='matched'||result.status==='skipped'){
            const reopened=await restartVerifiedStockJob(existingJob.id);
            return 'Asset stock anterior não está mais selecionado; job reaberto para '+
              target.timecodeLabel+' · '+reopened.id+'.';
          }
          if(result.status==='gap'){
            throw new HttpError(
              'Nenhum stock real passou pela validação visual para '+target.timecodeLabel+
              '. A cena exige footage real e não pode cair em geração sintética.',
              409
            );
          }
        }

        if(existingJob?.status==='failed'){
          throw new HttpError(
            'O fallback stock falhou para '+target.timecodeLabel+
            (existingJob.lastError?' · '+existingJob.lastError:'')+
            '. A cena exige footage real.',
            409
          );
        }

        if(!existingJob||existingJob.status!=='completed'&&existingJob.status!=='failed'){
          const queued=await enqueueVerifiedStockJob({
            promptSetId:promptSet.id,
            sceneId:target.sceneId,
            query,
            desiredDurationSeconds:Math.max(.25,target.endSeconds-target.startSeconds),
            orientation,
            providers:['pexels','pixabay'],
            maxCandidatesPerProvider:2
          });
          return 'Fallback stock verificado enfileirado para '+target.timecodeLabel+
            ' · job '+queued.id+'.';
        }
      }

      const asset=await generateGoogleImage({
        promptSetId:promptSet.id,
        sceneId:target.sceneId,
        imageSize:'2K'
      });
      if(!asset)throw new HttpError('A geração visual não retornou asset persistido.',502);
      await selectSceneAsset(asset.id);
      return 'Library First sem match forte ('+libraryFirst.reason+'). '+
        'Fallback gerou e selecionou asset visual para '+target.timecodeLabel+'.';
    }

    case 'timeline':{
      if(current.status==='ready'){
        if(!run.policy.autoBuildTimeline)throw new HttpError('Montagem automática de Timeline está desativada.',409);
        const scenePlanId=automationStep(run,'scenes')?.entityId;
        if(!scenePlanId)throw new HttpError('Scene Plan aprovado não identificado.',409);
        const timeline=current.entityId
          ?await refreshTimelineFromPlan(scenePlanId)
          :await createTimelineFromPlan(scenePlanId);
        return current.entityId
          ?'Timeline reconstruída como draft: '+timeline.id+' · v'+timeline.version+'.'
          :'Timeline criada como draft: '+timeline.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de Timeline está desativada.',409);
        if(!current.entityId)throw new HttpError('Timeline atual não identificada.',409);
        const timeline=await loadTimeline(current.entityId);
        if(!timeline)throw new HttpError('Timeline não encontrada.',404);
        await saveTimeline(payloadOnly(timeline),'approved',timeline.version);
        return 'Timeline aprovada pelo gate objetivo.';
      }
      throw new HttpError('Timeline não está elegível para avanço automático.',409);
    }

    case 'video-edit':{
      if(current.status==='ready'){
        if(!run.policy.autoCreateVideoEdit)throw new HttpError('Criação automática de Video Edit está desativada.',409);
        const timelineId=automationStep(run,'timeline')?.entityId;
        if(!timelineId)throw new HttpError('Timeline aprovada não identificada.',409);
        const edit=current.entityId
          ?await refreshVideoEditFromTimeline(timelineId)
          :await createVideoEditFromTimeline(timelineId);
        return current.entityId
          ?'Video Edit reconstruído como draft: '+edit.id+' · v'+edit.version+'.'
          :'Video Edit criado como draft: '+edit.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Aprovação automática de Video Edit está desativada.',409);
        if(!current.entityId)throw new HttpError('Video Edit atual não identificado.',409);
        const edit=await loadVideoEdit(current.entityId);
        if(!edit)throw new HttpError('Video Edit não encontrado.',404);
        await saveVideoEdit(payloadOnly(edit),'approved',edit.version);
        return 'Video Edit aprovado pelo gate objetivo.';
      }
      throw new HttpError('Video Edit não está elegível para avanço automático.',409);
    }

    case 'render':{
      if(!run.policy.autoRender)throw new HttpError('Render automático está desativado.',409);
      const videoEditId=automationStep(run,'video-edit')?.entityId;
      if(!videoEditId)throw new HttpError('Video Edit aprovado não identificado.',409);
      const job=await createRenderJob({videoEditId,preset:'hd-1080p30'});
      return 'Render enfileirado: '+job.id+'.';
    }

    case 'quality':{
      if(current.status==='ready'){
        if(!run.policy.autoRunQuality)throw new HttpError('Production QA automático está desativado.',409);
        const renderId=automationStep(run,'render')?.entityId;
        if(!renderId)throw new HttpError('Render concluído não identificado.',409);
        const report=await runProductionQuality(renderId);
        return 'Production QA executado: '+report.id+'.';
      }
      if(current.status==='waiting'){
        if(!run.policy.autoApproveObjectiveGates)throw new HttpError('Liberação automática do Production QA está desativada.',409);
        if(!current.entityId)throw new HttpError('Production QA atual não identificado.',409);
        const report=await loadProductionQualityReport(current.entityId);
        if(!report)throw new HttpError('Production QA não encontrado.',404);
        if(report.summary.blockers>0||report.summary.manualReview>0){
          throw new HttpError('Production QA exige correção ou revisão humana antes da aprovação.',409);
        }
        await approveProductionQuality({
          reportId:report.id,
          expectedVersion:report.version,
          notes:'Aprovado pelo Episode Automation: todos os checks objetivos passaram sem revisão manual.',
          overrides:[]
        });
        return 'Production QA aprovado automaticamente sem overrides.';
      }
      throw new HttpError('Production QA não está elegível para avanço automático.',409);
    }

    case 'packaging':{
      if(!run.policy.autoCreatePackage)throw new HttpError('Criação automática de Packaging está desativada.',409);
      const reportId=automationStep(run,'quality')?.entityId;
      if(!reportId)throw new HttpError('Production QA aprovado não identificado.',409);
      const pkg=await createPublicationPackage(reportId);
      return 'Publication Package criado como draft: '+pkg.id+'.';
    }

    case 'publish':{
      if(!run.policy.autoPublish)throw new HttpError('Publicação automática está desativada por policy.',409);
      const packageId=automationStep(run,'packaging')?.entityId;
      if(!packageId)throw new HttpError('Publication Package aprovado não identificado.',409);
      const job=await queueYouTubePublication(packageId);
      return 'Publicação YouTube enfileirada: '+job.id+'.';
    }

    case 'done':
      return 'Episódio já concluiu toda a linha de produção.';

    default:
      throw new HttpError('Etapa de automação não suportada.',409);
  }
}

async function assertAutomationAdvanceLease(runId:string,workerToken?:string){
  const row=checked(await db().from('radar_episode_automation_runs')
    .select('id,mode,status,worker_token,lease_until')
    .eq('id',runId)
    .maybeSingle());
  if(!row)throw new HttpError('Automation Run não encontrado.',404);

  const token=row.worker_token?String(row.worker_token):'';
  const leaseUntil=row.lease_until?Date.parse(String(row.lease_until)):0;
  const activeLease=Boolean(token)&&Number.isFinite(leaseUntil)&&leaseUntil>Date.now();

  if(workerToken){
    if(String(row.mode)!=='autonomous'){
      throw new HttpError('Worker só pode avançar runs Autonomous.',409);
    }
    if(!activeLease||token!==workerToken){
      throw new HttpError('Lease do Automation Worker expirou ou não pertence a este executor.',409);
    }
    return;
  }

  if(activeLease){
    throw new HttpError('Automation Run já está sendo processado pelo worker.',409);
  }
}

async function releaseAutomationLease(runId:string,workerToken:string){
  const result=await db().from('radar_episode_automation_runs').update({
    worker_token:null,
    lease_until:null,
    updated_at:new Date().toISOString()
  }).eq('id',runId).eq('worker_token',workerToken);
  if(result.error)throw new HttpError('Falha ao liberar lease do Automation Worker.',502);
}

export async function advanceEpisodeAutomationRun(runId:string,workerToken?:string){
  await assertAutomationAdvanceLease(runId,workerToken);
  let run=await reconcileEpisodeAutomationRun(runId);
  if(run.status==='completed'||run.status==='cancelled')return run;
  if(workerToken&&run.status==='waiting')return run;
  if(run.holdStep){
    throw new HttpError('Automation Run pausado: '+(run.holdReason??'remova o hold antes de continuar.'),409);
  }

  const current=run.steps.find(item=>item.step===run.currentStep);
  if(!current)throw new HttpError('Etapa atual do Automation Run não foi encontrada.',409);
  if(current.requiresOperator){
    throw new HttpError(current.reason??'Esta etapa exige ação do operador.',409);
  }
  if(current.status==='running'){
    return run;
  }
  if(!['ready','waiting'].includes(current.status)){
    throw new HttpError(current.reason??'A etapa atual ainda não está pronta para avançar.',409);
  }

  await appendEvent(run.id,{
    step:current.step,
    status:'started',
    message:'Executor iniciou '+current.label+'.',
    payload:{stepStatus:current.status}
  });

  try{
    const message=await executeAutomationTransition(run,current);
    await appendEvent(run.id,{
      step:current.step,
      status:'completed',
      message,
      payload:{stepStatus:current.status}
    });
    run=await reconcileEpisodeAutomationRun(run.id);
    return run;
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida no Automation executor.';
    if(automationOperatorHold(error)){
      return holdAutomationRun(run,current.step,message);
    }
    return failAutomationRun(run,current.step,message);
  }
}

export async function advanceClaimedEpisodeAutomationRun(runId:string,workerToken:string){
  const control=await loadAutopilotControl();
  if(control.status!=='running'){
    const run=await loadEpisodeAutomationRun(runId);
    if(run&&run.status!=='completed'&&run.status!=='cancelled'){
      const now=new Date().toISOString();
      const rows=checked(await db().from('radar_episode_automation_runs').update({
        status:'active',
        worker_token:null,
        lease_until:null,
        updated_at:now
      }).eq('id',runId).eq('worker_token',workerToken).select('id'));
      if(rows?.length){
        await appendEvent(runId,{
          step:run.currentStep,
          status:'info',
          message:'Control Plane pausado; run devolvido à fila sem avançar.',
          payload:{
            kind:'control-plane-pause',
            controlVersion:control.version,
            pauseReason:control.pauseReason
          }
        });
      }
    }
    return (await loadEpisodeAutomationRun(runId))!;
  }

  try{
    return await advanceEpisodeAutomationRun(runId,workerToken);
  }catch(error){
    const message=error instanceof Error?error.message:'Falha desconhecida no Automation Worker.';
    if(error instanceof HttpError&&message.includes('Lease do Automation Worker')){
      throw error;
    }
    const run=await loadEpisodeAutomationRun(runId).catch(()=>null);
    if(!run||run.status==='completed'||run.status==='cancelled')throw error;
    if(automationOperatorHold(error)){
      return holdAutomationRun(run,run.currentStep,message);
    }
    return failAutomationRun(run,run.currentStep,message);
  }finally{
    await releaseAutomationLease(runId,workerToken).catch(()=>{});
  }
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

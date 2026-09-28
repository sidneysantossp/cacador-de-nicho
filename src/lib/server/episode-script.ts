import 'server-only';

import type {
  ContentProject, EpisodeScript, EpisodeScriptGeneration, EpisodeScriptListItem,
  EpisodeScriptPayload, EpisodeScriptSection, EpisodeScriptVersion,
  EpisodeScriptVersionSummary, ManagedChannel
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadContentProject } from './content-os';
import { loadChannelBrain } from './channel-brain';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import { loadProductionDna } from './production-dna';
import {
  generateOwnedPlannedSection, planOwnedChannelScript, regenerateOwnedScriptSection
} from './script-ai';
import {
  normalizeScriptPayload, scriptApprovalIssues, scriptGenerationIntegrityIssues
} from '@/lib/script-policy';

function normalize(row:{
  id:string;
  channel_id:string;
  episode_id:string;
  content_project_id:string;
  version:number;
  status:EpisodeScript['status'];
  payload:unknown;
  created_at:string;
  updated_at:string;
}):EpisodeScript{
  const payload=row.payload as EpisodeScriptPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    contentProjectId:row.content_project_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

function normalizeListRow(row:{
  id:string;channel_id:string;episode_id:string;content_project_id:string;version:number|string;
  status:EpisodeScript['status'];title:string;language:string;word_count:number|string;
  estimated_minutes:number|string|null;section_count:number|string;
  generated_by:EpisodeScriptPayload['provenance']['generatedBy'];character_count:number|string;
  created_at:string;updated_at:string;
}):EpisodeScriptListItem{
  return {
    id:row.id,channelId:row.channel_id,episodeId:row.episode_id,contentProjectId:row.content_project_id,
    version:Number(row.version),status:row.status,title:String(row.title),language:String(row.language),
    wordCount:Number(row.word_count),estimatedMinutes:row.estimated_minutes===null?null:Number(row.estimated_minutes),
    sectionCount:Number(row.section_count),generatedBy:row.generated_by,
    characterCount:Number(row.character_count),createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

export async function loadEpisodeScripts(channelId:string):Promise<EpisodeScriptListItem[]>{
  const rows=checked(await db().from('radar_episode_script_list')
    .select('id,channel_id,episode_id,content_project_id,version,status,title,language,word_count,estimated_minutes,section_count,generated_by,character_count,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeListRow(row as never));
}

export async function loadEpisodeScript(scriptId:string):Promise<EpisodeScript|null>{
  const row=checked(await db().from('radar_episode_scripts')
    .select('id,channel_id,episode_id,content_project_id,version,status,payload,created_at,updated_at')
    .eq('id',scriptId)
    .maybeSingle());
  return row?normalize(row as never):null;
}

export async function loadEpisodeScriptByProject(projectId:string):Promise<EpisodeScript|null>{
  const row=checked(await db().from('radar_episode_scripts')
    .select('id,channel_id,episode_id,content_project_id,version,status,payload,created_at,updated_at')
    .eq('content_project_id',projectId)
    .maybeSingle());
  return row?normalize(row as never):null;
}

export async function loadEpisodeScriptHistory(scriptId:string,limit=20):Promise<EpisodeScriptVersionSummary[]>{
  const rows=checked(await db().from('radar_episode_script_version_list')
    .select('version,status,word_count,section_count,created_at')
    .eq('script_id',scriptId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as EpisodeScript['status'],
    wordCount:Number(row.word_count),
    sectionCount:Number(row.section_count),
    createdAt:String(row.created_at)
  }));
}

export async function loadEpisodeScriptHistoryVersion(
  scriptId:string,
  version:number
):Promise<EpisodeScriptVersion|null>{
  const row=checked(await db().from('radar_episode_script_versions')
    .select('version,status,payload,created_at')
    .eq('script_id',scriptId)
    .eq('version',version)
    .maybeSingle());
  if(!row)return null;
  return {
    version:Number(row.version),
    status:row.status as EpisodeScript['status'],
    payload:row.payload as EpisodeScriptPayload,
    createdAt:String(row.created_at)
  };
}

async function managedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels').select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  const payload=row.payload as ManagedChannel & {kind?:string};
  if(payload.kind==='competitor')throw new HttpError('Script Engine é exclusivo para canais próprios.',409);
  return payload;
}

function contentProjectApproved(project:ContentProject){
  const approval=(project as ContentProject & {approval?:{status?:string}}).approval;
  return project.status==='approved'&&(!approval||approval.status==='approved');
}

async function scriptContext(project:ContentProject){
  if(!contentProjectApproved(project)){
    throw new HttpError('Aprove o Content Project antes de gerar o roteiro.',409);
  }
  const [channel,brain,bundle,productionDna]=await Promise.all([
    managedChannel(project.channelId),
    loadChannelBrain(project.channelId),
    loadNarrativeBundle(project.channelId),
    loadProductionDna(project.channelId)
  ]);
  const episode=bundle.episodes.find(item=>item.id===project.episodeId);
  if(!episode)throw new HttpError('Episódio não encontrado.',404);
  return {channel,brain,episode,project,productionDna};
}

export async function saveEpisodeScript(
  payload:EpisodeScriptPayload,
  status:EpisodeScript['status'],
  expectedVersion:number|null
):Promise<EpisodeScript>{
  const project=await loadContentProject(payload.contentProjectId);
  if(!project||project.channelId!==payload.channelId||project.episodeId!==payload.episodeId){
    throw new HttpError('Content Project incompatível com o roteiro.',409);
  }
  if(!contentProjectApproved(project)){
    throw new HttpError('O Content Project precisa estar aprovado antes de salvar o roteiro.',409);
  }

  const productionDna=await loadProductionDna(payload.channelId);
  const normalized=normalizeScriptPayload({
    ...payload,
    createdAt:(await loadEpisodeScript(payload.id))?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  },productionDna?.voice.paceWpm??null);

  if(status==='approved'){
    const issues=scriptApprovalIssues(normalized,{
      claims:project.research?.factChecks??[],
      documentaryMode:Boolean(
        productionDna?.research?.documentaryMode||
        productionDna?.research?.requireClaimLedger
      )
    });
    if(issues.length)throw new HttpError('Roteiro ainda não pode ser aprovado: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_episode_script',{
    p_script_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_content_project_id:normalized.contentProjectId,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('episode script version conflict'))throw new HttpError('Roteiro desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('content project not approved'))throw new HttpError('O Content Project precisa estar aprovado.',409);
    if(message.includes('episode already has script')||message.includes('content project already has script'))throw new HttpError('Este episódio já possui um Script Engine ativo.',409);
    throw new HttpError('Falha ao salvar o roteiro no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o roteiro.',502);

  if(status==='approved'){
    const bundle=await loadNarrativeBundle(normalized.channelId);
    const episode=bundle.episodes.find(item=>item.id===normalized.episodeId);
    if(episode&&episode.status!=='scripted'){
      await saveChannelEpisode({...episode,status:'scripted',updatedAt:new Date().toISOString()});
    }
  }

  return {...normalized,version,status};
}

export async function operatorScriptContext(projectId:string){
  const project=await loadContentProject(projectId);
  if(!project)throw new HttpError('Content Project não encontrado.',404);
  const context=await scriptContext(project);
  const existingScript=await loadEpisodeScriptByProject(project.id);
  return {
    projectVersion:project.version,
    brainVersion:context.brain?.version??0,
    channel:context.channel,
    brain:context.brain,
    episode:context.episode,
    project:context.project,
    productionDna:context.productionDna,
    existingScript
  };
}

export async function importOperatorScript(input:{
  projectId:string;
  expectedProjectVersion:number;
  expectedBrainVersion:number;
  expectedScriptVersion:number;
  title:string;
  language:string;
  sections:Array<{
    label:string;
    purpose:string;
    content:string;
    claimIds?:string[];
  }>;
  continuityNotes:string[];
  factCheckWarnings:string[];
}):Promise<EpisodeScript>{
  const project=await loadContentProject(input.projectId);
  if(!project)throw new HttpError('Content Project não encontrado.',404);
  if(project.version!==input.expectedProjectVersion){
    throw new HttpError('O Content Project mudou. Recarregue o contexto antes de importar o roteiro.',409);
  }
  const context=await scriptContext(project);
  const brainVersion=context.brain?.version??0;
  if(brainVersion!==input.expectedBrainVersion){
    throw new HttpError('O Channel Brain mudou. Recarregue o contexto antes de importar o roteiro.',409);
  }

  const existing=await loadEpisodeScriptByProject(project.id);
  const currentVersion=existing?.version??0;
  if(currentVersion!==input.expectedScriptVersion){
    throw new HttpError('O roteiro mudou. Recarregue antes de importar uma nova versão.',409);
  }

  const now=new Date().toISOString();
  const payload:EpisodeScriptPayload={
    kind:'episode-script',
    id:existing?.id??crypto.randomUUID(),
    channelId:project.channelId,
    episodeId:project.episodeId,
    contentProjectId:project.id,
    title:input.title,
    language:input.language,
    sections:input.sections.map(section=>({
      id:crypto.randomUUID(),
      label:section.label,
      purpose:section.purpose,
      content:section.content,
      claimIds:section.claimIds??[]
    })),
    content:'',
    wordCount:1,
    estimatedMinutes:null,
    continuityNotes:input.continuityNotes,
    factCheckWarnings:input.factCheckWarnings,
    provenance:{generatedBy:'chatgpt',model:'chatgpt-operator'},
    createdAt:existing?.createdAt??now,
    updatedAt:now
  };
  return saveEpisodeScript(payload,'draft',currentVersion);
}

export async function generateScriptForProject(projectId:string):Promise<EpisodeScript>{
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use a importação do ChatGPT.',409);
  const project=await loadContentProject(projectId);
  if(!project)throw new HttpError('Content Project não encontrado.',404);
  const context=await scriptContext(project);
  const existing=await loadEpisodeScriptByProject(project.id);
  const now=new Date().toISOString();

  if(existing?.generation?.stage==='complete')return existing;

  if(!existing?.generation){
    if(existing?.sections.length){
      throw new HttpError(
        'Este roteiro já possui conteúdo sem estado de geração resumível. Continue pelo editor ou crie uma nova versão manualmente.',
        409
      );
    }

    const outline=await planOwnedChannelScript(context);
    const generation:EpisodeScriptGeneration={
      stage:'sections',
      targetWords:outline.targetWords,
      completedSections:0,
      totalSections:outline.sectionPlans.length,
      sectionPlans:outline.sectionPlans,
      sectionSummaries:[],
      updatedAt:now
    };
    const firstPlan=generation.sectionPlans[0];
    if(!firstPlan)throw new HttpError('O outline não retornou seções utilizáveis.',502);
    const generated=await generateOwnedPlannedSection(context,generation,[],0);
    const firstSection:EpisodeScriptSection={
      id:firstPlan.id,
      label:firstPlan.label,
      purpose:firstPlan.purpose,
      content:generated.content,
      claimIds:generated.claimIds
    };
    const completedSections=1;
    const completed=completedSections>=generation.totalSections;
    const nextGeneration:EpisodeScriptGeneration={
      ...generation,
      stage:completed?'complete':'sections',
      completedSections,
      sectionSummaries:[generated.continuitySummary],
      updatedAt:new Date().toISOString()
    };
    const warnings=generated.factCheckWarnings.map(
      item=>'section:'+firstPlan.id+': '+item
    );
    const payload:EpisodeScriptPayload={
      kind:'episode-script',
      id:existing?.id??crypto.randomUUID(),
      channelId:project.channelId,
      episodeId:project.episodeId,
      contentProjectId:project.id,
      title:outline.title||project.brief.workingTitle,
      language:context.productionDna?.voice.language||'English',
      sections:[firstSection],
      content:'',
      wordCount:1,
      estimatedMinutes:null,
      continuityNotes:outline.continuityNotes,
      factCheckWarnings:warnings,
      generation:nextGeneration,
      provenance:{generatedBy:'platform',model:generated.model||outline.model},
      createdAt:existing?.createdAt??now,
      updatedAt:now
    };
    return saveEpisodeScript(payload,'draft',existing?.version??0);
  }

  const generation=existing.generation;
  const integrityIssues=scriptGenerationIntegrityIssues(existing);
  if(integrityIssues.length){
    throw new HttpError(
      'A geração resumível do roteiro ficou inconsistente: '+integrityIssues.join(' · ')+
      '. Restaure a seção planejada removida antes de continuar.',
      409
    );
  }
  const sectionIndex=Math.max(0,Math.min(
    generation.completedSections,
    generation.totalSections
  ));
  if(sectionIndex>=generation.totalSections){
    return saveEpisodeScript({
      ...existing,
      generation:{
        ...generation,
        stage:'complete',
        completedSections:generation.totalSections,
        updatedAt:now
      },
      updatedAt:now
    },'draft',existing.version);
  }

  const plan=generation.sectionPlans[sectionIndex];
  if(!plan)throw new HttpError('A próxima seção planejada não foi encontrada.',409);
  const generated=await generateOwnedPlannedSection(
    context,generation,existing.sections,sectionIndex
  );
  const nextSection:EpisodeScriptSection={
    id:plan.id,
    label:plan.label,
    purpose:plan.purpose,
    content:generated.content,
    claimIds:generated.claimIds
  };
  const sections=[
    ...existing.sections.filter(section=>section.id!==plan.id),
    nextSection
  ];
  const completedSections=Math.min(
    generation.totalSections,
    sectionIndex+1
  );
  const complete=completedSections>=generation.totalSections;
  const warnings=[
    ...existing.factCheckWarnings.filter(
      item=>!item.startsWith('section:'+plan.id+':')
    ),
    ...generated.factCheckWarnings.map(
      item=>'section:'+plan.id+': '+item
    )
  ];

  return saveEpisodeScript({
    ...existing,
    sections,
    factCheckWarnings:warnings,
    generation:{
      ...generation,
      stage:complete?'complete':'sections',
      completedSections,
      sectionSummaries:[
        ...generation.sectionSummaries.slice(0,sectionIndex),
        generated.continuitySummary
      ],
      updatedAt:now
    },
    provenance:{generatedBy:'platform',model:generated.model},
    updatedAt:now
  },'draft',existing.version);
}

export async function regenerateScriptSection(scriptId:string,sectionId:string):Promise<EpisodeScript>{
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use a importação do ChatGPT.',409);
  const script=await loadEpisodeScript(scriptId);
  if(!script)throw new HttpError('Roteiro não encontrado.',404);
  const project=await loadContentProject(script.contentProjectId);
  if(!project)throw new HttpError('Content Project não encontrado.',404);
  const context=await scriptContext(project);
  const rewritten=await regenerateOwnedScriptSection(context,script,sectionId);
  const sections=script.sections.map(section=>section.id===sectionId?{
    ...section,
    purpose:rewritten.purpose||section.purpose,
    content:rewritten.content,
    claimIds:rewritten.claimIds
  }:section);
  const warnings=[
    ...script.factCheckWarnings.filter(item=>!item.startsWith('section:'+sectionId+':')),
    ...rewritten.factCheckWarnings.map(item=>'section:'+sectionId+': '+item)
  ];
  return saveEpisodeScript({
    ...script,
    sections,
    factCheckWarnings:warnings,
    provenance:{generatedBy:'platform',model:rewritten.model},
    updatedAt:new Date().toISOString()
  },'draft',script.version);
}

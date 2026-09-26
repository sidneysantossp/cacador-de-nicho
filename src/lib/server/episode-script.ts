import 'server-only';

import type {
  ContentProject, EpisodeScript, EpisodeScriptPayload, EpisodeScriptVersion,
  ManagedChannel
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadContentProject } from './content-os';
import { loadChannelBrain } from './channel-brain';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import { loadProductionDna } from './production-dna';
import { generateOwnedChannelScript, regenerateOwnedScriptSection } from './script-ai';
import { normalizeScriptPayload, scriptApprovalIssues } from '@/lib/script-policy';

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

export async function loadEpisodeScripts(channelId:string):Promise<EpisodeScript[]>{
  const rows=checked(await db().from('radar_episode_scripts')
    .select('id,channel_id,episode_id,content_project_id,version,status,payload,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalize(row as never));
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

export async function loadEpisodeScriptHistory(scriptId:string,limit=20):Promise<EpisodeScriptVersion[]>{
  const rows=checked(await db().from('radar_episode_script_versions')
    .select('version,status,payload,created_at')
    .eq('script_id',scriptId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as EpisodeScript['status'],
    payload:row.payload as EpisodeScriptPayload,
    createdAt:String(row.created_at)
  }));
}

async function managedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels').select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  const payload=row.payload as ManagedChannel & {kind?:string};
  if(payload.kind==='competitor')throw new HttpError('Script Engine é exclusivo para canais próprios.',409);
  return payload;
}

async function scriptContext(project:ContentProject){
  if(project.status!=='approved'||project.approval.status!=='approved'){
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
  if(project.status!=='approved'||project.approval.status!=='approved'){
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
      claims:project.research.factChecks,
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

export async function generateScriptForProject(projectId:string):Promise<EpisodeScript>{
  const project=await loadContentProject(projectId);
  if(!project)throw new HttpError('Content Project não encontrado.',404);
  const context=await scriptContext(project);
  const generated=await generateOwnedChannelScript(context);
  const existing=await loadEpisodeScriptByProject(project.id);
  const now=new Date().toISOString();
  const payload:EpisodeScriptPayload={
    kind:'episode-script',
    id:existing?.id??crypto.randomUUID(),
    channelId:project.channelId,
    episodeId:project.episodeId,
    contentProjectId:project.id,
    title:generated.title||project.brief.workingTitle,
    language:context.productionDna?.voice.language||'English',
    sections:generated.sections,
    content:'',
    wordCount:1,
    estimatedMinutes:null,
    continuityNotes:generated.continuityNotes,
    factCheckWarnings:generated.factCheckWarnings,
    provenance:{generatedBy:'platform',model:generated.model},
    createdAt:existing?.createdAt??now,
    updatedAt:now
  };
  return saveEpisodeScript(payload,'draft',existing?.version??0);
}

export async function regenerateScriptSection(scriptId:string,sectionId:string):Promise<EpisodeScript>{
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

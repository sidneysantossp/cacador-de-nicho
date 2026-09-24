import 'server-only';

import type { Decision, ManagedChannel, UniversePilotHandoff } from '@/lib/types';
import { buildUniversePilotContentHandoff, resolveUniversePilotDecision } from '@/lib/universe-pilot';
import { checked, db, put } from './db';
import { HttpError } from './auth';
import { loadChannelBrain } from './channel-brain';
import { loadContentProject, saveContentProject } from './content-os';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import { universeMarketIntelligenceState } from './universe';

async function loadPilotDecision(decisionId:string):Promise<Decision>{
  const row=checked(await db().from('radar_decisions')
    .select('payload')
    .eq('id',decisionId)
    .maybeSingle());
  if(!row)throw new HttpError('Decisão de piloto não encontrada.',404);
  const decision=row.payload as Decision;
  if(decision.kind!=='universe-pilot'||decision.decision!=='approved'||!decision.pilotBrief){
    throw new HttpError('O piloto precisa estar aprovado e possuir Pilot Brief antes do handoff.',409);
  }
  return decision;
}

async function loadOwnedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)throw new HttpError('Canal próprio não encontrado.',404);
  const payload=row.payload as ManagedChannel & {kind?:string};
  if(payload.kind==='competitor')throw new HttpError('O piloto só pode ser enviado para um canal próprio.',409);
  return payload;
}

async function persistHandoff(decision:Decision,handoff:UniversePilotHandoff){
  const next:Decision={...decision,pilotHandoff:handoff};
  await put('radar_decisions',decision.id,next);
  return next;
}

export async function handoffUniversePilotToContentOs(decisionId:string,channelId:string){
  const decision=await loadPilotDecision(decisionId);
  const channel=await loadOwnedChannel(channelId);

  if(decision.pilotHandoff&&decision.pilotHandoff.channelId!==channelId){
    throw new HttpError(`Este piloto já foi enviado ao canal ${decision.pilotHandoff.channelName}. Crie uma nova decisão para testar outro canal.`,409);
  }

  const intelligence=await universeMarketIntelligenceState();
  const current=resolveUniversePilotDecision(intelligence,decision.pilotBrief!.gapId);
  if(!current.ok){
    throw new HttpError('O gap perdeu o status PILOT READY no Market atual. Revalide a hipótese antes de criar produção.',409);
  }

  const existingRow=checked(await db().from('radar_content_projects')
    .select('id,episode_id,channel_id')
    .eq('opportunity_id',decision.id)
    .limit(1)
    .maybeSingle());

  if(existingRow){
    if(String(existingRow.channel_id)!==channelId){
      throw new HttpError('Já existe um Content Project deste piloto em outro canal.',409);
    }
    const existing=await loadContentProject(String(existingRow.id));
    if(!existing)throw new HttpError('Content Project do piloto não pôde ser carregado.',502);
    const handoff:UniversePilotHandoff=decision.pilotHandoff??{
      channelId,
      channelName:channel.name,
      episodeId:String(existingRow.episode_id),
      contentProjectId:String(existingRow.id),
      createdAt:existing.createdAt
    };
    const nextDecision=decision.pilotHandoff?decision:await persistHandoff(decision,handoff);
    return {decision:nextDecision,channel,project:existing,handoff,reused:true};
  }

  const [brain,bundle]=await Promise.all([
    loadChannelBrain(channelId),
    loadNarrativeBundle(channelId)
  ]);
  const sequence=Math.max(0,...bundle.episodes.map(item=>item.sequence))+1;
  const createdAt=new Date().toISOString();
  const {episode,project}=buildUniversePilotContentHandoff({
    decision,
    channel,
    brain,
    sequence,
    episodeId:crypto.randomUUID(),
    projectId:crypto.randomUUID(),
    factCheckId:crypto.randomUUID(),
    createdAt
  });

  const savedEpisode=await saveChannelEpisode(episode);
  let savedProject;
  try{
    savedProject=await saveContentProject(project,0);
  }catch(error){
    await db().from('radar_episodes')
      .delete()
      .eq('id',savedEpisode.id)
      .eq('channel_id',channelId);
    throw error;
  }

  const handoff:UniversePilotHandoff={
    channelId,
    channelName:channel.name,
    episodeId:savedEpisode.id,
    contentProjectId:savedProject.id,
    createdAt
  };
  const nextDecision=await persistHandoff(decision,handoff);
  return {decision:nextDecision,channel,project:savedProject,handoff,reused:false};
}

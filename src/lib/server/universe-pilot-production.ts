import 'server-only';

import type { Decision, ManagedChannel } from '@/lib/types';
import { buildUniversePilotProductionArtifacts } from '@/lib/universe-pilot';
import { checked, db, put } from './db';
import { HttpError } from './auth';
import { createDefaultChannelBrain, loadChannelBrain, saveChannelBrain } from './channel-brain';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import { loadContentProjects, saveContentProject } from './content-os';

async function loadPilotDecision(decisionId:string):Promise<Decision>{
  const row=checked(await db().from('radar_decisions')
    .select('payload')
    .eq('id',decisionId)
    .maybeSingle());
  if(!row)throw new HttpError('Decisão de piloto não encontrada.',404);
  const decision=row.payload as Decision;
  if(decision.kind!=='universe-pilot'||decision.decision!=='approved'||!decision.pilotBrief){
    throw new HttpError('Somente um piloto aprovado com Pilot Brief pode ser preparado para produção.',409);
  }
  return decision;
}

async function loadManagedChannel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)throw new HttpError('Canal gerenciado não encontrado.',404);
  const payload=row.payload as ManagedChannel&{kind?:string};
  if(payload.kind==='competitor')throw new HttpError('Escolha um canal da Gestão de Canais, não um concorrente do Universe.',400);
  return payload;
}

export async function prepareUniversePilotProduction(input:{
  decisionId:string;
  channelId:string;
}){
  const [decision,channel]=await Promise.all([
    loadPilotDecision(input.decisionId),
    loadManagedChannel(input.channelId)
  ]);
  const brief=decision.pilotBrief!;

  if(brief.handoff){
    if(brief.handoff.channelId!==channel.id){
      throw new HttpError('Este Pilot Brief já foi preparado para outro canal.',409);
    }
    return {
      reused:true,
      decisionId:decision.id,
      channelId:brief.handoff.channelId,
      episodeId:brief.handoff.episodeId,
      contentProjectId:brief.handoff.contentProjectId
    };
  }

  let brain=await loadChannelBrain(channel.id);
  if(!brain){
    brain=await saveChannelBrain(createDefaultChannelBrain(channel),null);
  }

  const bundle=await loadNarrativeBundle(channel.id);
  const marker=`universe-pilot:${decision.id}`;
  let episode=bundle.episodes.find(item=>item.repetitionKeys.includes(marker))??null;
  let project=(await loadContentProjects(channel.id)).find(item=>item.opportunityId===marker)??null;
  const now=new Date().toISOString();

  const artifacts=buildUniversePilotProductionArtifacts({
    decision,
    channelId:channel.id,
    sequence:episode?.sequence??Math.max(0,...bundle.episodes.map(item=>item.sequence))+1,
    episodeId:episode?.id??crypto.randomUUID(),
    contentProjectId:project?.id??crypto.randomUUID(),
    createdAt:episode?.createdAt??project?.createdAt??now
  });

  if(!episode){
    episode=await saveChannelEpisode(artifacts.episode);
  }
  if(!project){
    project=await saveContentProject({
      ...artifacts.project,
      episodeId:episode.id,
      updatedAt:now
    },null);
  }

  const updatedDecision:Decision={
    ...decision,
    pilotBrief:{
      ...brief,
      handoff:{
        status:'prepared',
        channelId:channel.id,
        episodeId:episode.id,
        contentProjectId:project.id,
        preparedAt:now
      }
    }
  };
  await put('radar_decisions',decision.id,updatedDecision);

  return {
    reused:false,
    decisionId:decision.id,
    channelId:channel.id,
    channelName:channel.name,
    brainVersion:brain.version,
    episodeId:episode.id,
    contentProjectId:project.id
  };
}

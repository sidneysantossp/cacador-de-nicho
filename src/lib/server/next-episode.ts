import 'server-only';

import type {
  ContentProject, ContentProjectPayload, ManagedChannel,
  NextEpisodePlan, NextEpisodePlanPayload, NextEpisodePlanVersion
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadChannelBrain } from './channel-brain';
import { loadNarrativeBundle, saveChannelEpisode } from './narrative';
import { generateNextEpisodeStrategy } from './next-episode-ai';
import { compileNextEpisodePlan } from '@/lib/next-episode-policy';
import { episodeNarrativeReadiness } from '@/lib/narrative-policy';
import { loadContentProject, saveContentProject } from './content-os';

type Row={
  id:string;channel_id:string;brain_version:number;version:number;
  status:NextEpisodePlan['status'];payload:unknown;created_at:string;updated_at:string;
};
const selection='id,channel_id,brain_version,version,status,payload,created_at,updated_at';

function normalize(row:Row):NextEpisodePlan{
  const payload=row.payload as NextEpisodePlanPayload;
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    brainVersion:Number(row.brain_version),
    version:Number(row.version),
    status:row.status,
    updatedAt:payload.updatedAt??row.updated_at
  };
}

async function channel(channelId:string):Promise<ManagedChannel>{
  const row=checked(await db().from('radar_managed_channels')
    .select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal não encontrado.',404);
  return row.payload as ManagedChannel;
}

export async function listNextEpisodePlans(channelId:string){
  const rows=checked(await db().from('radar_next_episode_plans')
    .select(selection).eq('channel_id',channelId)
    .order('updated_at',{ascending:false}).limit(100));
  return (rows??[]).map(row=>normalize(row as Row));
}

export async function loadNextEpisodePlan(planId:string){
  const row=checked(await db().from('radar_next_episode_plans')
    .select(selection).eq('id',planId).maybeSingle());
  return row?normalize(row as Row):null;
}

export async function loadNextEpisodePlanHistory(planId:string,limit=30):Promise<NextEpisodePlanVersion[]>{
  const rows=checked(await db().from('radar_next_episode_plan_versions')
    .select('version,status,payload,created_at')
    .eq('plan_id',planId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,100))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as NextEpisodePlan['status'],
    payload:row.payload as NextEpisodePlanPayload,
    createdAt:String(row.created_at)
  }));
}

async function claimCandidate(planId:string,expectedVersion:number,candidateId:string){
  const result=await db().rpc('claim_next_episode_candidate',{
    p_plan_id:planId,
    p_expected_version:expectedVersion,
    p_candidate_id:candidateId
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('next episode plan version conflict'))throw new HttpError('Next Episode Plan desatualizado.',409);
    if(message.includes('next episode acceptance already claimed'))throw new HttpError('Outro candidato já foi reservado para este plano. Recarregue a decisão.',409);
    if(message.includes('next episode plan already accepted'))throw new HttpError('Este plano já foi aceito.',409);
    if(message.includes('candidate does not belong to plan'))throw new HttpError('Candidato inválido para este plano.',400);
    if(message.includes('next episode plan not found'))throw new HttpError('Next Episode Plan não encontrado.',404);
    throw new HttpError('Falha ao reservar o candidato do próximo episódio.',502);
  }
  return result.data===true;
}

async function savePlan(
  payload:NextEpisodePlanPayload,
  status:NextEpisodePlan['status'],
  expectedVersion:number|null
){
  const result=await db().rpc('save_next_episode_plan',{
    p_plan_id:payload.id,
    p_channel_id:payload.channelId,
    p_brain_version:payload.brainVersion,
    p_status:status,
    p_payload:payload,
    p_expected_version:expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('next episode plan version conflict')){
      throw new HttpError('Next Episode Plan desatualizado. Recarregue antes de continuar.',409);
    }
    if(message.includes('managed channel not found'))throw new HttpError('Canal não encontrado.',404);
    throw new HttpError('Falha ao versionar Next Episode Plan.',502);
  }
  const saved=await loadNextEpisodePlan(payload.id);
  if(!saved)throw new HttpError('Plano salvo, mas não pôde ser recarregado.',502);
  return saved;
}

export async function generateNextEpisodePlan(channelId:string){
  const [managed,brain,bundle,plans]=await Promise.all([
    channel(channelId),
    loadChannelBrain(channelId),
    loadNarrativeBundle(channelId),
    listNextEpisodePlans(channelId)
  ]);
  if(!brain)throw new HttpError('Crie e salve o Channel Brain antes de planejar o próximo episódio.',409);

  const reusable=plans.find(plan=>plan.status==='review'&&plan.brainVersion===brain.version);
  if(reusable)return {plan:reusable,created:false};

  const generated=await generateNextEpisodeStrategy({channel:managed,brain,bundle});
  let payload:NextEpisodePlanPayload;
  try{
    payload=compileNextEpisodePlan({
      id:crypto.randomUUID(),
      channel:managed,
      brain,
      bundle,
      model:generated.result
    });
  }catch(error){
    throw new HttpError(
      'O Next Episode Strategist devolveu referências incompatíveis com o contexto. Nenhum plano foi salvo. '+
      (error instanceof Error?error.message:''),
      502
    );
  }

  return {plan:await savePlan(payload,'review',0),created:true};
}

function contentProjectFromCandidate(input:{
  plan:NextEpisodePlan;
  candidate:NextEpisodePlan['candidates'][number];
  channel:ManagedChannel;
  episodeId:string;
  arcName:string;
}):ContentProjectPayload{
  const now=new Date().toISOString();
  return {
    kind:'content-project',
    id:input.plan.id,
    channelId:input.channel.id,
    episodeId:input.episodeId,
    opportunityId:input.channel.opportunityId,
    brief:{
      theme:input.candidate.theme,
      thesis:input.candidate.thesis,
      angle:input.candidate.angle,
      promise:input.candidate.promise,
      workingTitle:input.candidate.workingTitle,
      thumbnailConcept:input.candidate.thumbnailConcept,
      targetAudience:input.candidate.targetAudience,
      objective:input.candidate.objective,
      previousEpisodeConnection:input.candidate.previousEpisodeConnection,
      arcConnection:input.arcName
    },
    research:{
      notes:'',
      sources:[],
      factChecks:[]
    },
    approval:{
      status:'draft',
      notes:'Criado a partir do Next Episode Strategist '+input.plan.id+'.'
    },
    createdAt:now,
    updatedAt:now
  };
}

export async function acceptNextEpisodeCandidate(input:{
  planId:string;
  candidateId:string;
  expectedVersion:number;
  notes:string;
}){
  const plan=await loadNextEpisodePlan(input.planId);
  if(!plan)throw new HttpError('Next Episode Plan não encontrado.',404);
  if(plan.status==='accepted'){
    if(plan.review.acceptedCandidateId!==input.candidateId){
      throw new HttpError('Este plano já foi aceito com outro candidato.',409);
    }
    return {
      plan,
      episodeId:plan.review.acceptedEpisodeId,
      contentProjectId:plan.review.acceptedContentProjectId,
      alreadyAccepted:true
    };
  }
  if(plan.version!==input.expectedVersion)throw new HttpError('Next Episode Plan desatualizado.',409);
  if(plan.status!=='review')throw new HttpError('Este plano não está mais disponível para aceitação.',409);

  const candidate=plan.candidates.find(item=>item.id===input.candidateId);
  if(!candidate)throw new HttpError('Candidato de episódio não encontrado neste plano.',404);

  const [managed,brain,bundle]=await Promise.all([
    channel(plan.channelId),
    loadChannelBrain(plan.channelId),
    loadNarrativeBundle(plan.channelId)
  ]);
  if(!brain||brain.version!==plan.brainVersion){
    throw new HttpError('O Channel Brain mudou desde a geração deste plano. Gere uma nova estratégia antes de aceitar.',409);
  }

  const readiness=episodeNarrativeReadiness(
    {
      prerequisiteConcepts:candidate.prerequisiteConcepts,
      repetitionKeys:candidate.repetitionKeys
    },
    bundle.concepts,
    brain
  );
  if(!candidate.narrativeReady||!readiness.ready){
    throw new HttpError(
      'Este candidato está bloqueado pela Narrative Intelligence: '+
      [...readiness.missingConcepts.map(x=>'conceito '+x),...readiness.repetitionConflicts.map(x=>'repetição '+x)].join(' · '),
      409
    );
  }

  await claimCandidate(plan.id,plan.version,candidate.id);

  const now=new Date().toISOString();
  const episodeId=candidate.id;
  const existingEpisode=bundle.episodes.find(item=>item.id===episodeId);
  const episode=existingEpisode??await saveChannelEpisode({
    id:episodeId,
    channelId:plan.channelId,
    arcId:candidate.arcId,
    sequence:Math.max(0,...bundle.episodes.map(item=>item.sequence))+1,
    status:'idea',
    title:candidate.workingTitle,
    thesis:candidate.thesis,
    narrativeSummary:candidate.objective,
    prerequisiteConcepts:candidate.prerequisiteConcepts,
    introducesConcepts:candidate.introducesConcepts,
    reinforcesConcepts:candidate.reinforcesConcepts,
    opensThreads:candidate.opensThreads,
    resolvesThreads:candidate.resolvesThreads,
    repetitionKeys:candidate.repetitionKeys,
    createdAt:now,
    updatedAt:now
  });

  let project:ContentProject|null=await loadContentProject(plan.id);
  if(!project){
    const arcName=candidate.arcId
      ?bundle.arcs.find(item=>item.id===candidate.arcId)?.name??''
      :'';
    try{
      project=await saveContentProject(
        contentProjectFromCandidate({
          plan,candidate,channel:managed,episodeId:episode.id,arcName
        }),
        0
      );
    }catch(error){
      const concurrent=await loadContentProject(plan.id);
      if(!concurrent||concurrent.episodeId!==episode.id)throw error;
      project=concurrent;
    }
  }

  const {version:_version,status:_status,...payload}=plan;
  const acceptedAt=new Date().toISOString();
  const next:NextEpisodePlanPayload={
    ...payload,
    review:{
      notes:input.notes.trim().slice(0,5000),
      acceptedCandidateId:candidate.id,
      acceptedEpisodeId:episode.id,
      acceptedContentProjectId:project.id,
      acceptedAt,
      acceptedBy:'operator'
    },
    updatedAt:acceptedAt
  };
  try{
    const saved=await savePlan(next,'accepted',plan.version);
    return {
      plan:saved,
      episodeId:episode.id,
      contentProjectId:project.id,
      alreadyAccepted:false
    };
  }catch(error){
    if(!(error instanceof HttpError)||error.status!==409)throw error;
    const concurrent=await loadNextEpisodePlan(plan.id);
    if(
      concurrent?.status==='accepted'&&
      concurrent.review.acceptedCandidateId===candidate.id&&
      concurrent.review.acceptedEpisodeId===episode.id
    ){
      return {
        plan:concurrent,
        episodeId:concurrent.review.acceptedEpisodeId,
        contentProjectId:concurrent.review.acceptedContentProjectId,
        alreadyAccepted:true
      };
    }
    throw error;
  }
}

export async function nextEpisodeChannelState(channelId:string){
  const [plans,brain,bundle]=await Promise.all([
    listNextEpisodePlans(channelId),
    loadChannelBrain(channelId),
    loadNarrativeBundle(channelId)
  ]);
  return {
    plans,
    brainVersion:brain?.version??0,
    episodeCount:bundle.episodes.length,
    activePlan:plans.find(item=>item.status==='review')??null
  };
}

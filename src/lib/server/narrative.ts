import 'server-only';

import type { ChannelConcept, ChannelEpisode, ContentArc, NarrativeBundle } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadChannelBrain } from './channel-brain';
import { detectConceptDependencyCycles, episodeNarrativeReadiness } from '@/lib/narrative-policy';

function normalizeArc(row:{id:string;channel_id:string;sequence:number;status:ContentArc['status'];payload:unknown;created_at:string;updated_at:string}):ContentArc{
  const payload=row.payload as Partial<ContentArc>;
  return {
    id:row.id,
    channelId:row.channel_id,
    sequence:Number(row.sequence),
    status:row.status,
    name:String(payload.name??''),
    objective:String(payload.objective??''),
    premise:String(payload.premise??''),
    prerequisiteConcepts:Array.isArray(payload.prerequisiteConcepts)?payload.prerequisiteConcepts.map(String):[],
    targetConcepts:Array.isArray(payload.targetConcepts)?payload.targetConcepts.map(String):[],
    notes:Array.isArray(payload.notes)?payload.notes.map(String):[],
    createdAt:String(payload.createdAt??row.created_at),
    updatedAt:String(payload.updatedAt??row.updated_at)
  };
}
function normalizeEpisode(row:{id:string;channel_id:string;arc_id:string|null;sequence:number;status:ChannelEpisode['status'];payload:unknown;created_at:string;updated_at:string}):ChannelEpisode{
  const payload=row.payload as Partial<ChannelEpisode>;
  return {
    id:row.id,
    channelId:row.channel_id,
    arcId:row.arc_id??undefined,
    sequence:Number(row.sequence),
    status:row.status,
    title:String(payload.title??''),
    thesis:String(payload.thesis??''),
    narrativeSummary:String(payload.narrativeSummary??''),
    prerequisiteConcepts:Array.isArray(payload.prerequisiteConcepts)?payload.prerequisiteConcepts.map(String):[],
    introducesConcepts:Array.isArray(payload.introducesConcepts)?payload.introducesConcepts.map(String):[],
    reinforcesConcepts:Array.isArray(payload.reinforcesConcepts)?payload.reinforcesConcepts.map(String):[],
    opensThreads:Array.isArray(payload.opensThreads)?payload.opensThreads.map(String):[],
    resolvesThreads:Array.isArray(payload.resolvesThreads)?payload.resolvesThreads.map(String):[],
    repetitionKeys:Array.isArray(payload.repetitionKeys)?payload.repetitionKeys.map(String):[],
    youtubeVideoId:payload.youtubeVideoId?String(payload.youtubeVideoId):undefined,
    publishedAt:payload.publishedAt?String(payload.publishedAt):undefined,
    createdAt:String(payload.createdAt??row.created_at),
    updatedAt:String(payload.updatedAt??row.updated_at)
  };
}
function normalizeConcept(row:{id:string;channel_id:string;concept_key:string;status:ChannelConcept['status'];payload:unknown;created_at:string;updated_at:string}):ChannelConcept{
  const payload=row.payload as Partial<ChannelConcept>;
  return {
    id:row.id,
    channelId:row.channel_id,
    key:row.concept_key,
    label:String(payload.label??row.concept_key),
    description:String(payload.description??''),
    status:row.status,
    prerequisiteKeys:Array.isArray(payload.prerequisiteKeys)?payload.prerequisiteKeys.map(String):[],
    introducedEpisodeId:payload.introducedEpisodeId?String(payload.introducedEpisodeId):undefined,
    establishedEpisodeId:payload.establishedEpisodeId?String(payload.establishedEpisodeId):undefined,
    createdAt:String(payload.createdAt??row.created_at),
    updatedAt:String(payload.updatedAt??row.updated_at)
  };
}

export async function loadNarrativeBundle(channelId:string):Promise<NarrativeBundle>{
  const client=db();
  const [arcsResult,episodesResult,conceptsResult]=await Promise.all([
    client.from('radar_content_arcs').select('id,channel_id,sequence,status,payload,created_at,updated_at').eq('channel_id',channelId).order('sequence',{ascending:true}),
    client.from('radar_episodes').select('id,channel_id,arc_id,sequence,status,payload,created_at,updated_at').eq('channel_id',channelId).order('sequence',{ascending:true}),
    client.from('radar_channel_concepts').select('id,channel_id,concept_key,status,payload,created_at,updated_at').eq('channel_id',channelId).order('concept_key',{ascending:true})
  ]);
  const arcs=(checked(arcsResult)??[]).map(row=>normalizeArc(row as never));
  const episodes=(checked(episodesResult)??[]).map(row=>normalizeEpisode(row as never));
  const concepts=(checked(conceptsResult)??[]).map(row=>normalizeConcept(row as never));
  return {arcs,episodes,concepts};
}

export async function saveContentArc(arc:ContentArc):Promise<ContentArc>{
  const now=new Date().toISOString();
  const normalized={...arc,updatedAt:now};
  const payload={
    name:normalized.name,
    objective:normalized.objective,
    premise:normalized.premise,
    prerequisiteConcepts:normalized.prerequisiteConcepts,
    targetConcepts:normalized.targetConcepts,
    notes:normalized.notes,
    createdAt:normalized.createdAt,
    updatedAt:normalized.updatedAt
  };
  const row=checked(await db().from('radar_content_arcs').upsert({
    id:normalized.id,
    channel_id:normalized.channelId,
    sequence:normalized.sequence,
    status:normalized.status,
    payload,
    updated_at:now
  }).select('id,channel_id,sequence,status,payload,created_at,updated_at').single());
  return normalizeArc(row as never);
}

export async function saveChannelConcept(concept:ChannelConcept):Promise<ChannelConcept>{
  if(concept.prerequisiteKeys.includes(concept.key))throw new HttpError('Um conceito não pode depender de si mesmo.',400);
  const current=await loadNarrativeBundle(concept.channelId);
  const candidate=current.concepts.filter(item=>item.id!==concept.id).concat(concept);
  const cycles=detectConceptDependencyCycles(candidate);
  if(cycles.length)throw new HttpError(`Dependência circular detectada no Concept Graph: ${cycles.join(', ')}.`,409);
  const now=new Date().toISOString();
  const normalized={...concept,updatedAt:now};
  const payload={
    label:normalized.label,
    description:normalized.description,
    prerequisiteKeys:normalized.prerequisiteKeys,
    introducedEpisodeId:normalized.introducedEpisodeId,
    establishedEpisodeId:normalized.establishedEpisodeId,
    createdAt:normalized.createdAt,
    updatedAt:normalized.updatedAt
  };
  const result=await db().from('radar_channel_concepts').upsert({
    id:normalized.id,
    channel_id:normalized.channelId,
    concept_key:normalized.key,
    status:normalized.status,
    payload,
    updated_at:now
  }).select('id,channel_id,concept_key,status,payload,created_at,updated_at').single();
  if(result.error){
    if(String(result.error.message??'').includes('radar_channel_concepts_channel_id_concept_key_key')){
      throw new HttpError('Já existe um conceito com essa chave neste canal.',409);
    }
    throw new HttpError('Falha ao salvar conceito narrativo.',502);
  }
  return normalizeConcept(result.data as never);
}

export async function saveChannelEpisode(episode:ChannelEpisode):Promise<ChannelEpisode>{
  const bundle=await loadNarrativeBundle(episode.channelId);
  const brain=await loadChannelBrain(episode.channelId);
  const readiness=episodeNarrativeReadiness(episode,bundle.concepts,brain);
  if(['scripted','producing','published'].includes(episode.status)&&!readiness.ready){
    const reasons=[
      readiness.missingConcepts.length?`conceitos ausentes: ${readiness.missingConcepts.join(', ')}`:'',
      readiness.repetitionConflicts.length?`repetições bloqueadas: ${readiness.repetitionConflicts.join(', ')}`:''
    ].filter(Boolean);
    throw new HttpError(`Episódio bloqueado pela Narrative Intelligence (${reasons.join(' · ')}).`,409);
  }
  const now=new Date().toISOString();
  const normalized={...episode,updatedAt:now};
  const payload={
    title:normalized.title,
    thesis:normalized.thesis,
    narrativeSummary:normalized.narrativeSummary,
    prerequisiteConcepts:normalized.prerequisiteConcepts,
    introducesConcepts:normalized.introducesConcepts,
    reinforcesConcepts:normalized.reinforcesConcepts,
    opensThreads:normalized.opensThreads,
    resolvesThreads:normalized.resolvesThreads,
    repetitionKeys:normalized.repetitionKeys,
    youtubeVideoId:normalized.youtubeVideoId,
    publishedAt:normalized.publishedAt,
    createdAt:normalized.createdAt,
    updatedAt:normalized.updatedAt
  };
  const row=checked(await db().from('radar_episodes').upsert({
    id:normalized.id,
    channel_id:normalized.channelId,
    arc_id:normalized.arcId??null,
    sequence:normalized.sequence,
    status:normalized.status,
    payload,
    updated_at:now
  }).select('id,channel_id,arc_id,sequence,status,payload,created_at,updated_at').single());
  return normalizeEpisode(row as never);
}

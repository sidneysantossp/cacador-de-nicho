import type { ChannelBrain, ChannelConcept, ChannelEpisode } from '@/lib/types';

const availableStatuses=new Set<ChannelConcept['status']>(['introduced','partial','established']);

export function conceptPrerequisitesMet(concept:ChannelConcept,concepts:ChannelConcept[]){
  const byKey=new Map(concepts.map(item=>[item.key,item]));
  const missing=concept.prerequisiteKeys.filter(key=>{
    const item=byKey.get(key);
    return !item||!availableStatuses.has(item.status);
  });
  return {ready:missing.length===0,missing};
}

export function episodeNarrativeReadiness(
  episode:Pick<ChannelEpisode,'prerequisiteConcepts'|'repetitionKeys'>,
  concepts:ChannelConcept[],
  brain:ChannelBrain|null
){
  const byKey=new Map(concepts.map(item=>[item.key,item]));
  const missingConcepts=episode.prerequisiteConcepts.filter(key=>{
    const item=byKey.get(key);
    return !item||!availableStatuses.has(item.status);
  });
  const forbiddenRepetition=new Set((brain?.narrative.doNotRepeat??[]).map(item=>item.trim().toLowerCase()));
  const repetitionConflicts=episode.repetitionKeys.filter(item=>forbiddenRepetition.has(item.trim().toLowerCase()));
  return {
    ready:missingConcepts.length===0&&repetitionConflicts.length===0,
    missingConcepts,
    repetitionConflicts
  };
}

export function nextNarrativeConcepts(concepts:ChannelConcept[]){
  const active=concepts.filter(item=>item.status!=='retired'&&item.status!=='established');
  const partial=active.filter(item=>item.status==='introduced'||item.status==='partial');
  const unknown=active.filter(item=>item.status==='unknown');
  const readyUnknown=unknown.filter(item=>conceptPrerequisitesMet(item,concepts).ready);
  const blockedUnknown=unknown.filter(item=>!conceptPrerequisitesMet(item,concepts).ready);
  return [...partial,...readyUnknown,...blockedUnknown];
}

export function narrativeProgress(concepts:ChannelConcept[]){
  const total=concepts.filter(item=>item.status!=='retired').length;
  const established=concepts.filter(item=>item.status==='established').length;
  const active=concepts.filter(item=>item.status==='introduced'||item.status==='partial').length;
  const unknown=concepts.filter(item=>item.status==='unknown').length;
  return {total,established,active,unknown,progressPct:total?Math.round((established/total)*100):0};
}


export function detectConceptDependencyCycles(concepts:ChannelConcept[]){
  const graph=new Map(concepts.map(item=>[item.key,item.prerequisiteKeys]));
  const visiting=new Set<string>();
  const visited=new Set<string>();
  const cycle=new Set<string>();

  function visit(key:string,trail:string[]){
    if(visiting.has(key)){
      const start=trail.indexOf(key);
      for(const item of trail.slice(start))cycle.add(item);
      cycle.add(key);
      return;
    }
    if(visited.has(key))return;
    visiting.add(key);
    const next=graph.get(key)??[];
    for(const dep of next){
      if(graph.has(dep))visit(dep,[...trail,key]);
    }
    visiting.delete(key);
    visited.add(key);
  }

  for(const key of graph.keys())visit(key,[]);
  return [...cycle];
}

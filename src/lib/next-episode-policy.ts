import type {
  ChannelBrain, ChannelEpisode, ManagedChannel, NarrativeBundle,
  NextEpisodeCandidate, NextEpisodePlanPayload
} from '@/lib/types';
import {
  episodeNarrativeReadiness, nextNarrativeConcepts
} from '@/lib/narrative-policy';

export type NextEpisodeEvidenceSource = {
  ref:string;
  type:'learning'|'thread'|'concept'|'arc'|'episode'|'market';
  summary:string;
  confidence?:'low'|'medium'|'high';
};

export type NextEpisodeMarketEvidenceSource={
  ref:string;
  type:'market';
  summary:string;
  confidence?:'low'|'medium'|'high';
};

export type NextEpisodeModelCandidate = {
  workingTitle:string;
  theme:string;
  thesis:string;
  angle:string;
  promise:string;
  thumbnailConcept:string;
  targetAudience:string;
  objective:string;
  previousEpisodeConnection:string;
  arcRef:string|null;
  prerequisiteConceptRefs:string[];
  introducesConceptRefs:string[];
  reinforcesConceptRefs:string[];
  opensThreads:string[];
  resolvesThreadRefs:string[];
  repetitionKeys:string[];
  evidenceRefs:string[];
  rationale:string;
  risks:string[];
  originality:{
    discovery:string;
    addedValue:string;
    copyResistance:string;
    sourcePlan:string;
  };
};

export type NextEpisodeModelResult = {
  candidates:NextEpisodeModelCandidate[];
  recommendedIndex:number;
  recommendationRationale:string;
};

function confidenceRank(value:'low'|'medium'|'high'){
  return value==='high'?3:value==='medium'?2:1;
}
function unique(values:string[]){return [...new Set(values.map(v=>v.trim()).filter(Boolean))];}

export function buildNextEpisodeEvidenceContext(
  channel:ManagedChannel,
  brain:ChannelBrain,
  bundle:NarrativeBundle,
  marketEvidence:NextEpisodeMarketEvidenceSource[]=[]
){
  const sources:NextEpisodeEvidenceSource[]=[];
  sources.push(...marketEvidence.slice(0,24).map(item=>({...item})));

  const learnings=[...brain.learnings]
    .sort((a,b)=>confidenceRank(b.confidence)-confidenceRank(a.confidence)||
      Date.parse(b.createdAt)-Date.parse(a.createdAt))
    .slice(0,40);
  for(const item of learnings){
    sources.push({
      ref:'learning:'+item.id,
      type:'learning',
      summary:'['+item.type+'] '+item.statement,
      confidence:item.confidence
    });
  }

  brain.narrative.openThreads.slice(0,20).forEach((thread,index)=>{
    sources.push({
      ref:'thread:t'+(index+1),
      type:'thread',
      summary:thread
    });
  });

  const prioritizedConcepts=nextNarrativeConcepts(bundle.concepts);
  const prioritizedKeys=new Set(prioritizedConcepts.map(item=>item.key));
  const establishedConcepts=bundle.concepts
    .filter(item=>item.status==='established'&&!prioritizedKeys.has(item.key));
  for(const concept of [...prioritizedConcepts,...establishedConcepts].slice(0,40)){
    sources.push({
      ref:'concept:'+concept.key,
      type:'concept',
      summary:concept.label+' · status '+concept.status+
        (concept.description?' · '+concept.description:'')
    });
  }

  for(const arc of bundle.arcs
    .filter(item=>item.status==='active'||item.status==='planned')
    .slice(0,12)){
    sources.push({
      ref:'arc:'+arc.id,
      type:'arc',
      summary:arc.name+' · '+arc.objective
    });
  }

  for(const episode of [...bundle.episodes].sort((a,b)=>b.sequence-a.sequence).slice(0,10)){
    sources.push({
      ref:'episode:'+episode.id,
      type:'episode',
      summary:'EP '+episode.sequence+' · '+episode.title+' · '+episode.status
    });
  }

  return {
    sources,
    marketSignal:marketEvidence.length?'nexlev-evidence' as const:
      channel.opportunityId?'linked-opportunity' as const:'unavailable' as const,
    channel:{
      name:channel.name,
      niche:channel.niche,
      format:channel.format,
      description:channel.description
    },
    constitution:brain.constitution,
    narrative:brain.narrative,
    doNotRepeat:brain.narrative.doNotRepeat,
    evidence:sources
  };
}

function sourceMap(sources:NextEpisodeEvidenceSource[]){
  return new Map(sources.map(item=>[item.ref,item]));
}

function conceptKey(ref:string,sources:Map<string,NextEpisodeEvidenceSource>){
  const source=sources.get(ref);
  if(!source||source.type!=='concept')throw new Error('Invalid concept evidence ref: '+ref);
  return ref.slice('concept:'.length);
}

function threadText(ref:string,sources:Map<string,NextEpisodeEvidenceSource>){
  const source=sources.get(ref);
  if(!source||source.type!=='thread')throw new Error('Invalid thread evidence ref: '+ref);
  return source.summary;
}

function arcId(ref:string|null,sources:Map<string,NextEpisodeEvidenceSource>){
  if(!ref)return undefined;
  const source=sources.get(ref);
  if(!source||source.type!=='arc')throw new Error('Invalid arc evidence ref: '+ref);
  return ref.slice('arc:'.length);
}

function evidenceStrength(
  refs:string[],
  narrativeReady:boolean,
  sources:Map<string,NextEpisodeEvidenceSource>
):NextEpisodeCandidate['evidenceStrength']{
  const selected=refs.map(ref=>sources.get(ref)).filter(Boolean) as NextEpisodeEvidenceSource[];
  const types=new Set(selected.map(item=>item.type));
  const strongLearning=selected.some(item=>item.type==='learning'&&(item.confidence==='high'||item.confidence==='medium'));
  if(narrativeReady&&strongLearning&&types.size>=2)return 'high';
  if(narrativeReady&&refs.length>=2)return 'medium';
  return 'low';
}

function originalityGate(raw:NextEpisodeModelCandidate,evidenceRefs:string[]):NextEpisodeCandidate['originalityGate']{
  const discovery=raw.originality.discovery.trim();
  const thesis=raw.thesis.trim();
  const addedValue=raw.originality.addedValue.trim();
  const copyResistance=raw.originality.copyResistance.trim();
  const sourcePlan=raw.originality.sourcePlan.trim();
  const checks:NextEpisodeCandidate['originalityGate']['checks']=[
    {code:'discovery',pass:discovery.length>=60,detail:discovery},
    {code:'thesis',pass:thesis.length>=40,detail:thesis},
    {code:'added-value',pass:addedValue.length>=60,detail:addedValue},
    {code:'copy-resistance',pass:copyResistance.length>=60,detail:copyResistance},
    {
      code:'evidence-plan',
      pass:evidenceRefs.length>=2&&sourcePlan.length>=60,
      detail:sourcePlan
    }
  ];
  const score=checks.filter(item=>item.pass).length*20;
  return {
    status:score===100?'pass':score>=80?'review':'block',
    score,
    checks
  };
}

function candidateScore(item:NextEpisodeCandidate){
  const strength=item.evidenceStrength==='high'?30:item.evidenceStrength==='medium'?20:10;
  const originality=item.originalityGate.status==='pass'?30:item.originalityGate.status==='review'?10:0;
  return strength+originality+(item.narrativeReady?20:0)+Math.min(10,item.evidenceRefs.length);
}

export function compileNextEpisodePlan(input:{
  id:string;
  channel:ManagedChannel;
  brain:ChannelBrain;
  bundle:NarrativeBundle;
  model:NextEpisodeModelResult;
  marketEvidence?:NextEpisodeMarketEvidenceSource[];
}):NextEpisodePlanPayload{
  const context=buildNextEpisodeEvidenceContext(input.channel,input.brain,input.bundle,input.marketEvidence??[]);
  const sources=sourceMap(context.sources);

  if(input.model.candidates.length<2||input.model.candidates.length>5){
    throw new Error('Next Episode Strategist must return between 2 and 5 candidates.');
  }

  const candidates:NextEpisodeCandidate[]=input.model.candidates.map(raw=>{
    const evidenceRefs=unique(raw.evidenceRefs);
    if(!evidenceRefs.length)throw new Error('Next episode candidate has no evidence refs.');
    for(const ref of evidenceRefs){
      if(!sources.has(ref))throw new Error('Unknown next episode evidence ref: '+ref);
    }

    const prerequisiteConcepts=unique(raw.prerequisiteConceptRefs).map(ref=>conceptKey(ref,sources));
    const introducesConcepts=unique(raw.introducesConceptRefs).map(ref=>conceptKey(ref,sources));
    const reinforcesConcepts=unique(raw.reinforcesConceptRefs).map(ref=>conceptKey(ref,sources));
    const resolvesThreads=unique(raw.resolvesThreadRefs).map(ref=>threadText(ref,sources));
    const readiness=episodeNarrativeReadiness(
      {prerequisiteConcepts,repetitionKeys:unique(raw.repetitionKeys)},
      input.bundle.concepts,
      input.brain
    );
    const gate=originalityGate(raw,evidenceRefs);
    const blockers=[
      ...readiness.missingConcepts.map(key=>'missing-concept:'+key),
      ...readiness.repetitionConflicts.map(key=>'repetition-conflict:'+key),
      ...(gate.status==='pass'?[]:['originality-gate:'+gate.status])
    ];

    const draft:NextEpisodeCandidate={
      id:crypto.randomUUID(),
      workingTitle:raw.workingTitle.trim().slice(0,250),
      theme:raw.theme.trim().slice(0,1000),
      thesis:raw.thesis.trim().slice(0,2000),
      angle:raw.angle.trim().slice(0,2000),
      promise:raw.promise.trim().slice(0,2000),
      thumbnailConcept:raw.thumbnailConcept.trim().slice(0,2000),
      targetAudience:raw.targetAudience.trim().slice(0,1200),
      objective:raw.objective.trim().slice(0,2000),
      previousEpisodeConnection:raw.previousEpisodeConnection.trim().slice(0,2000),
      arcId:arcId(raw.arcRef,sources),
      prerequisiteConcepts,
      introducesConcepts,
      reinforcesConcepts,
      opensThreads:unique(raw.opensThreads).slice(0,20),
      resolvesThreads,
      repetitionKeys:unique(raw.repetitionKeys).slice(0,30),
      evidenceRefs,
      rationale:raw.rationale.trim().slice(0,2500),
      risks:unique(raw.risks).slice(0,12),
      originality:{
        discovery:raw.originality.discovery.trim().slice(0,2500),
        addedValue:raw.originality.addedValue.trim().slice(0,2500),
        copyResistance:raw.originality.copyResistance.trim().slice(0,2500),
        sourcePlan:raw.originality.sourcePlan.trim().slice(0,2500)
      },
      originalityGate:gate,
      narrativeReady:readiness.ready,
      blockers,
      evidenceStrength:'low'
    };
    return {
      ...draft,
      evidenceStrength:evidenceStrength(evidenceRefs,readiness.ready,sources)
    };
  });

  let recommended=candidates[input.model.recommendedIndex]??null;
  if(!recommended?.narrativeReady||recommended.originalityGate.status!=='pass'){
    recommended=[...candidates]
      .filter(item=>item.narrativeReady&&item.originalityGate.status==='pass')
      .sort((a,b)=>candidateScore(b)-candidateScore(a))[0]??null;
  }

  const limitations:string[]=[];
  if(!brainHasLearningType(input.brain,'audience')){
    limitations.push('O Channel Brain ainda não possui learnings de audiência; a decisão não pode alegar demanda do público.');
  }
  if(!brainHasLearningType(input.brain,'performance')){
    limitations.push('O Channel Brain ainda não possui learnings de performance; padrões de resultado histórico são limitados.');
  }
  if(!input.bundle.concepts.length){
    limitations.push('O Concept Graph está vazio; o gate narrativo consegue proteger repetição, mas não dependências conceituais.');
  }
  if(context.marketSignal==='unavailable'){
    limitations.push('Nenhum Evidence Pack NexLev nem opportunityId está disponível; sinal de mercado não foi usado como evidência.');
  }
  if(context.marketSignal==='nexlev-evidence'){
    limitations.push('Sinais NexLev sustentam descoberta recente, mas não demonstram causalidade de views, CTR, retenção ou receita.');
  }
  if(!candidates.some(item=>item.originalityGate.status==='pass')){
    limitations.push('Nenhum candidato passou no ORIGINALITY / ANTI-SLOP GATE; o plano não pode recomendar nem aceitar episódio até existir descoberta, tese, valor adicional, resistência à cópia e plano de evidências suficientes.');
  }

  const now=new Date().toISOString();
  return {
    kind:'next-episode-plan',
    id:input.id,
    channelId:input.channel.id,
    brainVersion:input.brain.version,
    generatedAt:now,
    context:{
      learningRefs:context.sources.filter(item=>item.type==='learning').map(item=>item.ref),
      threadRefs:context.sources.filter(item=>item.type==='thread').map(item=>item.ref),
      conceptRefs:context.sources.filter(item=>item.type==='concept').map(item=>item.ref),
      arcRefs:context.sources.filter(item=>item.type==='arc').map(item=>item.ref),
      recentEpisodeRefs:context.sources.filter(item=>item.type==='episode').map(item=>item.ref),
      marketSignal:context.marketSignal,
      evidenceSnapshot:context.sources.map(item=>({...item}))
    },
    candidates,
    recommendedCandidateId:recommended?.id??null,
    recommendationRationale:input.model.recommendationRationale.trim().slice(0,2500),
    limitations,
    review:{notes:''},
    updatedAt:now
  };
}

function brainHasLearningType(brain:ChannelBrain,type:'audience'|'performance'){
  return brain.learnings.some(item=>item.type===type&&(item.confidence==='medium'||item.confidence==='high'));
}

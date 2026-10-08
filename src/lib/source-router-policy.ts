import type { SceneTimecode, VisualBeat, VisualBeatSourcePreference } from './types';

export type SourceRouteAction =
  | 'owned'
  | 'wikimedia'
  | 'stock-image'
  | 'stock-video'
  | 'generated-image'
  | 'generated-video'
  | 'youtube-cc'
  | 'manual-archive'
  | 'manual-map'
  | 'manual-document';

export type SourceRoutePlan={
  sceneId:string;
  beatId:string|null;
  preference:VisualBeatSourcePreference|'legacy';
  query:string;
  actions:SourceRouteAction[];
  syntheticAllowed:boolean;
  rationale:string;
};

function firstBeat(scene:SceneTimecode):VisualBeat|null{
  return scene.visualBeats?.[0]??null;
}

function normalizedQuery(value:string){
  return value.trim().replace(/\s+/g,' ');
}

function canonicalBeatQuery(scene:SceneTimecode,beat:VisualBeat|null){
  const candidates=(beat?.queries??[])
    .map(normalizedQuery)
    .filter(Boolean);
  if(candidates.length){
    const narration=normalizedQuery(scene.narration).toLowerCase();
    const searchOriented=candidates.find(value=>value.toLowerCase()!==narration);
    return (searchOriented??candidates[0]).slice(0,500);
  }
  return (
    normalizedQuery(scene.visualIntent)||
    normalizedQuery(scene.promptDirection)||
    normalizedQuery(scene.narration)
  ).slice(0,500);
}

function routeQuery(
  scene:SceneTimecode,
  beat:VisualBeat|null,
  editorialQuery?:string
){
  const preference=beat?.sourcePreference??'legacy';
  const canonical=canonicalBeatQuery(scene,beat);
  const editorial=normalizedQuery(editorialQuery??'');

  // Scene Plan / Visual Beat is the source of truth for ordinary sourcing.
  // Visual Prompt directions can carry stale style/media wording (for example
  // "authentic map") after a Scene Plan route changes. Evidence-specific beats
  // may still use an enriched editorial query because their source class itself
  // is factual and explicit.
  const explicitDocumentaryEvidence=/^\s*documentary\s+evidence\s+for\s*:/i.test(editorial);
  if(
    editorial&&(
      explicitDocumentaryEvidence||
      preference==='archive-image'||preference==='document'||preference==='map'||preference==='legacy'
    )
  ){
    return editorial.slice(0,500);
  }
  return (canonical||editorial).slice(0,500);
}

export function sourceRouteExecutionKey(route:SourceRoutePlan){
  return JSON.stringify([
    route.preference,
    route.query.trim().replace(/\s+/g,' '),
    route.actions,
    route.syntheticAllowed
  ]);
}

export function sourceRouteForScene(
  scene:SceneTimecode,
  editorialQuery?:string
):SourceRoutePlan{
  const beat=firstBeat(scene);
  const preference=beat?.sourcePreference??'legacy';
  const query=routeQuery(scene,beat,editorialQuery);

  if(preference==='archive-image'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-archive'],
      syntheticAllowed:false,
      rationale:'Historical/archive beat: require authentic or reusable documentary imagery; never substitute modern stock or synthetic evidence.'
    };
  }
  if(preference==='document'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-document'],
      syntheticAllowed:false,
      rationale:'Documentary evidence beat: preserve factual provenance and avoid synthetic substitution.'
    };
  }
  if(preference==='map'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','manual-map'],
      syntheticAllowed:false,
      rationale:'Geographic beat: use a real map or sourced geographic asset.'
    };
  }
  if(preference==='stock-video'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','stock-video','stock-image','youtube-cc'],
      syntheticAllowed:false,
      rationale:'Live-action/motion beat: real footage first, still image as factual fallback.'
    };
  }
  if(preference==='stock-image'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','stock-image','stock-video','generated-image'],
      syntheticAllowed:true,
      rationale:'Image-led beat: sourced still image first, generation allowed only after real-source gaps.'
    };
  }
  if(preference==='generated'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','generated-image'],
      syntheticAllowed:true,
      rationale:'Synthetic/illustrative beat: generation is an explicit editorial choice.'
    };
  }
  if(preference==='mixed'){
    return {
      sceneId:scene.id,beatId:beat?.id??null,preference,query,
      actions:['owned','wikimedia','stock-video','stock-image','youtube-cc','generated-image'],
      syntheticAllowed:true,
      rationale:'Mixed beat: exhaust reusable and real sources before generation.'
    };
  }

  return {
    sceneId:scene.id,beatId:beat?.id??null,preference,query,
    actions:['owned','stock-image','generated-image'],
    syntheticAllowed:true,
    rationale:'Legacy scene without an explicit source preference.'
  };
}


export type SourceReuseObservation={
  sceneSequence:number;
  sourceStartSeconds?:number|null;
  sourceEndSeconds?:number|null;
};

export function sourceReuseDecision(input:{
  sourceType:'owned'|'stock';
  targetSequence:number;
  observations:SourceReuseObservation[];
  candidateStartSeconds?:number|null;
  candidateEndSeconds?:number|null;
}){
  const observations=input.observations.filter(item=>
    Number.isFinite(item.sceneSequence)&&item.sceneSequence!==input.targetSequence
  );
  const maxUses=input.sourceType==='owned'?8:4;

  if(observations.some(item=>Math.abs(item.sceneSequence-input.targetSequence)<=1)){
    return {
      ok:false as const,
      reason:'adjacent-source-reuse' as const,
      usageCount:observations.length,
      maxUses
    };
  }

  if(observations.length>=maxUses){
    return {
      ok:false as const,
      reason:'source-reuse-cap' as const,
      usageCount:observations.length,
      maxUses
    };
  }

  const start=Number(input.candidateStartSeconds);
  const end=Number(input.candidateEndSeconds);
  if(Number.isFinite(start)&&Number.isFinite(end)&&end-start>=.20){
    const span=end-start;
    const overlap=observations.some(item=>{
      const observedStart=Number(item.sourceStartSeconds);
      const observedEnd=Number(item.sourceEndSeconds);
      if(
        !Number.isFinite(observedStart)||!Number.isFinite(observedEnd)||
        observedEnd-observedStart<.20
      )return false;
      const overlapSeconds=Math.max(
        0,
        Math.min(end,observedEnd)-Math.max(start,observedStart)
      );
      const smaller=Math.min(span,observedEnd-observedStart);
      return smaller>0&&overlapSeconds/smaller>.25;
    });
    if(overlap){
      return {
        ok:false as const,
        reason:'overlapping-source-trim' as const,
        usageCount:observations.length,
        maxUses
      };
    }
  }

  return {
    ok:true as const,
    reason:null,
    usageCount:observations.length,
    maxUses
  };
}

export type SourceDiversityItem={
  sceneId:string;
  sceneSequence:number;
  payload:unknown;
};

function sourceDescriptor(payload:unknown){
  const item=payload&&typeof payload==='object'
    ?payload as Record<string,unknown>
    :{};
  const owned=item.owned&&typeof item.owned==='object'
    ?item.owned as Record<string,unknown>
    :{};
  const stock=item.stock&&typeof item.stock==='object'
    ?item.stock as Record<string,unknown>
    :{};
  const verified=item.verifiedStock&&typeof item.verifiedStock==='object'
    ?item.verifiedStock as Record<string,unknown>
    :{};

  const ownedAssetId=String(owned.assetId??'').trim();
  if(ownedAssetId){
    return {
      sourceType:'owned' as const,
      sourceKey:'owned:'+ownedAssetId,
      sourceStartSeconds:owned.sourceStartSeconds===undefined?null:Number(owned.sourceStartSeconds),
      sourceEndSeconds:owned.sourceEndSeconds===undefined?null:Number(owned.sourceEndSeconds)
    };
  }

  const providerAssetId=String(stock.providerAssetId??verified.providerAssetId??'').trim();
  const provider=String(verified.provider??item.provider??'').trim();
  if(providerAssetId){
    return {
      sourceType:'stock' as const,
      sourceKey:'stock:'+(provider||'unknown')+':'+providerAssetId,
      sourceStartSeconds:verified.sourceStartSeconds===undefined?null:Number(verified.sourceStartSeconds),
      sourceEndSeconds:verified.sourceEndSeconds===undefined?null:Number(verified.sourceEndSeconds)
    };
  }

  return null;
}

export function sourceDiversityAssessment(items:SourceDiversityItem[]){
  const observations=new Map<string,SourceReuseObservation[]>();
  const acceptedSceneIds:string[]=[];
  const rejected:Array<{
    sceneId:string;
    sceneSequence:number;
    sourceKey:string;
    reason:'adjacent-source-reuse'|'source-reuse-cap'|'overlapping-source-trim';
  }>=[];

  const ordered=[...items].sort((a,b)=>a.sceneSequence-b.sceneSequence);
  for(const item of ordered){
    const descriptor=sourceDescriptor(item.payload);
    if(!descriptor){
      acceptedSceneIds.push(item.sceneId);
      continue;
    }
    const prior=observations.get(descriptor.sourceKey)??[];
    const decision=sourceReuseDecision({
      sourceType:descriptor.sourceType,
      targetSequence:item.sceneSequence,
      observations:prior,
      candidateStartSeconds:descriptor.sourceStartSeconds,
      candidateEndSeconds:descriptor.sourceEndSeconds
    });
    if(!decision.ok){
      rejected.push({
        sceneId:item.sceneId,
        sceneSequence:item.sceneSequence,
        sourceKey:descriptor.sourceKey,
        reason:decision.reason
      });
      continue;
    }
    acceptedSceneIds.push(item.sceneId);
    prior.push({
      sceneSequence:item.sceneSequence,
      sourceStartSeconds:descriptor.sourceStartSeconds,
      sourceEndSeconds:descriptor.sourceEndSeconds
    });
    observations.set(descriptor.sourceKey,prior);
  }

  return {acceptedSceneIds,rejected};
}

export function routePrefersMotion(route:SourceRoutePlan){
  const videoIndex=route.actions.indexOf('stock-video');
  const imageIndex=route.actions.indexOf('stock-image');
  return videoIndex>=0&&(imageIndex<0||videoIndex<imageIndex);
}

export const VIDEO_FIRST_FALLBACK_POLICY_VERSION='video-first-v1';

export function motionRouteAssetSatisfied(input:{
  route:SourceRoutePlan;
  assetKind:string;
  payload?:unknown;
}){
  if(!routePrefersMotion(input.route))return true;
  const payload=input.payload&&typeof input.payload==='object'
    ?input.payload as Record<string,unknown>
    :{};
  if(input.assetKind==='video'){
    const rawQa=payload.visualQa;
    const qa=rawQa&&typeof rawQa==='object'
      ?rawQa as Record<string,unknown>
      :{};
    const rawMotion=qa.motion;
    const motion=rawMotion&&typeof rawMotion==='object'
      ?rawMotion as Record<string,unknown>
      :{};
    return qa.status==='pass'&&qa.staticGraphic!==true&&motion.meaningfulMotion===true;
  }
  const raw=payload.videoFirstFallback;
  const fallback=raw&&typeof raw==='object'
    ?raw as Record<string,unknown>
    :{};
  return fallback.policyVersion===VIDEO_FIRST_FALLBACK_POLICY_VERSION&&
    fallback.videoExhausted===true;
}

export function sourceRouteRequiresAuthenticEvidence(route:SourceRoutePlan){
  return (
    route.preference==='archive-image'||
    route.preference==='document'||
    route.preference==='map'||
    /^\s*documentary\s+evidence\s+for\s*:/i.test(route.query)||
    route.actions.some(action=>
      action==='manual-archive'||action==='manual-map'||action==='manual-document'
    )
  );
}

export function applyDocumentarySourcePolicy(
  route:SourceRoutePlan,
  documentaryMode:boolean
):SourceRoutePlan{
  if(!documentaryMode)return route;
  const explicitDocumentaryEvidence=/^\s*documentary\s+evidence\s+for\s*:/i.test(route.query);
  if(route.preference==='generated'&&!explicitDocumentaryEvidence)return route;
  if(route.preference==='generated'&&explicitDocumentaryEvidence){
    return {
      ...route,
      actions:['owned','stock-video','stock-image','wikimedia'],
      syntheticAllowed:false,
      rationale:route.rationale+' Documentary evidence directive: real reusable sources override inherited generated preference.'
    };
  }
  const withoutSynthetic=route.actions.filter(action=>action!=='generated-image');
  const actions=route.preference==='stock-image'
    ?([
      ...withoutSynthetic.filter(action=>action==='owned'),
      ...withoutSynthetic.filter(action=>action==='stock-video'),
      ...withoutSynthetic.filter(action=>action==='stock-image'),
      ...withoutSynthetic.filter(action=>
        action!=='owned'&&action!=='stock-video'&&action!=='stock-image'
      )
    ] as SourceRouteAction[])
    :withoutSynthetic;
  return {
    ...route,
    actions,
    syntheticAllowed:false,
    rationale:route.rationale+' Documentary mode: prefer real motion footage when available and disable synthetic fallback unless generation is explicitly selected as the beat source.'
  };
}

export function sourceYears(value:string){
  return [...new Set(value.match(/\b(?:18|19|20)\d{2}\b/g)??[])];
}

export function archiveTemporalEvidence(input:{
  query:string;
  sourceDate?:string|null;
  title?:string|null;
}){
  const expectedYears=sourceYears(input.query);
  if(!expectedYears.length){
    return {ok:true,required:false,expectedYears,observedYears:[] as string[],reason:null as string|null};
  }
  const observedYears=sourceYears(
    [input.sourceDate??'',input.title??''].filter(Boolean).join(' ')
  );
  if(!observedYears.length){
    return {
      ok:false,required:true,expectedYears,observedYears,
      reason:'archive-date-missing'
    };
  }
  const ok=expectedYears.some(year=>observedYears.includes(year));
  return {
    ok,required:true,expectedYears,observedYears,
    reason:ok?null:'archive-date-mismatch'
  };
}
import type { MediaLibraryItem, MediaLibrarySemantic } from '@/lib/types';

export function normalizeMediaTags(tags:string[]){
  return [...new Set(tags.map(tag=>tag.trim().toLowerCase()).filter(Boolean))].slice(0,50);
}

function normalizeSemanticList(values:string[]){
  return [...new Set(values.map(value=>value.trim().toLowerCase()).filter(Boolean))].slice(0,50);
}

export function normalizeMediaSemantic(input:Partial<MediaLibrarySemantic>|undefined):MediaLibrarySemantic{
  return {
    subjects:normalizeSemanticList(input?.subjects??[]),
    locations:normalizeSemanticList(input?.locations??[]),
    periods:normalizeSemanticList(input?.periods??[]),
    shotTypes:normalizeSemanticList(input?.shotTypes??[]),
    moods:normalizeSemanticList(input?.moods??[])
  };
}

export function voiceLibraryItemIsStale(input:{
  assetScriptVersion:number;
  assetTextHash:string;
  currentScriptVersion:number;
  currentTextHash:string;
}){
  return input.assetScriptVersion!==input.currentScriptVersion||
    input.assetTextHash!==input.currentTextHash;
}

export function sceneLibraryItemIsStale(input:{
  assetPromptSetVersion:number;
  assetPrompt:string;
  currentPromptSetVersion:number;
  currentPrompt:string|null;
}){
  return input.assetPromptSetVersion!==input.currentPromptSetVersion||
    input.currentPrompt===null||
    input.assetPrompt!==input.currentPrompt;
}

export function mediaLibrarySearch(
  items:MediaLibraryItem[],
  options:{
    query?:string;
    kind?:'all'|'image'|'video'|'audio';
    source?:'all'|'generated'|'uploaded'|'stock';
    favoritesOnly?:boolean;
    staleOnly?:boolean;
  }={}
){
  const query=(options.query??'').trim().toLowerCase();
  const kind=options.kind??'all';
  const source=options.source??'all';
  return items.filter(item=>{
    if(kind!=='all'&&item.mediaKind!==kind)return false;
    if(source!=='all'&&item.sourceType!==source)return false;
    if(options.favoritesOnly&&!item.favorite)return false;
    if(options.staleOnly&&!item.stale)return false;
    if(!query)return true;
    return [
      item.title,item.originalName,item.provider,item.sourceType,item.timecodeLabel,item.channelName,
      item.prompt,item.notes,...item.tags,
      ...item.semantic.subjects,...item.semantic.locations,...item.semantic.periods,
      ...item.semantic.shotTypes,...item.semantic.moods,
      item.stock?.creatorName,item.stock?.attributionLabel
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
}


export function visualSegmentSearchText(input:{
  title:string;
  summary:string;
  semantic:{
    subjects:string[];locations:string[];landmarks:string[];activities:string[];objects:string[];
    environments:string[];timeOfDay:string[];weather:string[];shotTypes:string[];cameraMotion:string[];
    moods:string[];visualStyle:string[];periods:string[];
  };
}){
  return [
    input.title,input.summary,
    ...input.semantic.subjects,...input.semantic.locations,...input.semantic.landmarks,
    ...input.semantic.activities,...input.semantic.objects,...input.semantic.environments,
    ...input.semantic.timeOfDay,...input.semantic.weather,...input.semantic.shotTypes,
    ...input.semantic.cameraMotion,...input.semantic.moods,...input.semantic.visualStyle,
    ...input.semantic.periods
  ].filter(Boolean).join(' ').toLowerCase();
}

export function scoreVisualSegment(query:string,segmentSearchText:string){
  const stop=new Set(['the','and','for','with','from','this','that','into','over','under','uma','para','com','das','dos','que','por','entre']);
  const tokens=(value:string)=>[...new Set(value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .split(/[^a-z0-9]+/).filter(token=>token.length>2&&!stop.has(token)))];
  const q=tokens(query);
  if(!q.length)return 0;
  const text=new Set(tokens(segmentSearchText));
  const matched=q.filter(token=>text.has(token)).length;
  const phrase=segmentSearchText.toLowerCase().includes(query.trim().toLowerCase())?1:0;
  return Math.min(1,(matched/q.length)*.85+phrase*.15);
}


export type ExactVisualMatchIntent={
  exactLocation?:string;
  landmarkAliases?:string[];
  shotTypes?:string[];
  cameraMotion?:string[];
  timeOfDay?:string[];
};

export type ExactVisualMatchScore={
  eligible:boolean;
  score:number;
  relevance:number;
  locationScore:number;
  landmarkScore:number;
  viewpointScore:number;
  timeScore:number;
  reasons:string[];
};

function exactMatchTokens(value:string){
  const stop=new Set(['the','and','for','with','from','this','that','into','over','under','uma','para','com','das','dos','que','por','entre']);
  return [...new Set(value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .split(/[^a-z0-9]+/).filter(token=>token.length>2&&!stop.has(token)))];
}

function tokenOverlap(expected:string,observed:string[]){
  const wanted=exactMatchTokens(expected);
  if(!wanted.length)return 1;
  const have=new Set(exactMatchTokens(observed.join(' ')));
  return wanted.filter(token=>have.has(token)).length/wanted.length;
}

function aliasesOverlap(aliases:string[],observed:string[]){
  if(!aliases.length)return 1;
  return Math.max(...aliases.map(alias=>tokenOverlap(alias,observed)),0);
}

export function scoreExactVisualSegment(input:{
  query:string;
  intent:ExactVisualMatchIntent;
  segment:{
    searchText:string;
    confidence:number;
    semantic:{
      locations:string[];
      landmarks:string[];
      shotTypes:string[];
      cameraMotion:string[];
      timeOfDay:string[];
    };
  };
}):ExactVisualMatchScore{
  const exactLocation=(input.intent.exactLocation??'').trim();
  const landmarkAliases=(input.intent.landmarkAliases??[]).map(value=>value.trim()).filter(Boolean);
  const desiredShotTypes=(input.intent.shotTypes??[]).map(value=>value.trim()).filter(Boolean);
  const desiredCameraMotion=(input.intent.cameraMotion??[]).map(value=>value.trim()).filter(Boolean);
  const desiredTime=(input.intent.timeOfDay??[]).map(value=>value.trim()).filter(Boolean);
  const semantic=input.segment.semantic;
  const locationEvidence=[...semantic.locations,...semantic.landmarks];
  const landmarkEvidence=[...semantic.landmarks,...semantic.locations];
  const locationScore=exactLocation?tokenOverlap(exactLocation,locationEvidence):1;
  const landmarkScore=aliasesOverlap(landmarkAliases,landmarkEvidence);
  const viewpointExpected=[...desiredShotTypes,...desiredCameraMotion];
  const viewpointObserved=[...semantic.shotTypes,...semantic.cameraMotion];
  const viewpointScore=viewpointExpected.length?tokenOverlap(viewpointExpected.join(' '),viewpointObserved):1;
  const timeScore=desiredTime.length?tokenOverlap(desiredTime.join(' '),semantic.timeOfDay):1;
  const relevance=scoreVisualSegment(input.query,input.segment.searchText);
  const locationEligible=!exactLocation||locationScore>=.5;
  const landmarkEligible=!landmarkAliases.length||landmarkScore>=.5;
  const eligible=locationEligible&&landmarkEligible;
  const weighted:Array<[number,number]>=[[relevance,.45],[Math.max(0,Math.min(1,input.segment.confidence)),.10]];
  if(exactLocation)weighted.push([locationScore,.20]);
  if(landmarkAliases.length)weighted.push([landmarkScore,.15]);
  if(viewpointExpected.length)weighted.push([viewpointScore,.07]);
  if(desiredTime.length)weighted.push([timeScore,.03]);
  const weight=weighted.reduce((sum,item)=>sum+item[1],0);
  const score=eligible?weighted.reduce((sum,[value,w])=>sum+value*w,0)/weight:0;
  const reasons=[
    exactLocation?(locationEligible?'exact-location-supported':'exact-location-missing'):'exact-location-not-required',
    landmarkAliases.length?(landmarkEligible?'landmark-supported':'landmark-missing'):'landmark-not-required',
    viewpointExpected.length?(viewpointScore>=.5?'viewpoint-aligned':'viewpoint-weak'):'viewpoint-not-required',
    desiredTime.length?(timeScore>=.5?'time-aligned':'time-weak'):'time-not-required'
  ];
  return {eligible,score,relevance,locationScore,landmarkScore,viewpointScore,timeScore,reasons};
}

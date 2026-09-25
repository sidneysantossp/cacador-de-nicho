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

export function visualSemanticSearchText(semantic:{
  subjects:string[];locations:string[];landmarks:string[];activities:string[];objects:string[];
  environments:string[];timeOfDay:string[];weather:string[];shotTypes:string[];cameraMotion:string[];
  moods:string[];visualStyle:string[];periods:string[];
}){
  return [
    ...semantic.subjects,...semantic.locations,...semantic.landmarks,
    ...semantic.activities,...semantic.objects,...semantic.environments,
    ...semantic.timeOfDay,...semantic.weather,...semantic.shotTypes,
    ...semantic.cameraMotion,...semantic.moods,...semantic.visualStyle,
    ...semantic.periods
  ].filter(Boolean).join(' ').toLowerCase();
}

function visualTokens(value:string){
  const stop=new Set(['the','and','for','with','from','this','that','into','over','under','uma','para','com','das','dos','que','por','entre']);
  return [...new Set(value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/).filter(token=>token.length>2&&!stop.has(token)))];
}

export function scoreVisualIntent(query:string,visualSearchText:string,contextSearchText:string){
  const queryTokens=visualTokens(query);
  const contextTokens=new Set(visualTokens(contextSearchText));
  const intentTokens=queryTokens.filter(token=>!contextTokens.has(token));
  const contextRelevance=scoreVisualSegment(query,contextSearchText);
  if(!intentTokens.length){
    return {
      hasVisualIntent:false,
      intentQuery:'',
      visualRelevance:0,
      visualCoverage:0,
      matchedIntentTokens:0,
      intentTokenCount:0,
      contextRelevance
    };
  }
  const intentQuery=intentTokens.join(' ');
  const visualTokenSet=new Set(visualTokens(visualSearchText));
  const matchedIntentTokens=intentTokens.filter(token=>visualTokenSet.has(token)).length;
  return {
    hasVisualIntent:true,
    intentQuery,
    visualRelevance:scoreVisualSegment(intentQuery,visualSearchText),
    visualCoverage:matchedIntentTokens/intentTokens.length,
    matchedIntentTokens,
    intentTokenCount:intentTokens.length,
    contextRelevance
  };
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


export function libraryFirstSceneQuery(input:{
  visualIntent?:string|null;
  direction?:string|null;
  prompt?:string|null;
  narration?:string|null;
}){
  const source=[
    input.visualIntent,
    input.direction,
    input.prompt,
    input.narration
  ].map(value=>String(value??'').trim()).find(Boolean)??'';
  return source
    .replace(/\b(?:real[ -]?)?current[ -]?location stock only\b/gi,' ')
    .replace(/\bstock only\b/gi,' ')
    .replace(/\bexact[ -]?location comparison\b/gi,' ')
    .replace(/\b(?:16\s*:\s*9|9\s*:\s*16)\b/g,' ')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:])/g,'$1')
    .replace(/\.{2,}/g,'.')
    .replace(/[,;:]\s*$/,'')
    .trim();
}

export function libraryFirstMatchAccepted(
  match:{score:number;visualCoverage?:number},
  minimumScore=.45
){
  const score=Number(match.score);
  const visualCoverage=Number(match.visualCoverage??0);
  return Number.isFinite(score)&&score>=minimumScore&&
    Number.isFinite(visualCoverage)&&visualCoverage>=.40;
}

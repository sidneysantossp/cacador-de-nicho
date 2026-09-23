import type { MediaLibraryItem } from '@/lib/types';

export function normalizeMediaTags(tags:string[]){
  return [...new Set(tags.map(tag=>tag.trim().toLowerCase()).filter(Boolean))].slice(0,50);
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
      item.title,item.originalName,item.provider,item.sourceType,item.timecodeLabel,
      item.prompt,item.notes,...item.tags,item.stock?.creatorName,item.stock?.attributionLabel
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
}

import type { SceneAsset, SceneAssetKind, VisualScenePrompt } from '@/lib/types';

export const googleImageModels=[
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image'
] as const;

export const googleVideoModels=[
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-lite-generate-preview'
] as const;

export type GoogleImageModel=typeof googleImageModels[number];
export type GoogleVideoModel=typeof googleVideoModels[number];

export function validVideoGeneration(modelId:string,resolution:string,durationSeconds:number){
  if(!googleVideoModels.includes(modelId as GoogleVideoModel))return false;
  if(!['720p','1080p','4k'].includes(resolution))return false;
  if(![4,6,8].includes(durationSeconds))return false;
  if(resolution!=='720p'&&durationSeconds!==8)return false;
  if(modelId==='veo-3.1-lite-generate-preview'&&resolution==='4k')return false;
  return true;
}

export function assetKindForMime(mime:string):SceneAssetKind|null{
  if(/^image\/(?:png|jpeg|webp)$/i.test(mime))return 'image';
  if(/^video\/(?:mp4|webm|quicktime)$/i.test(mime))return 'video';
  return null;
}

export function assetIsStale(
  asset:Pick<SceneAsset,'promptSetVersion'|'prompt'>,
  promptSetVersion:number,
  currentPrompt:Pick<VisualScenePrompt,'prompt'>
){
  return asset.promptSetVersion!==promptSetVersion||asset.prompt!==currentPrompt.prompt;
}

export function generationLabel(asset:Pick<SceneAsset,'sourceType'|'provider'|'modelId'>){
  if(asset.sourceType==='uploaded')return 'External upload';
  return [asset.provider,asset.modelId].filter(Boolean).join(' · ')||'Generated';
}

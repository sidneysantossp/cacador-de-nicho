import type { EpisodeScript, VoiceAsset } from '@/lib/types';

export const voiceModelCharacterLimits={
  eleven_flash_v2_5:40000,
  eleven_multilingual_v2:10000
} as const;

export type SupportedVoiceModel=keyof typeof voiceModelCharacterLimits;

export function voiceGenerationIssues(textLength:number,modelId:string){
  const issues:string[]=[];
  const limit=voiceModelCharacterLimits[modelId as SupportedVoiceModel];
  if(!limit)issues.push('unsupported-model');
  else if(textLength>limit)issues.push('text-too-long');
  if(textLength<=0)issues.push('empty-script');
  return issues;
}

export function voiceAssetIsStale(
  asset:Pick<VoiceAsset,'scriptVersion'|'textHash'>,
  script:Pick<EpisodeScript,'version'>,
  currentTextHash:string
){
  return asset.scriptVersion!==script.version||asset.textHash!==currentTextHash;
}


export const voiceDownstreamStages=[
  'transcript','scenes','visual-prompts','visual-assets','timeline',
  'video-edit','render','quality','packaging','publish'
] as const;

export function voicePipelineIssues(input:{
  ready:boolean;
  selected:boolean;
  stale:boolean;
}){
  const issues:string[]=[];
  if(!input.ready)issues.push('voice-not-ready');
  if(!input.selected)issues.push('voice-not-selected');
  if(input.stale)issues.push('voice-stale');
  return issues;
}

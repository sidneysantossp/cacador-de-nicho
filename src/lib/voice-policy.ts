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

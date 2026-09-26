import type { EpisodeScript, VoiceAlignment, VoiceAsset } from '@/lib/types';

export const voiceModelCharacterLimits={
  eleven_flash_v2_5:40000,
  eleven_multilingual_v2:10000
} as const;

export type SupportedVoiceModel=keyof typeof voiceModelCharacterLimits;

export const maxLongFormVoiceCharacters=120000;
export const voiceChunkContextCharacters=100;

export type VoiceTextChunk={
  index:number;
  text:string;
  previousText:string;
  nextText:string;
  characterCount:number;
};

function preferredBreak(value:string,minIndex:number){
  const boundaries=[
    /\n\n/g,
    /[.!?][\"'”’)]?\s+/g,
    /[;:]\s+/g,
    /,\s+/g,
    /\s+/g
  ];
  for(const pattern of boundaries){
    let match:RegExpExecArray|null,last=-1;
    while((match=pattern.exec(value))){
      const end=match.index+match[0].length;
      if(end>=minIndex)last=end;
    }
    if(last>=minIndex)return last;
  }
  return value.length;
}

export function voiceChunkTarget(modelId:string){
  const limit=voiceModelCharacterLimits[modelId as SupportedVoiceModel];
  if(!limit)return null;
  return Math.max(1000,Math.min(18000,Math.floor(limit*.85)));
}

export function estimatedVoiceChunkCount(textLength:number,modelId:string){
  const target=voiceChunkTarget(modelId);
  if(!target||textLength<=0)return 0;
  return Math.max(1,Math.ceil(textLength/target));
}

export function splitVoiceText(text:string,modelId:string):VoiceTextChunk[]{
  const target=voiceChunkTarget(modelId);
  if(!target)return [];
  const normalized=text.replace(/\r\n/g,'\n').trim();
  if(!normalized)return [];

  const parts:string[]=[];
  let remaining=normalized;
  while(remaining.length>target){
    const window=remaining.slice(0,target);
    const cut=preferredBreak(window,Math.floor(target*.55));
    const part=remaining.slice(0,cut).trim();
    if(!part)break;
    parts.push(part);
    remaining=remaining.slice(cut).trimStart();
  }
  if(remaining.trim())parts.push(remaining.trim());

  return parts.map((part,index)=>({
    index,
    text:part,
    previousText:index>0?parts[index-1].slice(-voiceChunkContextCharacters):'',
    nextText:index<parts.length-1?parts[index+1].slice(0,voiceChunkContextCharacters):'',
    characterCount:part.length
  }));
}

export function mergeVoiceAlignments(
  parts:Array<{alignment:VoiceAlignment;offsetSeconds:number}>
):VoiceAlignment|undefined{
  const characters:string[]=[];
  const starts:number[]=[];
  const ends:number[]=[];

  for(const part of parts){
    const alignment=part.alignment;
    if(
      alignment.characters.length!==alignment.characterStartTimesSeconds.length||
      alignment.characters.length!==alignment.characterEndTimesSeconds.length
    )return undefined;

    if(
      characters.length&&
      !/\s/.test(characters.at(-1)??'')&&
      !/\s/.test(alignment.characters[0]??'')
    ){
      characters.push(' ');
      starts.push(part.offsetSeconds);
      ends.push(part.offsetSeconds);
    }

    for(let index=0;index<alignment.characters.length;index++){
      characters.push(alignment.characters[index]);
      starts.push(Number((alignment.characterStartTimesSeconds[index]+part.offsetSeconds).toFixed(6)));
      ends.push(Number((alignment.characterEndTimesSeconds[index]+part.offsetSeconds).toFixed(6)));
    }
  }

  return characters.length?{
    characters,
    characterStartTimesSeconds:starts,
    characterEndTimesSeconds:ends
  }:undefined;
}

export function voiceGenerationIssues(textLength:number,modelId:string){
  const issues:string[]=[];
  const limit=voiceModelCharacterLimits[modelId as SupportedVoiceModel];
  if(!limit)issues.push('unsupported-model');
  if(textLength<=0)issues.push('empty-script');
  if(textLength>maxLongFormVoiceCharacters)issues.push('text-too-long');
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

import type { EpisodeScriptPayload, EpisodeScriptSection } from '@/lib/types';

export function combineScriptSections(sections:EpisodeScriptSection[]){
  return sections.map(section=>section.content.trim()).filter(Boolean).join('\n\n');
}

export function countScriptWords(content:string){
  return content.trim()?content.trim().split(/\s+/).filter(Boolean).length:0;
}

export function estimateScriptMinutes(wordCount:number,paceWpm:number|null){
  if(!paceWpm||paceWpm<=0)return null;
  return Math.round((wordCount/paceWpm)*100)/100;
}

export function normalizeScriptPayload(
  payload:EpisodeScriptPayload,
  paceWpm:number|null
):EpisodeScriptPayload{
  const content=combineScriptSections(payload.sections);
  const wordCount=countScriptWords(content);
  return {
    ...payload,
    content,
    wordCount,
    estimatedMinutes:estimateScriptMinutes(wordCount,paceWpm)
  };
}

export function scriptApprovalIssues(payload:EpisodeScriptPayload){
  const issues:string[]=[];
  if(!payload.sections.length)issues.push('no-sections');
  if(!payload.content.trim())issues.push('empty-content');
  if(payload.factCheckWarnings.length)issues.push('fact-check-warnings');
  if(/\[VERIFY\]|\[VERIFICAR\]/i.test(payload.content))issues.push('verify-markers');
  return issues;
}

import type { ContentFactCheck, EpisodeScriptPayload, EpisodeScriptSection } from '@/lib/types';

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

function claimQualificationSatisfied(content:string,claim:ContentFactCheck){
  const text=content.toLowerCase();
  if(claim.narrationRule==='qualify'){
    return /\b(?:about|approximately|estimated|estimate|roughly|around|appears|likely|possibly|may have|believed|legend|tradition)\b/.test(text);
  }
  if(claim.narrationRule==='attribute'){
    return /\baccording to\b/.test(text)||
      /\b(?:records|documents|reports)\s+(?:show|indicate|state|say|suggest|describe)\b/.test(text)||
      /\b(?:was|were|is|are)\s+(?:reported|recorded|claimed|alleged|described)\b/.test(text)||
      /\b(?:claimed|alleged|reported|recorded|described)\s+by\b/.test(text)||
      /\b(?:archive|report|record|source|historian|newspaper|agency)\s+(?:says|states|reports|records|claims|describes)\b/.test(text);
  }
  return true;
}

export function documentaryScriptClaimIssues(input:{
  payload:EpisodeScriptPayload;
  claims:ContentFactCheck[];
  documentaryMode:boolean;
}){
  if(!input.documentaryMode)return [] as string[];
  const issues:string[]=[];
  const claimById=new Map(input.claims.map(claim=>[claim.id,claim]));
  const usableClaims=input.claims.filter(claim=>
    claim.status==='supported'&&claim.narrationRule!=='exclude'
  );
  if(!input.claims.length)issues.push('documentary-claim-ledger-empty');

  let linkedClaims=0;
  for(const section of input.payload.sections){
    const ids=[...new Set(section.claimIds??[])];
    linkedClaims+=ids.length;
    const numericAssertion=/\b\d{2,4}\b|[%$€£]/.test(section.content);
    if(numericAssertion&&!ids.length)issues.push('documentary-unlinked-factual-section:'+section.id);
    for(const id of ids){
      const claim=claimById.get(id);
      if(!claim){
        issues.push('documentary-unknown-claim:'+id);
        continue;
      }
      if(claim.status!=='supported')issues.push('documentary-claim-not-supported:'+id);
      if(claim.narrationRule==='exclude')issues.push('documentary-excluded-claim-used:'+id);
      if(!claim.claimType||!claim.narrationRule)issues.push('documentary-claim-metadata-missing:'+id);
      if(
        claim.status==='supported'&&
        claim.narrationRule&&
        claim.narrationRule!=='assert'&&
        claim.narrationRule!=='exclude'&&
        !claimQualificationSatisfied(section.content,claim)
      ){
        issues.push('documentary-uncertainty-language-missing:'+id);
      }
    }
  }

  if(usableClaims.length&&!linkedClaims)issues.push('documentary-script-without-claim-links');
  return [...new Set(issues)];
}

export function scriptApprovalIssues(
  payload:EpisodeScriptPayload,
  documentary?:{claims:ContentFactCheck[];documentaryMode:boolean}
){
  const issues:string[]=[];
  if(!payload.sections.length)issues.push('no-sections');
  if(!payload.content.trim())issues.push('empty-content');
  if(payload.factCheckWarnings.length)issues.push('fact-check-warnings');
  if(/\[VERIFY\]|\[VERIFICAR\]/i.test(payload.content))issues.push('verify-markers');
  if(documentary)issues.push(...documentaryScriptClaimIssues({
    payload,claims:documentary.claims,documentaryMode:documentary.documentaryMode
  }));
  return [...new Set(issues)];
}

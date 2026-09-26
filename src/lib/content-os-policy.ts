import type { ChannelBrain, ChannelConcept, ChannelEpisode, ContentProjectPayload } from '@/lib/types';
import { episodeNarrativeReadiness } from '@/lib/narrative-policy';

const requiredBriefFields: Array<keyof ContentProjectPayload['brief']>=[
  'theme','thesis','angle','promise','workingTitle','targetAudience','objective'
];

export function contentProjectReadiness(
  project:ContentProjectPayload,
  episode:ChannelEpisode,
  concepts:ChannelConcept[],
  brain:ChannelBrain|null,
  researchPolicy:{documentaryMode?:boolean;requireClaimLedger?:boolean}={}
){
  const missingBrief=requiredBriefFields.filter(key=>!project.brief[key].trim());
  const sourceIds=new Set(project.research.sources.map(source=>source.id));
  const factCheckSourceErrors=project.research.factChecks
    .filter(check=>check.sourceIds.some(id=>!sourceIds.has(id)))
    .map(check=>check.id);
  const pack=project.research.pack;
  const researchPackSourceErrors=[
    ...(pack?.timeline??[])
      .filter(item=>item.sourceIds.some(id=>!sourceIds.has(id)))
      .map(item=>'timeline:'+item.id),
    ...(pack?.audienceSignals??[])
      .filter(item=>!sourceIds.has(item.sourceId))
      .map(item=>'audience:'+item.id)
  ];
  const sourceById=new Map(project.research.sources.map(source=>[source.id,source]));
  const weakFactCheckEvidence=project.research.factChecks
    .filter(check=>check.status==='supported')
    .filter(check=>!check.sourceIds.some(id=>{
      const source=sourceById.get(id);
      if(!source)return false;
      if(source.origin==='reddit'||source.origin==='wikipedia')return false;
      if(source.role&&source.role!=='evidence')return false;
      if(source.role==='evidence')return true;
      return source.sourceType==='primary'||source.sourceType==='secondary';
    }))
    .map(check=>check.id);
  const unresolvedFactChecks=project.research.factChecks
    .filter(check=>check.narrationRule!=='exclude')
    .filter(check=>check.status==='unverified'||check.status==='needs-review')
    .map(check=>check.id);
  const contradictedFactChecks=project.research.factChecks
    .filter(check=>check.narrationRule!=='exclude')
    .filter(check=>check.status==='contradicted')
    .map(check=>check.id);

  const documentaryMode=Boolean(researchPolicy.documentaryMode||researchPolicy.requireClaimLedger);
  const claimLedgerEmpty=documentaryMode&&project.research.factChecks.length===0;
  const missingClaimMetadata=documentaryMode
    ?project.research.factChecks
      .filter(check=>!check.claimType||!check.narrationRule)
      .map(check=>check.id)
    :[];
  const invalidNarrationRules=documentaryMode
    ?project.research.factChecks
      .filter(check=>{
        if(!check.claimType||!check.narrationRule)return false;
        if(check.narrationRule==='exclude')return false;
        if(check.claimType==='fact')return !['assert','qualify','attribute'].includes(check.narrationRule);
        if(check.claimType==='estimate')return !['qualify','attribute'].includes(check.narrationRule);
        if(check.claimType==='allegation')return check.narrationRule!=='attribute';
        return !['qualify','attribute'].includes(check.narrationRule);
      })
      .map(check=>check.id)
    :[];
  const narrative=episodeNarrativeReadiness(episode,concepts,brain);

  const blockers=[
    ...missingBrief.map(field=>'brief:'+String(field)),
    ...factCheckSourceErrors.map(id=>'fact-check-source:'+id),
    ...researchPackSourceErrors.map(id=>'research-pack-source:'+id),
    ...weakFactCheckEvidence.map(id=>'fact-check-evidence:'+id),
    ...unresolvedFactChecks.map(id=>'fact-check-unresolved:'+id),
    ...contradictedFactChecks.map(id=>'fact-check-contradicted:'+id),
    ...(claimLedgerEmpty?['claim-ledger-empty']:[]),
    ...missingClaimMetadata.map(id=>'claim-ledger-metadata:'+id),
    ...invalidNarrationRules.map(id=>'claim-ledger-narration:'+id),
    ...narrative.missingConcepts.map(key=>'narrative-missing:'+key),
    ...narrative.repetitionConflicts.map(key=>'repetition-conflict:'+key)
  ];

  return {
    ready:blockers.length===0,
    blockers,
    missingBrief,
    factCheckSourceErrors,
    researchPackSourceErrors,
    weakFactCheckEvidence,
    unknownVisualRights:(pack?.visualLeads??[]).filter(item=>item.rightsStatus==='unknown').map(item=>item.id),
    unresolvedFactChecks,
    contradictedFactChecks,
    documentaryMode,
    claimLedgerEmpty,
    missingClaimMetadata,
    invalidNarrationRules,
    narrative
  };
}

export function contentProjectStage(project:ContentProjectPayload){
  if(project.approval.status==='blocked')return 'blocked' as const;
  if(project.approval.status==='approved')return 'approved' as const;
  if(project.approval.status==='ready')return 'review' as const;
  const pack=project.research.pack;
  const hasPack=!!pack&&(
    !!pack.question.trim()||
    !!pack.storyAngle.trim()||
    pack.entities.length>0||
    pack.timeline.length>0||
    pack.audienceSignals.length>0||
    pack.visualLeads.length>0
  );
  if(project.research.sources.length||project.research.factChecks.length||project.research.notes.trim()||hasPack)return 'research' as const;
  return 'brief' as const;
}

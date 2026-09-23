import type { ChannelBrain, ChannelConcept, ChannelEpisode, ContentProjectPayload } from '@/lib/types';
import { episodeNarrativeReadiness } from '@/lib/narrative-policy';

const requiredBriefFields: Array<keyof ContentProjectPayload['brief']>=[
  'theme','thesis','angle','promise','workingTitle','targetAudience','objective'
];

export function contentProjectReadiness(
  project:ContentProjectPayload,
  episode:ChannelEpisode,
  concepts:ChannelConcept[],
  brain:ChannelBrain|null
){
  const missingBrief=requiredBriefFields.filter(key=>!project.brief[key].trim());
  const sourceIds=new Set(project.research.sources.map(source=>source.id));
  const factCheckSourceErrors=project.research.factChecks
    .filter(check=>check.sourceIds.some(id=>!sourceIds.has(id)))
    .map(check=>check.id);
  const unresolvedFactChecks=project.research.factChecks
    .filter(check=>check.status==='unverified'||check.status==='needs-review')
    .map(check=>check.id);
  const contradictedFactChecks=project.research.factChecks
    .filter(check=>check.status==='contradicted')
    .map(check=>check.id);
  const narrative=episodeNarrativeReadiness(episode,concepts,brain);

  const blockers=[
    ...missingBrief.map(field=>`brief:${String(field)}`),
    ...factCheckSourceErrors.map(id=>`fact-check-source:${id}`),
    ...unresolvedFactChecks.map(id=>`fact-check-unresolved:${id}`),
    ...contradictedFactChecks.map(id=>`fact-check-contradicted:${id}`),
    ...narrative.missingConcepts.map(key=>`narrative-missing:${key}`),
    ...narrative.repetitionConflicts.map(key=>`repetition-conflict:${key}`)
  ];

  return {
    ready:blockers.length===0,
    blockers,
    missingBrief,
    factCheckSourceErrors,
    unresolvedFactChecks,
    contradictedFactChecks,
    narrative
  };
}

export function contentProjectStage(project:ContentProjectPayload){
  if(project.approval.status==='blocked')return 'blocked' as const;
  if(project.approval.status==='approved')return 'approved' as const;
  if(project.approval.status==='ready')return 'review' as const;
  if(project.research.sources.length||project.research.factChecks.length||project.research.notes.trim())return 'research' as const;
  return 'brief' as const;
}

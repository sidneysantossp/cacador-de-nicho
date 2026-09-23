import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelBrain, ChannelConcept, ChannelEpisode } from '../src/lib/types';
import {
  conceptPrerequisitesMet,
  detectConceptDependencyCycles,
  episodeNarrativeReadiness,
  narrativeProgress,
  nextNarrativeConcepts
} from '../src/lib/narrative-policy';

const now='2026-09-23T15:00:00.000Z';
function concept(key:string,status:ChannelConcept['status']='unknown',prerequisiteKeys:string[]=[]):ChannelConcept{
  return {id:crypto.randomUUID(),channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',key,label:key,description:'',status,prerequisiteKeys,createdAt:now,updatedAt:now};
}
const brain={narrative:{doNotRepeat:['same banana joke']}} as unknown as ChannelBrain;

test('concept readiness requires prerequisite knowledge to be introduced or stronger',()=>{
  const saving=concept('saving','unknown');
  const assets=concept('assets','unknown',['saving']);
  assert.deepEqual(conceptPrerequisitesMet(assets,[saving,assets]),{ready:false,missing:['saving']});
  const introduced={...saving,status:'introduced' as const};
  assert.deepEqual(conceptPrerequisitesMet(assets,[introduced,assets]),{ready:true,missing:[]});
});

test('episode is blocked by missing knowledge and forbidden repetition',()=>{
  const episode={
    prerequisiteConcepts:['assets'],
    repetitionKeys:['same banana joke']
  } as Pick<ChannelEpisode,'prerequisiteConcepts'|'repetitionKeys'>;
  const result=episodeNarrativeReadiness(episode,[concept('assets','unknown')],brain);
  assert.equal(result.ready,false);
  assert.deepEqual(result.missingConcepts,['assets']);
  assert.deepEqual(result.repetitionConflicts,['same banana joke']);
});

test('concept graph detects circular dependencies',()=>{
  const items=[
    concept('assets','unknown',['saving']),
    concept('saving','unknown',['income']),
    concept('income','unknown',['assets'])
  ];
  assert.deepEqual(new Set(detectConceptDependencyCycles(items)),new Set(['assets','saving','income']));
});

test('next concepts prioritize concepts already introduced before unknown ready concepts',()=>{
  const items=[
    concept('saving','introduced'),
    concept('income','unknown'),
    concept('assets','unknown',['saving']),
    concept('investing','unknown',['assets'])
  ];
  assert.deepEqual(nextNarrativeConcepts(items).map(item=>item.key),['saving','income','assets','investing']);
});

test('narrative progress counts established active and unknown concepts',()=>{
  const result=narrativeProgress([
    concept('a','established'),
    concept('b','partial'),
    concept('c','introduced'),
    concept('d','unknown')
  ]);
  assert.deepEqual(result,{total:4,established:1,active:2,unknown:1,progressPct:25});
});

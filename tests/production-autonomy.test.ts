import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProductionAutonomy, type ProductionAutonomyInput } from '../src/lib/production-autonomy-policy';

function input(overrides:Partial<ProductionAutonomyInput>={}):ProductionAutonomyInput{
  const titles=Array.from({length:10},(_,titleIndex)=>({
    id:'t'+titleIndex,title:'Evidence title '+titleIndex,durationSeconds:8,
    beats:[1,2].map(beatIndex=>({id:'t'+titleIndex+'b'+beatIndex,durationSeconds:4,query:'Evidence title '+titleIndex,generationAllowed:false,factuality:'verified' as const,evidenceRefs:['market:'+titleIndex]}))
  }));
  const supply=titles.flatMap(title=>title.beats.map((beat,beatIndex)=>({id:title.id+beat.id,sourceIdentity:title.id+beat.id,source:'owned' as const,kind:'image' as const,ready:true,availability:'available' as const,storagePath:'r2/'+title.id+'/'+beat.id,durationSeconds:null,rights:'verified' as const,license:'owned',provenanceRef:'asset:'+beat.id,matches:[{titleId:title.id,beatId:beat.id,relevance:1,identityVerified:true}]})));
  return {market:{validated:true,status:'structural',evidenceRefs:['market:validated']},titles,supply,providers:[{id:'r2',status:'available',evidenceRef:'provider:r2'}],economics:{costUsd:2,cycleMinutes:30,operatorMinutes:1,evidenceRefs:['economics:observed'],basis:'observed'},automation:['research','claims','script','voice','transcript','scenes','asset-sourcing','rights','timeline','render','quality','packaging','publish','learning'].map(stage=>({stage:stage as ProductionAutonomyInput['automation'][number]['stage'],status:'automatic' as const,evidenceRef:'stage:'+stage})),generation:{available:true,evidenceRef:'generation:configured'},repeatability:[15,50,100].map(episodes=>({episodes:episodes as 15|50|100,distinctTitleCount:episodes,supplyCoveragePercent:90,evidenceRefs:['repeat:'+episodes]})),...overrides};
}

test('market validation remains a prerequisite even when manufacturing is complete',()=>{
  const result=evaluateProductionAutonomy(input({market:{validated:false,status:'hypothesis',evidenceRefs:['market:hypothesis']}}));
  assert.equal(result.status,'not-eligible');
  assert.ok(result.reasons.some(reason=>reason.code==='market-not-validated'));
});

test('approved fit measures duration-weighted owned coverage and respects four-second beats',()=>{
  const result=evaluateProductionAutonomy(input());
  assert.equal(result.status,'approved');
  assert.equal(result.coverage.supplyPercent,100);
  assert.equal(result.coverage.totalSeconds,80);
  assert.equal(result.coverage.allocations.every(item=>item.durationSeconds<=4),true);
});

test('unknown rights and provenance block a fit instead of becoming usable supply',()=>{
  const base=input();
  base.supply[0]={...base.supply[0],rights:'unknown',provenanceRef:null};
  const result=evaluateProductionAutonomy(base);
  assert.notEqual(result.status,'approved');
  assert.ok(result.reasons.some(reason=>reason.code==='visual-supply-evidence-unknown'||reason.code==='visual-needs-unresolved'));
});

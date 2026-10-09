import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateProductionAutonomy,
  type ProductionAutonomyInput
} from '../src/lib/production-autonomy-policy';

function fixture(target:'master'|'closed-loop'):ProductionAutonomyInput{
  const titles=Array.from({length:10},(_,index)=>({
    id:'title-'+index,
    title:'Evidence title '+index,
    durationSeconds:4,
    beats:[{
      id:'beat-'+index,
      durationSeconds:4,
      query:'evidence '+index,
      generationAllowed:false,
      factuality:'verified' as const,
      evidenceRefs:['market:'+index]
    }]
  }));
  const supply=titles.map(title=>({
    id:'asset-'+title.id,
    sourceIdentity:'source-'+title.id,
    source:'owned' as const,
    kind:'image' as const,
    ready:true,
    availability:'available' as const,
    storagePath:'r2/'+title.id,
    durationSeconds:null,
    rights:'verified' as const,
    license:'owned',
    provenanceRef:'asset:'+title.id,
    matches:[{titleId:title.id,beatId:title.beats[0].id,relevance:1,identityVerified:true}]
  }));
  const stages=[
    'research','claims','script','voice','transcript','scenes','asset-sourcing',
    'rights','timeline','render','quality','packaging','publish','learning'
  ] as const;
  return {
    market:{validated:true,status:'observed',evidenceRefs:['market:validated']},
    titles,
    supply,
    providers:[{id:'r2',status:'available',evidenceRef:'provider:r2'}],
    economics:{costUsd:2,cycleMinutes:30,operatorMinutes:1,evidenceRefs:['economics:observed'],basis:'observed'},
    automation:stages.map(stage=>({
      stage,
      status:(['packaging','publish','learning'] as string[]).includes(stage)?'unknown' as const:'automatic' as const,
      ...(stage==='packaging'||stage==='publish'||stage==='learning'?{}:{evidenceRef:'stage:'+stage})
    })),
    automationTarget:target,
    generation:{available:false},
    repeatability:[
      {episodes:15,distinctTitleCount:15,supplyCoveragePercent:100,evidenceRefs:['repeat:15']},
      {episodes:50,distinctTitleCount:50,supplyCoveragePercent:100,evidenceRefs:['repeat:50']},
      {episodes:100,distinctTitleCount:100,supplyCoveragePercent:100,evidenceRefs:['repeat:100']}
    ],
    preflight:{
      status:'completed',
      sampledBeatCount:10,
      representativeBeatIds:titles.map(title=>title.beats[0].id),
      materializedAssetCount:10,
      discoverableAssetCount:0,
      materialization:{attempted:2,succeeded:2,totalBytes:2000,cycleSeconds:2,operatorMinutes:0,evidenceRefs:['preflight:materialized']},
      evidenceRefs:['preflight:observed']
    }
  };
}

test('pre-pilot master target ends at quality and does not require downstream release evidence',()=>{
  const result=evaluateProductionAutonomy(fixture('master'));
  assert.equal(result.status,'approved');
  assert.equal(result.automationTarget,'master');
  assert.equal(result.scores.endToEndAutonomy,100);
  assert.equal(result.reasons.some(reason=>reason.code==='automation-stage-unverified'),false);
});

test('closed-loop target remains fail-closed without packaging publish and learning evidence',()=>{
  const result=evaluateProductionAutonomy(fixture('closed-loop'));
  assert.equal(result.status,'blocked');
  assert.equal(result.automationTarget,'closed-loop');
  assert.equal(result.reasons.some(reason=>reason.code==='automation-stage-unverified'),true);
});

test('server assigns master only to pre-pilot subjects',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/production-autonomy.ts'),'utf8');
  assert.match(source,/automationTarget:subject\.subjectType==='next-episode'\?'closed-loop':'master'/);
});

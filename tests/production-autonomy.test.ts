import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateProductionAutonomy, type ProductionAutonomyInput } from '../src/lib/production-autonomy-policy';

function input(overrides:Partial<ProductionAutonomyInput>={}):ProductionAutonomyInput{
  const titles=Array.from({length:10},(_,titleIndex)=>({
    id:'t'+titleIndex,title:'Evidence title '+titleIndex,durationSeconds:8,
    beats:[1,2].map(beatIndex=>({id:'t'+titleIndex+'b'+beatIndex,durationSeconds:4,query:'Evidence title '+titleIndex,generationAllowed:false,factuality:'verified' as const,evidenceRefs:['market:'+titleIndex]}))
  }));
  const supply=titles.flatMap(title=>title.beats.map((beat,beatIndex)=>({id:title.id+beat.id,sourceIdentity:title.id+beat.id,source:'owned' as const,kind:'image' as const,ready:true,availability:'available' as const,storagePath:'r2/'+title.id+'/'+beat.id,durationSeconds:null,rights:'verified' as const,license:'owned',provenanceRef:'asset:'+beat.id,matches:[{titleId:title.id,beatId:beat.id,relevance:1,identityVerified:true}]})));
  return {market:{validated:true,status:'structural',evidenceRefs:['market:validated']},titles,supply,providers:[{id:'r2',status:'available',evidenceRef:'provider:r2'}],economics:{costUsd:2,cycleMinutes:30,operatorMinutes:1,evidenceRefs:['economics:observed'],basis:'observed'},automation:['research','claims','script','voice','transcript','scenes','asset-sourcing','rights','timeline','render','quality','packaging','publish','learning'].map(stage=>({stage:stage as ProductionAutonomyInput['automation'][number]['stage'],status:'automatic' as const,evidenceRef:'stage:'+stage})),generation:{available:true,evidenceRef:'generation:configured'},repeatability:[15,50,100].map(episodes=>({episodes:episodes as 15|50|100,distinctTitleCount:episodes,supplyCoveragePercent:90,evidenceRefs:['repeat:'+episodes]})),preflight:{status:'completed',sampledBeatCount:10,representativeBeatIds:titles.slice(0,10).map(title=>title.beats[0].id),materializedAssetCount:supply.length,discoverableAssetCount:0,evidenceRefs:['preflight:observed']},...overrides};
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

test('discoverable stock is reported separately and never counted as ready',()=>{
  const base=input();
  base.supply=base.supply.map(asset=>({...asset,ready:false,storagePath:undefined,rights:'unknown' as const,license:null,provenanceRef:null,discovery:{provider:'pexels',sourceIdentity:asset.sourceIdentity,licensingState:'unknown' as const,candidateRelevance:1,acquisition:'materializable' as const,evidenceRef:'search:1'}}));
  const result=evaluateProductionAutonomy({...base,supply:base.supply.map(asset=>({...asset,source:'stock' as const}))});
  assert.equal(result.coverage.readySupplyCoverage.percent,0);
  assert.equal(result.coverage.discoverableSupplyCoverage.percent,100);
  assert.equal(result.coverage.projectedAutonomousCoverage.isProjection,true);
  assert.equal(result.supplyStatus,'supply-discoverable');
  assert.ok(result.coverage.classifications.some(item=>item.classification==='stock-discoverable'));
});

test('discoverable stock cannot be reused beyond its evidence limit',()=>{
  const base=input();
  const matches=base.titles.flatMap(title=>title.beats.map(beat=>({titleId:title.id,beatId:beat.id,relevance:1,identityVerified:false})));
  base.supply=[{id:'candidate-1',sourceIdentity:'pexels:1',source:'stock',kind:'video',ready:false,availability:'available',durationSeconds:20,rights:'unknown',license:'Pexels License',provenanceRef:'https://www.pexels.com/video/1/',matches,maxUses:1,discovery:{provider:'pexels',sourceIdentity:'pexels:1',licensingState:'verified',candidateRelevance:1,acquisition:'materializable',evidenceRef:'https://www.pexels.com/video/1/'}}];
  const result=evaluateProductionAutonomy(base);
  assert.equal(result.coverage.discoverableSupplyCoverage.seconds,4);
  assert.equal(result.coverage.discoverableSupplyCoverage.percent,5);
});

test('preflight is fail-closed when absent',()=>{
  const result=evaluateProductionAutonomy(input({preflight:undefined}));
  assert.notEqual(result.status,'approved');
  assert.ok(result.reasons.some(reason=>reason.code==='supply-preflight-incomplete'));
});

test('self-hosted promotion provisions autonomy env without exposing the secret',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-promote'),'utf8');
  assert.match(source,/PRODUCTION_AUTONOMY_WORKER_SECRET=/);
  assert.match(source,/secrets\.token_hex\(32\)/);
  assert.match(source,/PRODUCTION_AUTONOMY_WORKER_URL=https:\/\/cacadores\.159\.198\.40\.98\.sslip\.io\/api\/workers\/production-autonomy/);
  assert.match(source,/PRODUCTION_AUTONOMY_WORKER_POLL_MS=5000/);
  assert.doesNotMatch(source,/echo.*PRODUCTION_AUTONOMY_WORKER_SECRET/);
});

test('worker and unit have a graceful TERM path',()=>{
  const worker=readFileSync(resolve(process.cwd(),'scripts/production-autonomy-worker.mjs'),'utf8');
  const wrapper=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-production-autonomy-worker-sync'),'utf8');
  const unit=readFileSync(resolve(process.cwd(),'ops/self-hosted/systemd/cacadores-production-autonomy-worker-sync.service'),'utf8');
  assert.match(worker,/process\.once\('SIGTERM'/);
  assert.match(worker,/activeController\?\.abort/);
  assert.match(wrapper,/kill -TERM/);
  assert.match(wrapper,/wait "\$CHILD_PID"/);
  assert.match(unit,/TimeoutStopSec=20s/);
});

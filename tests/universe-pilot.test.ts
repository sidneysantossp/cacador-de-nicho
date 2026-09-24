import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUniversePilotDecision, resolveUniversePilotDecision } from '../src/lib/universe-pilot';
import type { UniverseMarketIntelligence } from '../src/lib/types';

function market(readiness:'pilot'|'investigate'):UniverseMarketIntelligence{
  return {
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T16:26:49Z',
    sourceCompetitorIds:['a','b','c'],
    dnaCount:3,
    curves:[{
      id:'curve:1',
      key:'curve-1',
      name:'Structural Curve',
      thesis:'T',
      mechanismSteps:['A','B','C'],
      supportingChannelIds:['a','b','c'],
      independentCreators:3,
      classification:'structural',
      clusters:['Engineering'],
      evidence:['E'],
      counterEvidence:[],
      recurringTitlePatterns:['Pattern'],
      transferableVariables:['Domain'],
      limitations:[]
    }],
    gaps:[{
      id:'gap:bridge',
      curveId:'curve:1',
      title:'Every Type of Bridge Failure Explained',
      targetSpace:'bridge engineering',
      targetKeywords:['bridge failures','suspension bridges'],
      preservedMechanism:'Taxonomy',
      changedVariable:'Bridge engineering',
      demandStatus:readiness==='pilot'?'observed':'partial',
      targetEvidenceChannelIds:readiness==='pilot'?['a','b']:['a'],
      demandEvidence:['Evidence'],
      sampleSaturation:'low',
      rationale:'R',
      risks:['Accuracy'],
      firstTests:['Every Type of Bridge Failure Explained']
    }],
    limitations:[]
  };
}

test('Universe pilot policy rejects unavailable and non-actionable market state',()=>{
  assert.deepEqual(resolveUniversePilotDecision(null,'gap:bridge'),{ok:false,reason:'market-unavailable'});
  assert.deepEqual(resolveUniversePilotDecision(market('pilot'),'gap:missing'),{ok:false,reason:'not-actionable'});
});

test('Universe pilot policy rejects INVESTIGAR and accepts only PILOT READY',()=>{
  assert.deepEqual(resolveUniversePilotDecision(market('investigate'),'gap:bridge'),{ok:false,reason:'not-pilot-ready'});
  const resolved=resolveUniversePilotDecision(market('pilot'),'gap:bridge');
  assert.equal(resolved.ok,true);
  if(resolved.ok){
    assert.equal(resolved.opportunity.readiness,'pilot-ready');
    assert.equal(resolved.opportunity.targetEvidenceCount,2);
  }
});

test('Universe pilot decision snapshots the Market evidence at decision time',()=>{
  const intelligence=market('pilot');
  const resolved=resolveUniversePilotDecision(intelligence,'gap:bridge');
  assert.equal(resolved.ok,true);
  if(!resolved.ok)return;

  const decision=buildUniversePilotDecision({
    id:'decision:1',
    createdAt:'2026-09-24T16:40:00Z',
    intelligence,
    opportunity:resolved.opportunity,
    decision:'approved',
    reason:'Pilot approved by operator.'
  });

  assert.equal(decision.kind,'universe-pilot');
  assert.equal(decision.channelId,'universe');
  assert.equal(decision.opportunityId,'gap:bridge');
  assert.equal(decision.decision,'approved');
  assert.equal(decision.marketGeneratedAt,intelligence.generatedAt);
  assert.equal(decision.readiness,'pilot-ready');
  assert.equal(decision.demandStatus,'observed');
  assert.equal(decision.targetEvidenceCount,2);
  assert.equal(decision.firstTest,'Every Type of Bridge Failure Explained');
});

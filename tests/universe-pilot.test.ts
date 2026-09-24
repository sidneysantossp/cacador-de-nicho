import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUniversePilotContentHandoff, buildUniversePilotDecision, resolveUniversePilotDecision } from '../src/lib/universe-pilot';
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
  assert.ok(decision.pilotBrief);
  assert.equal(decision.pilotBrief?.kind,'universe-pilot-brief');
  assert.equal(decision.pilotBrief?.decisionId,'decision:1');
  assert.equal(decision.pilotBrief?.gapId,'gap:bridge');
  assert.equal(decision.pilotBrief?.status,'approved-for-test');
  assert.equal(decision.pilotBrief?.nextGate,'produce-one-pilot');
  assert.equal(decision.pilotBrief?.evidence.curveClassification,'structural');
  assert.equal(decision.pilotBrief?.evidence.demandStatus,'observed');
  assert.deepEqual(decision.pilotBrief?.evidence.targetEvidenceChannelIds,['a','b']);
  assert.equal(decision.pilotBrief?.testPlan.episodeTitle,'Every Type of Bridge Failure Explained');
  assert.equal(decision.pilotBrief?.testPlan.successGate.some(item=>item.includes('baseline')),true);
  assert.equal(decision.pilotBrief?.testPlan.stopGate.some(item=>item.includes('série')),true);
});


test('rejected Universe pilot decision never creates an operational Pilot Brief',()=>{
  const intelligence=market('pilot');
  const resolved=resolveUniversePilotDecision(intelligence,'gap:bridge');
  assert.equal(resolved.ok,true);
  if(!resolved.ok)return;

  const decision=buildUniversePilotDecision({
    id:'decision:reject',
    createdAt:'2026-09-24T17:55:00Z',
    intelligence,
    opportunity:resolved.opportunity,
    decision:'rejected',
    reason:'Operator rejected the pilot.'
  });

  assert.equal(decision.decision,'rejected');
  assert.equal(decision.pilotBrief,undefined);
});

test('Pilot Brief is derived only from the approved Market snapshot and does not invent numeric success thresholds',()=>{
  const intelligence=market('pilot');
  const resolved=resolveUniversePilotDecision(intelligence,'gap:bridge');
  assert.equal(resolved.ok,true);
  if(!resolved.ok)return;

  const decision=buildUniversePilotDecision({
    id:'decision:brief',
    createdAt:'2026-09-24T18:00:00Z',
    intelligence,
    opportunity:resolved.opportunity,
    decision:'approved',
    reason:'Approved.'
  });
  const brief=decision.pilotBrief;
  assert.ok(brief);
  assert.equal(brief?.marketGeneratedAt,intelligence.generatedAt);
  assert.equal(brief?.curveName,'Structural Curve');
  assert.deepEqual(brief?.evidence.supportingChannelIds,['a','b','c']);
  assert.deepEqual(brief?.evidence.demandEvidence,['Evidence']);
  assert.equal(brief?.hypothesis.includes('sem assumir'),true);
  const gates=[...(brief?.testPlan.successGate??[]),...(brief?.testPlan.stopGate??[])].join(' ');
  assert.equal(/\b\d+(?:\.\d+)?%\b/.test(gates),false);
});


test('approved Universe Pilot Brief creates only a draft Content OS handoff',()=>{
  const intelligence=market('pilot');
  const resolved=resolveUniversePilotDecision(intelligence,'gap:bridge');
  assert.equal(resolved.ok,true);
  if(!resolved.ok)return;

  const decision=buildUniversePilotDecision({
    id:'11111111-1111-4111-8111-111111111111',
    createdAt:'2026-09-24T19:00:00Z',
    intelligence,
    opportunity:resolved.opportunity,
    decision:'approved',
    reason:'Approved by operator.'
  });

  const {episode,project}=buildUniversePilotContentHandoff({
    decision,
    channel:{
      id:'22222222-2222-4222-8222-222222222222',
      name:'Owned Channel',
      niche:'Engineering',
      format:'Long form',
      stage:'research',
      priority:'normal',
      description:'Owned engineering channel.',
      createdAt:'2026-09-01T00:00:00Z',
      updatedAt:'2026-09-24T19:00:00Z'
    },
    brain:null,
    sequence:4,
    episodeId:'33333333-3333-4333-8333-333333333333',
    projectId:'44444444-4444-4444-8444-444444444444',
    factCheckId:'55555555-5555-4555-8555-555555555555',
    createdAt:'2026-09-24T19:05:00Z'
  });

  assert.equal(episode.status,'idea');
  assert.equal(episode.sequence,4);
  assert.equal(episode.title,'Every Type of Bridge Failure Explained');
  assert.equal(project.approval.status,'draft');
  assert.equal(project.opportunityId,decision.id);
  assert.equal(project.brief.theme,'bridge engineering');
  assert.equal(project.brief.workingTitle,'Every Type of Bridge Failure Explained');
  assert.equal(project.brief.promise,'');
  assert.equal(project.brief.targetAudience,'');
  assert.equal(project.research.factChecks.length,1);
  assert.equal(project.research.factChecks[0].status,'unverified');
  assert.deepEqual(project.research.factChecks[0].sourceIds,[]);
  assert.equal(project.research.notes.includes(decision.pilotBrief!.id),true);
});

test('rejected Universe pilot cannot create a Content OS handoff',()=>{
  const intelligence=market('pilot');
  const resolved=resolveUniversePilotDecision(intelligence,'gap:bridge');
  assert.equal(resolved.ok,true);
  if(!resolved.ok)return;

  const decision=buildUniversePilotDecision({
    id:'66666666-6666-4666-8666-666666666666',
    createdAt:'2026-09-24T19:10:00Z',
    intelligence,
    opportunity:resolved.opportunity,
    decision:'rejected',
    reason:'Rejected by operator.'
  });

  assert.throws(()=>buildUniversePilotContentHandoff({
    decision,
    channel:{
      id:'77777777-7777-4777-8777-777777777777',
      name:'Owned Channel',
      niche:'Engineering',
      format:'Long form',
      stage:'research',
      priority:'normal',
      description:'',
      createdAt:'2026-09-01T00:00:00Z',
      updatedAt:'2026-09-24T19:10:00Z'
    },
    brain:null,
    sequence:1,
    episodeId:'88888888-8888-4888-8888-888888888888',
    projectId:'99999999-9999-4999-8999-999999999999',
    factCheckId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt:'2026-09-24T19:10:00Z'
  }),/precisa estar aprovado/);
});

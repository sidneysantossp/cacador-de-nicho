import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ChannelBrainPayload, PerformanceReport } from '../src/lib/types';
import {
  mergePerformanceReportIntoBrain, performanceLearningCandidates,
  performanceReportApplied
} from '../src/lib/learning-loop-policy';

const now='2026-09-23T23:30:00.000Z';

function brain():ChannelBrainPayload{
  return {
    kind:'channel-brain',
    channelId:'22222222-2222-4222-8222-222222222222',
    constitution:{
      premise:'Explain the future through Dino.',
      audience:'Adults interested in technology.',
      editorialPromise:'Plausible future scenarios.',
      worldview:'Evidence before hype.',
      tone:['ironic'],languageRules:['clear'],humor:['dry'],
      universeRules:['Dino observes humanity'],forbidden:['invent facts'],metaphors:['future as excavation']
    },
    characters:[],
    narrative:{
      currentArc:'AI and identity',stateSummary:'Dino has introduced automation.',
      establishedConcepts:['automation'],partialConcepts:['AI identity'],unknownConcepts:['AGI'],
      openThreads:['What work remains human?'],resolvedThreads:[],doNotRepeat:['basic AI definition'],
      nextConcepts:['identity after automation']
    },
    learnings:[{
      id:'operator:seed',type:'operator',statement:'Keep the ending question specific.',
      evidence:['Operator decision'],confidence:'high',createdAt:now
    }],
    createdAt:now,updatedAt:now
  };
}

function report(status:PerformanceReport['status']='approved'):PerformanceReport{
  return {
    kind:'performance-report',
    id:'33333333-3333-4333-8333-333333333333',
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'44444444-4444-4444-8444-444444444444',
    observationId:'55555555-5555-4555-8555-555555555555',
    observedAt:now,
    comparisons:[],
    retentionEvents:[],
    trafficSummary:[],
    commentSummary:{sampledComments:20,totalLikesInSample:80},
    diagnoses:[{
      id:'66666666-6666-4666-8666-666666666666',
      code:'mid-video-drop',
      area:'mid-video',
      evidence:['Retenção inicial acima da referência.','Queda de 14 p.p. entre 60s e 120s.'],
      hypothesis:'O trecho intermediário pode estar repetindo contexto antes de avançar a tese.',
      competingExplanation:'A queda pode vir de uma mudança específica na fonte de tráfego.',
      nextTest:'No próximo episódio, reduzir apenas a recapitulação intermediária e preservar o restante.',
      confidence:'medium'
    }],
    strongestSignals:['retentionFirstSecondsPercent acima da referência em 8%.'],
    weakestSignals:['averagePercentageViewed abaixo da referência em 12%.'],
    limitations:['Histórico do canal ainda é curto; tratar o padrão como hipótese.'],
    handoff:{
      nextAgent:'Learning Loop',
      question:'Qual parte é evidência repetível e qual pode ser acaso?',
      candidateHypothesisIds:['66666666-6666-4666-8666-666666666666']
    },
    review:{notes:'Aprovado para teste controlado.'},
    createdAt:now,updatedAt:now,
    version:2,status
  };
}

test('Learning Loop only creates candidates from approved reports',()=>{
  assert.equal(performanceLearningCandidates(report('review')).length,0);
  const rows=performanceLearningCandidates(report('approved'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].type,'performance');
  assert.equal(rows[0].confidence,'medium');
  assert.match(rows[0].id,/^performance:33333333-3333-4333-8333-333333333333:/);
});

test('Performance learning preserves evidence, competing explanation and next test',()=>{
  const learning=performanceLearningCandidates(report())[0];
  assert.ok(learning.evidence.some(item=>item.startsWith('Explicação concorrente:')));
  assert.ok(learning.evidence.some(item=>item.startsWith('Próximo teste:')));
  assert.ok(learning.evidence.some(item=>item.startsWith('Limitação do report:')));
  assert.match(learning.statement,/Hipótese de performance/);
});

test('Learning Loop merge changes only learnings and update timestamp',()=>{
  const before=brain();
  const constitution=structuredClone(before.constitution);
  const narrative=structuredClone(before.narrative);
  const characters=structuredClone(before.characters);
  const result=mergePerformanceReportIntoBrain(before,report());

  assert.equal(result.added.length,1);
  assert.deepEqual(result.brain.constitution,constitution);
  assert.deepEqual(result.brain.narrative,narrative);
  assert.deepEqual(result.brain.characters,characters);
  assert.equal(result.brain.learnings.length,2);
  assert.equal(performanceReportApplied(result.brain,report().id),true);
});

test('Learning Loop is idempotent for the same Performance Report',()=>{
  const first=mergePerformanceReportIntoBrain(brain(),report());
  const second=mergePerformanceReportIntoBrain(first.brain,report());
  assert.equal(first.added.length,1);
  assert.equal(second.added.length,0);
  assert.equal(second.brain.learnings.length,first.brain.learnings.length);
});

test('Script Engine supplies Channel Brain learnings to the model context',async()=>{
  const source=await readFile('src/lib/server/script-ai.ts','utf8');
  assert.match(source,/learnings:input\.brain\?\.learnings\?\?\[\]/);
});

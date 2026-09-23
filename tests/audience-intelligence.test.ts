import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AudienceIntelligenceReport, ChannelBrainPayload, PerformanceObservation
} from '../src/lib/types';
import {
  buildAudienceCommentSample, compileAudienceModelResult
} from '../src/lib/audience-intelligence-policy';
import {
  audienceLearningCandidates, mergeAudienceReportIntoBrain
} from '../src/lib/audience-learning-loop-policy';

const now='2026-09-23T23:50:00.000Z';

function observation():PerformanceObservation{
  return {
    kind:'performance-observation',
    id:'11111111-1111-4111-8111-111111111111',
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'33333333-3333-4333-8333-333333333333',
    externalVideoId:'video123',
    sourceType:'youtube-analytics',
    observedAt:now,
    metrics:{views:1000,commentCount:10},
    retentionCurve:[],
    trafficSources:[],
    comments:Array.from({length:10},(_,index)=>({
      text:index<5
        ?'Please make a follow-up explaining what happens to jobs next. '+index
        :'Interesting video, thank you. '+index,
      likes:index
    })),
    expectations:{},
    experiment:{changedVariables:[],notes:''},
    provenance:{sourceLabel:'YouTube comments'},
    createdAt:now
  };
}

function brain():ChannelBrainPayload{
  return {
    kind:'channel-brain',
    channelId:'22222222-2222-4222-8222-222222222222',
    constitution:{
      premise:'Premise',audience:'Adults',editorialPromise:'Promise',worldview:'Worldview',
      tone:[],languageRules:[],humor:[],universeRules:[],forbidden:[],metaphors:[]
    },
    characters:[],
    narrative:{
      currentArc:'Arc',stateSummary:'State',establishedConcepts:[],partialConcepts:[],
      unknownConcepts:[],openThreads:[],resolvedThreads:[],doNotRepeat:[],nextConcepts:[]
    },
    learnings:[],
    createdAt:now,updatedAt:now
  };
}

function audienceReport():AudienceIntelligenceReport{
  return {
    kind:'audience-intelligence',
    id:'44444444-4444-4444-8444-444444444444',
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'33333333-3333-4333-8333-333333333333',
    performanceReportId:'55555555-5555-4555-8555-555555555555',
    performanceReportVersion:2,
    observationId:'11111111-1111-4111-8111-111111111111',
    externalVideoId:'video123',
    sampleSize:10,
    analyzedCommentRefs:Array.from({length:10},(_,i)=>'c'+(i+1)),
    sentimentSampleCounts:{positive:5,neutral:5,negative:0,mixed:0},
    classifications:[],
    themes:[
      {
        id:'66666666-6666-4666-8666-666666666666',
        kind:'follow-up',
        label:'Pedido de continuação',
        insight:'Há um grupo recorrente pedindo aprofundamento sobre o impacto da IA no trabalho.',
        commentRefs:['c1','c2','c3','c4','c5'],
        nextAction:'Testar um episódio que avance especificamente para o futuro do trabalho.',
        confidence:'high',
        sampleSharePercent:50,
        totalLikesInEvidence:10
      },
      {
        id:'77777777-7777-4777-8777-777777777777',
        kind:'question',
        label:'Pergunta isolada',
        insight:'Um comentário pergunta sobre regulamentação.',
        commentRefs:['c6'],
        nextAction:'Não mudar o calendário por um único comentário.',
        confidence:'low',
        sampleSharePercent:10,
        totalLikesInEvidence:5
      }
    ],
    limitations:[
      'A amostra é parcial e não representa toda a audiência.',
      'Percentuais descrevem somente a amostra analisada.'
    ],
    provenance:{model:'gpt-test',sourceLabel:'YouTube comments'},
    review:{notes:'',approvedAt:now,approvedBy:'operator'},
    createdAt:now,updatedAt:now,
    version:2,status:'approved'
  };
}

test('Audience sample assigns stable refs and normalizes comment text',()=>{
  const sample=buildAudienceCommentSample(observation());
  assert.equal(sample.length,10);
  assert.equal(sample[0].ref,'c1');
  assert.equal(sample[9].ref,'c10');
  assert.equal(sample[0].likes,0);
});

test('Audience compiler rejects model references that do not exist',()=>{
  const sample=buildAudienceCommentSample(observation());
  assert.throws(()=>compileAudienceModelResult(sample,{
    classifications:[{commentRef:'c99',sentiment:'positive',intents:['praise']}],
    themes:[]
  }),/unknown comment/);
});

test('Audience confidence is calculated by server from repeated sample evidence',()=>{
  const sample=buildAudienceCommentSample(observation());
  const result=compileAudienceModelResult(sample,{
    classifications:sample.map(item=>({
      commentRef:item.ref,
      sentiment:'neutral' as const,
      intents:[] as []
    })),
    themes:[
      {
        kind:'follow-up',
        label:'Continuação',
        insight:'Pedidos recorrentes de continuação.',
        commentRefs:['c1','c2','c3','c4','c5'],
        nextAction:'Testar continuação.'
      },
      {
        kind:'question',
        label:'Isolado',
        insight:'Pergunta isolada.',
        commentRefs:['c6'],
        nextAction:'Observar antes de reagir.'
      }
    ]
  });
  assert.equal(result.themes[0].confidence,'high');
  assert.equal(result.themes[0].sampleSharePercent,50);
  assert.equal(result.themes[1].confidence,'low');
});

test('Partial audience classification stays explicit as a limitation',()=>{
  const sample=buildAudienceCommentSample(observation());
  const result=compileAudienceModelResult(sample,{
    classifications:[{commentRef:'c1',sentiment:'positive',intents:['praise']}],
    themes:[]
  });
  assert.ok(result.limitations.some(item=>item.includes('1 de 10')));
  assert.equal(result.sentimentSampleCounts.positive,1);
});

test('Audience Learning Loop only promotes medium/high confidence themes',()=>{
  const candidates=audienceLearningCandidates(audienceReport());
  assert.equal(candidates.length,1);
  assert.match(candidates[0].id,/^audience:44444444-4444-4444-8444-444444444444:/);
  assert.equal(candidates[0].confidence,'high');
  assert.ok(!candidates[0].evidence.some(item=>item.includes('Please make a follow-up')));
});

test('Audience Learning Loop merge is idempotent and preserves channel constitution',()=>{
  const original=brain();
  const constitution=structuredClone(original.constitution);
  const first=mergeAudienceReportIntoBrain(original,audienceReport());
  const second=mergeAudienceReportIntoBrain(first.brain,audienceReport());
  assert.equal(first.added.length,1);
  assert.equal(second.added.length,0);
  assert.deepEqual(second.brain.constitution,constitution);
  assert.equal(second.brain.learnings.length,1);
});

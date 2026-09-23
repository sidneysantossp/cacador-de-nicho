import test from 'node:test';
import assert from 'node:assert/strict';
import type { PerformanceObservation } from '../src/lib/types';
import {
  buildPerformanceReport, buildPerformanceComparisons, retentionEvents
} from '../src/lib/performance-policy';
import { performanceObservationPayloadSchema } from '../src/lib/server/validation';

const now='2026-09-23T22:45:00.000Z';
function observation(overrides:Partial<PerformanceObservation>={}):PerformanceObservation{
  return {
    kind:'performance-observation',
    id:crypto.randomUUID(),
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'33333333-3333-4333-8333-333333333333',
    externalVideoId:'video123',
    sourceType:'youtube-analytics',
    observedAt:now,
    metrics:{
      views:10000,
      ctrPercent:4,
      retentionFirstSecondsPercent:78,
      retention30Percent:62,
      averageViewDurationSeconds:360,
      averagePercentageViewed:50,
      watchTimeMinutes:60000,
      likes:800,
      commentCount:120,
      shares:55,
      subscribersGained:180,
      subscribersLost:12
    },
    retentionCurve:[
      {second:0,audiencePercent:100},
      {second:5,audiencePercent:78},
      {second:30,audiencePercent:62},
      {second:60,audiencePercent:58},
      {second:120,audiencePercent:42},
      {second:180,audiencePercent:45}
    ],
    trafficSources:[
      {source:'BROWSE',views:6000,watchTimeMinutes:36000},
      {source:'SUGGESTED',views:3000,watchTimeMinutes:18000},
      {source:'SEARCH',views:1000,watchTimeMinutes:6000}
    ],
    comments:[
      {text:'Great explanation',likes:20},
      {text:'I want a follow-up',likes:10}
    ],
    expectations:{ctrPercent:6,retention30Percent:55,retentionFirstSecondsPercent:75},
    experiment:{changedVariables:['thumbnail'],notes:'Only thumbnail changed.'},
    provenance:{sourceLabel:'YouTube Analytics API'},
    createdAt:now,
    ...overrides
  };
}

test('Performance comparisons prefer explicit operator expectations',()=>{
  const rows=buildPerformanceComparisons(observation(),[]);
  const ctr=rows.find(item=>item.metric==='ctrPercent')!;
  assert.equal(ctr.baseline,6);
  assert.equal(ctr.baselineSource,'operator-expectation');
  assert.equal(ctr.relation,'below');
  const r30=rows.find(item=>item.metric==='retention30Percent')!;
  assert.equal(r30.baseline,55);
  assert.equal(r30.relation,'above');
});

test('Performance Analyst diagnoses weak packaging while content holds',()=>{
  const report=buildPerformanceReport(observation(),[]);
  assert.ok(report.diagnoses.some(item=>item.code==='packaging-underperforming-content-holding'));
  const diagnosis=report.diagnoses.find(item=>item.code==='packaging-underperforming-content-holding')!;
  assert.equal(diagnosis.area,'packaging');
  assert.ok(diagnosis.competingExplanation.length>0);
  assert.ok(diagnosis.nextTest.includes('título')||diagnosis.nextTest.includes('thumbnail'));
});

test('Retention engine exposes strongest drops and later peaks',()=>{
  const events=retentionEvents(observation().retentionCurve);
  assert.ok(events.some(item=>item.type==='drop'&&item.fromSecond===60&&item.toSecond===120));
  assert.ok(events.some(item=>item.type==='peak'&&item.fromSecond===120&&item.toSecond===180));
});

test('Traffic summary converts views into shares without inventing missing data',()=>{
  const report=buildPerformanceReport(observation(),[]);
  assert.equal(report.trafficSummary[0].source,'BROWSE');
  assert.equal(report.trafficSummary[0].viewSharePercent,60);
  assert.equal(report.commentSummary.sampledComments,2);
  assert.equal(report.commentSummary.totalLikesInSample,30);
});

test('Historical median becomes baseline only after three prior observations',()=>{
  const current=observation({expectations:{}});
  const prior=[
    observation({id:crypto.randomUUID(),metrics:{views:8000}}),
    observation({id:crypto.randomUUID(),metrics:{views:10000}}),
    observation({id:crypto.randomUUID(),metrics:{views:12000}})
  ];
  const views=buildPerformanceComparisons(current,prior).find(item=>item.metric==='views')!;
  assert.equal(views.baseline,10000);
  assert.equal(views.baselineSource,'channel-median');
  assert.equal(views.baselineSampleSize,3);
  assert.equal(views.relation,'equal');
});

test('Short history stays explicit as a limitation instead of fabricating baseline',()=>{
  const current=observation({expectations:{},retentionCurve:[],comments:[]});
  const report=buildPerformanceReport(current,[
    observation({id:crypto.randomUUID(),metrics:{views:8000}}),
    observation({id:crypto.randomUUID(),metrics:{views:12000}})
  ]);
  assert.ok(report.limitations.some(item=>item.includes('Sem expectativas explícitas')));
  assert.ok(report.limitations.some(item=>item.includes('Histórico do canal ainda é curto')));
  assert.ok(report.limitations.some(item=>item.includes('Curva de retenção insuficiente')));
});

test('Performance Observation schema accepts YouTube Analytics payload',()=>{
  assert.equal(performanceObservationPayloadSchema.safeParse(observation()).success,true);
});

test('OAuth source requests analytics scope before first connection',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile('src/lib/server/youtube-oauth.ts','utf8');
  assert.match(source,/yt-analytics\.readonly/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareUniverseDnaPriority, selectUniverseDnaBatch, summarizeUniverseQueueRows, universeCompetitorDue, universeImportFailureIsPermanent } from '../src/lib/universe-policy';
import type { UniverseCompetitor } from '../src/lib/types';

function competitor(overrides:Partial<UniverseCompetitor>={}):UniverseCompetitor{
  return {
    kind:'competitor',
    id:'competitor:UCtest',
    channelId:'UCtest',
    name:'Test Channel',
    handle:'@test',
    url:'https://youtube.com/channel/UCtest',
    avatar:'',
    country:'US',
    language:'en',
    cluster:'History',
    subniche:'A classificar',
    format:'Long form',
    description:'',
    subscribers:10000,
    videoCount:20,
    createdAt:'2026-01-01T00:00:00Z',
    importedAt:'2026-09-01T00:00:00Z',
    lastMonitoredAt:'2026-09-22T00:00:00Z',
    monitoringTier:'active',
    status:'watch',
    recentAverageViews:100000,
    recentMedianViews:80000,
    recentVideoCount:10,
    uploadsLast30d:4,
    breakoutRatio:null,
    strongestRecentVideo:null,
    recentUploads:[],
    signals:[],
    signalDetails:[],
    snapshots:[],
    dnaTags:['History'],
    updatedAt:'2026-09-22T00:00:00Z',
    ...overrides
  };
}

test('Universe monitoring cadence respects hot, active, stable and dormant tiers',()=>{
  const now=Date.parse('2026-09-23T12:00:00Z');
  assert.equal(universeCompetitorDue(competitor({monitoringTier:'hot',lastMonitoredAt:'2026-09-23T05:00:00Z'}),now),true);
  assert.equal(universeCompetitorDue(competitor({monitoringTier:'active',lastMonitoredAt:'2026-09-22T13:00:00Z'}),now),false);
  assert.equal(universeCompetitorDue(competitor({monitoringTier:'stable',lastMonitoredAt:'2026-09-20T11:00:00Z'}),now),true);
  assert.equal(universeCompetitorDue(competitor({monitoringTier:'dormant',lastMonitoredAt:'2026-09-17T13:00:00Z'}),now),false);
});

test('DNA priority chooses missing DNA before a higher-status channel with fresh DNA',()=>{
  const missing=competitor({id:'missing',channelId:'missing',status:'watch'});
  const analyzed=competitor({
    id:'breakout',
    channelId:'breakout',
    status:'breakout',
    dna:{
      generatedAt:'2026-09-23T08:00:00Z',
      summary:'Resumo',
      primaryNiche:'History',
      subniche:'Military History',
      audienceIntent:'Aprender',
      editorialPromise:'Explicar eventos',
      formatSignature:'Documentary',
      contentPillars:['Wars','People'],
      recurringEntities:[],
      titlePatterns:['Why X','How X'],
      curiosityMechanisms:['Hidden cause','Unexpected consequence'],
      emotionalDrivers:['Curiosity'],
      differentiationSignals:[],
      limitations:['Sample only']
    }
  });
  assert.equal([analyzed,missing].sort(compareUniverseDnaPriority)[0].id,'missing');
});

test('among channels missing DNA, stronger operational status has priority',()=>{
  const watch=competitor({id:'watch',channelId:'watch',status:'watch'});
  const breakout=competitor({id:'breakout',channelId:'breakout',status:'breakout'});
  assert.equal([watch,breakout].sort(compareUniverseDnaPriority)[0].id,'breakout');
});

test('among equal-status channels, stronger corroborated signals outrank import order',()=>{
  const olderWeak=competitor({
    id:'older-weak',
    channelId:'older-weak',
    status:'breakout',
    importedAt:'2026-09-01T00:00:00Z',
    breakoutRatio:500,
    signals:['one'],
    signalDetails:[{kind:'breakout',strength:'high',title:'Breakout',evidence:'x',observedAt:'2026-09-23T00:00:00Z'}]
  });
  const newerStrong=competitor({
    id:'newer-strong',
    channelId:'newer-strong',
    status:'breakout',
    importedAt:'2026-09-22T00:00:00Z',
    breakoutRatio:20,
    signals:['one','two','three'],
    signalDetails:[
      {kind:'breakout',strength:'high',title:'Breakout',evidence:'x',observedAt:'2026-09-23T00:00:00Z'},
      {kind:'internal-outlier',strength:'high',title:'Outlier',evidence:'y',observedAt:'2026-09-23T00:00:00Z'},
      {kind:'repeat-hit',strength:'high',title:'Repeat',evidence:'z',observedAt:'2026-09-23T00:00:00Z'}
    ]
  });
  assert.equal([olderWeak,newerStrong].sort(compareUniverseDnaPriority)[0].id,'newer-strong');
});

test('breakout ratio breaks ties after status and signal strength',()=>{
  const smaller=competitor({
    id:'smaller',
    channelId:'smaller',
    status:'breakout',
    breakoutRatio:12,
    signalDetails:[{kind:'breakout',strength:'high',title:'Breakout',evidence:'x',observedAt:'2026-09-23T00:00:00Z'}]
  });
  const larger=competitor({
    id:'larger',
    channelId:'larger',
    status:'breakout',
    breakoutRatio:42,
    signalDetails:[{kind:'breakout',strength:'high',title:'Breakout',evidence:'x',observedAt:'2026-09-23T00:00:00Z'}]
  });
  assert.equal([smaller,larger].sort(compareUniverseDnaPriority)[0].id,'larger');
});


test('automatic DNA batches never reanalyze channels that already have DNA',()=>{
  const ready=competitor({
    id:'ready',
    channelId:'ready',
    status:'production-reference',
    dna:{
      generatedAt:'2026-09-23T08:00:00Z',
      summary:'Resumo',
      primaryNiche:'History',
      subniche:'Military History',
      audienceIntent:'Aprender',
      editorialPromise:'Explicar eventos',
      formatSignature:'Documentary',
      contentPillars:['Wars','People'],
      recurringEntities:[],
      titlePatterns:['Why X','How X'],
      curiosityMechanisms:['Hidden cause','Unexpected consequence'],
      emotionalDrivers:['Curiosity'],
      differentiationSignals:[],
      limitations:['Sample only']
    }
  });
  const pendingA=competitor({id:'pending-a',channelId:'pending-a',status:'watch'});
  const pendingB=competitor({id:'pending-b',channelId:'pending-b',status:'breakout'});
  const batch=selectUniverseDnaBatch([ready,pendingA,pendingB],5);
  assert.deepEqual(batch.map(item=>item.id),['pending-b','pending-a']);
});

test('automatic DNA batches are capped at five competitors',()=>{
  const items=Array.from({length:8},(_,index)=>competitor({id:`p-${index}`,channelId:`p-${index}`}));
  assert.equal(selectUniverseDnaBatch(items,25).length,5);
});


test('permanent Universe import failures stop retrying 404 and missing channels',()=>{
  assert.equal(universeImportFailureIsPermanent('YouTube indisponível (HTTP 404).'),true);
  assert.equal(universeImportFailureIsPermanent('Canal do YouTube não encontrado.'),true);
  assert.equal(universeImportFailureIsPermanent('Channel not found'),true);
  assert.equal(universeImportFailureIsPermanent('YouTube indisponível (HTTP 429).'),false);
  assert.equal(universeImportFailureIsPermanent('Falha temporária de rede.'),false);
});


test('Universe queue progress counts terminal failures as resolved without counting them as competitors',()=>{
  const summary=summarizeUniverseQueueRows([
    ...Array.from({length:223},()=>({status:'completed' as const,attempts:1})),
    ...Array.from({length:5},()=>({status:'failed' as const,attempts:3}))
  ]);
  assert.equal(summary.completed,223);
  assert.equal(summary.terminalFailed,5);
  assert.equal(summary.retryable,0);
  assert.equal(summary.resolved,228);
  assert.equal(summary.progressPct,100);
});

test('retryable Universe failures remain unresolved',()=>{
  const summary=summarizeUniverseQueueRows([
    {status:'completed',attempts:1},
    {status:'failed',attempts:1}
  ]);
  assert.equal(summary.resolved,1);
  assert.equal(summary.retryable,1);
  assert.equal(summary.progressPct,50);
});

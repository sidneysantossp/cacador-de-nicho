import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUniverseCurveEvidence, selectUniverseMissionOpportunities, universeCurveClassification, universeGapDemandStatus } from '../src/lib/universe-market';
import type { UniverseCompetitor, UniverseMarketIntelligence } from '../src/lib/types';

function competitor(id:string,cluster:string,status:UniverseCompetitor['status']='watch'):UniverseCompetitor{
  return {
    kind:'competitor',
    id:'competitor:'+id,
    channelId:id,
    name:id,
    handle:'@'+id,
    url:'https://youtube.com/channel/'+id,
    avatar:'',
    country:'US',
    language:'en',
    cluster,
    subniche:'Sub',
    format:'Long form',
    description:'',
    subscribers:1000,
    videoCount:20,
    createdAt:'2026-01-01T00:00:00Z',
    importedAt:'2026-09-01T00:00:00Z',
    lastMonitoredAt:'2026-09-23T00:00:00Z',
    monitoringTier:'active',
    status,
    recentAverageViews:100000,
    recentMedianViews:80000,
    recentVideoCount:10,
    uploadsLast30d:4,
    breakoutRatio:status==='breakout'?3:null,
    strongestRecentVideo:null,
    recentUploads:[],
    signals:[],
    signalDetails:[],
    snapshots:[],
    dna:{
      generatedAt:'2026-09-23T00:00:00Z',
      summary:'Resumo',
      primaryNiche:cluster,
      subniche:'Sub',
      audienceIntent:'Intent',
      editorialPromise:'Promise',
      formatSignature:'Documentary',
      contentPillars:['A','B'],
      recurringEntities:[],
      titlePatterns:['Why X','How X'],
      curiosityMechanisms:['Hidden cause','Unexpected consequence'],
      emotionalDrivers:['Curiosity'],
      differentiationSignals:[],
      limitations:['Sample only']
    },
    dnaTags:[cluster],
    updatedAt:'2026-09-23T00:00:00Z'
  };
}

test('curve classification is determined only by independent creator count',()=>{
  assert.equal(universeCurveClassification(['a']),'hypothesis');
  assert.equal(universeCurveClassification(['a','b']),'emerging');
  assert.equal(universeCurveClassification(['a','b','c']),'structural');
  assert.equal(universeCurveClassification(['a','a','b']),'emerging');
});

test('gap demand cannot be observed without target evidence',()=>{
  assert.equal(universeGapDemandStatus('structural',[]),'hypothesis');
  assert.equal(universeGapDemandStatus('structural',['a']),'partial');
  assert.equal(universeGapDemandStatus('structural',['a','b']),'observed');
  assert.equal(universeGapDemandStatus('emerging',['a','b']),'partial');
});

test('curve evidence selection preserves multiple clusters instead of taking one dominant cluster only',()=>{
  const items=[
    ...Array.from({length:10},(_,i)=>competitor('history-'+i,'History',i<2?'breakout':'watch')),
    ...Array.from({length:4},(_,i)=>competitor('science-'+i,'Science')),
    ...Array.from({length:3},(_,i)=>competitor('animals-'+i,'Animals'))
  ];
  const selected=selectUniverseCurveEvidence(items,9,4);
  const clusters=new Set(selected.map(item=>item.cluster));
  assert.equal(selected.length,9);
  assert.equal(clusters.has('History'),true);
  assert.equal(clusters.has('Science'),true);
  assert.equal(clusters.has('Animals'),true);
});


function marketIntelligence():UniverseMarketIntelligence{
  return {
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T00:00:00Z',
    sourceCompetitorIds:['a','b','c','d'],
    dnaCount:4,
    curves:[
      {id:'curve:structural',key:'structural',name:'Structural Curve',thesis:'T',mechanismSteps:['A','B','C'],supportingChannelIds:['a','b','c'],independentCreators:3,classification:'structural',clusters:['History'],evidence:['E'],counterEvidence:[],recurringTitlePatterns:[],transferableVariables:['target'],limitations:['Sample']},
      {id:'curve:emerging',key:'emerging',name:'Emerging Curve',thesis:'T',mechanismSteps:['A','B','C'],supportingChannelIds:['a','b'],independentCreators:2,classification:'emerging',clusters:['Science'],evidence:['E'],counterEvidence:[],recurringTitlePatterns:[],transferableVariables:['target'],limitations:['Sample']}
    ],
    gaps:[
      {id:'gap:pilot',curveId:'curve:structural',title:'Observed low saturation',targetSpace:'Animals',preservedMechanism:'M',changedVariable:'Target',demandStatus:'observed',targetEvidenceChannelIds:['x','y'],demandEvidence:['D'],sampleSaturation:'low',rationale:'Observed demand with room in the sample.',risks:['Sample risk'],firstTests:['Pilot A','Pilot B','Pilot C']},
      {id:'gap:investigate',curveId:'curve:structural',title:'Partial demand',targetSpace:'Engineering',preservedMechanism:'M',changedVariable:'Target',demandStatus:'partial',targetEvidenceChannelIds:['z'],demandEvidence:['D'],sampleSaturation:'medium',rationale:'One target-space example only.',risks:[],firstTests:['Test A','Test B','Test C']},
      {id:'gap:crowded',curveId:'curve:structural',title:'Crowded',targetSpace:'Gaming',preservedMechanism:'M',changedVariable:'Target',demandStatus:'observed',targetEvidenceChannelIds:['g1','g2'],demandEvidence:['D'],sampleSaturation:'high',rationale:'Crowded sample.',risks:[],firstTests:['A','B','C']},
      {id:'gap:emerging',curveId:'curve:emerging',title:'Emerging source',targetSpace:'Health',preservedMechanism:'M',changedVariable:'Target',demandStatus:'partial',targetEvidenceChannelIds:['h1'],demandEvidence:['D'],sampleSaturation:'low',rationale:'Source curve is not structural.',risks:[],firstTests:['A','B','C']}
    ],
    limitations:['Sample only']
  };
}

test('Mission Control Universe opportunities require a structural curve and exclude high saturation',()=>{
  const selected=selectUniverseMissionOpportunities(marketIntelligence(),10);
  assert.deepEqual(selected.map(item=>item.gapId),['gap:pilot','gap:investigate']);
});

test('observed demand with non-high saturation is pilot-ready and ranks before investigation',()=>{
  const selected=selectUniverseMissionOpportunities(marketIntelligence(),10);
  assert.equal(selected[0].readiness,'pilot-ready');
  assert.equal(selected[0].targetEvidenceCount,2);
  assert.equal(selected[1].readiness,'investigate');
});

test('Universe opportunity selector respects the requested output cap',()=>{
  assert.equal(selectUniverseMissionOpportunities(marketIntelligence(),1).length,1);
});

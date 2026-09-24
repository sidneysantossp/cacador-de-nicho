import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMissionCandidates, hydrateMissionBriefUniverse, productionReadiness } from '../src/lib/mission';
import type { Channel, MissionBrief, OpportunityReport, UniverseCompetitor, UniverseMarketIntelligence } from '../src/lib/types';

function report(overrides:Partial<OpportunityReport>={}):OpportunityReport{
  return {
    kind:'opportunity-report',
    id:'opportunity-report:c1',
    channelStudyId:'channel-study:c1',
    sourceChannelId:'c1',
    title:'Validated Curve',
    thesis:'A repeatable curve.',
    curve:{
      thesis:'Known subject → uncommon angle → payoff',
      subject:'Subject',
      promise:'Promise',
      angle:'Angle',
      narrativeMechanism:'Mechanism',
      visualMechanism:'Visual',
      emotionalDriver:'Curiosity',
      repeatabilityEvidence:['Multiple hits'],
      failureConditions:[]
    },
    validation:{
      classification:'structural',
      independentCreators:3,
      supportingVideos:12,
      evidence:['Three creators'],
      counterEvidence:[],
      limitations:[]
    },
    saturation:{level:'medium',rationale:'Room remains.',saturatedPatterns:[],underusedAngles:[],whitespace:['Gap']},
    viralDNA:{
      demand:{level:'high',rationale:'Repeated reach.'},
      repeatability:{level:'high',rationale:'Multiple hits.'},
      breakout:{level:'high',rationale:'Small-channel breakouts.'},
      saturation:{level:'medium',rationale:'Not crowded.'},
      gap:{level:'high',rationale:'Clear whitespace.'}
    },
    evidence:{topVideos:[],similarChannels:[]},
    transfers:[],
    channelConcept:{
      nameDirections:['Concept'],
      positioning:'Positioning',
      audience:'Audience',
      promise:'Promise',
      format:'Long form',
      thumbnailSystem:'System',
      productionModel:'Model',
      firstEpisodes:['Episode 1','Episode 2','Episode 3','Episode 4','Episode 5','Episode 6','Episode 7','Episode 8','Episode 9','Episode 10'],
      testPlan:['Pilot']
    },
    nextMove:'Produce pilot.',
    limitations:[],
    createdAt:'2026-09-22T12:00:00Z',
    ...overrides
  };
}

function channel(id:string,views:number,subscribers:number|null,ageHours:number):Channel{
  const observed='2026-09-22T12:00:00Z';
  return {
    id,
    name:id,
    handle:'@'+id,
    niche:'Test',
    language:'en-US',
    country:'US',
    format:'Long form',
    description:'',
    lens:'',
    thumbnail:'',
    url:'https://youtube.com/channel/'+id,
    createdAt:'2026-08-01T12:00:00Z',
    firstSeenAt:observed,
    observedAt:observed,
    videoCount:8,
    subscribers,
    video:{
      id:'v-'+id,
      title:'Video',
      publishedAt:new Date(Date.parse(observed)-ageHours*3600000).toISOString(),
      views,
      duration:'PT8M',
      thumbnail:'',
      url:'https://youtube.com/watch?v=v-'+id
    },
    status:'new',
    evidence:[],
    discoverySource:'reference-adjacent'
  };
}

test('Mission Control only marks structurally validated opportunities as production ready',()=>{
  assert.equal(productionReadiness(report()).ready,true);
  assert.equal(productionReadiness(report({
    validation:{...report().validation,classification:'emerging',independentCreators:2}
  })).ready,false);
});

test('high saturation or low gap keeps an otherwise structural opportunity out of production',()=>{
  assert.equal(productionReadiness(report({
    viralDNA:{...report().viralDNA,saturation:{level:'high',rationale:'Crowded.'}}
  })).ready,false);
  assert.equal(productionReadiness(report({
    viralDNA:{...report().viralDNA,gap:{level:'low',rationale:'No whitespace.'}}
  })).ready,false);
});

test('mission candidate ordering prefers stronger breakout before raw views',()=>{
  const strongerBreakout=channel('breakout',600000,10000,30);
  const largerViews=channel('views',900000,100000,20);
  assert.equal([largerViews,strongerBreakout].sort(compareMissionCandidates)[0].id,'breakout');
});

test('when breakout is equal, mission ordering prefers more views',()=>{
  const smaller=channel('small',600000,10000,30);
  const larger=channel('large',900000,15000,30);
  assert.equal([smaller,larger].sort(compareMissionCandidates)[0].id,'large');
});


test('Mission Control hydrates Universe cards and counts from live market state',()=>{
  const brief:MissionBrief={
    kind:'mission-brief',
    id:'mission-brief:old',
    objective:'Test',
    status:'completed',
    startedAt:'2026-09-23T12:00:00Z',
    completedAt:'2026-09-23T12:05:00Z',
    health:{supabase:true,youtube:true,openai:true,blockers:[]},
    market:{qualifiedChannels:0,channelStudies:0,opportunityReports:0,productionReady:0,competitors:1,competitorSignals:0,competitorDna:0,universeCurves:1,universeGaps:1,universeActionableGaps:1,universeQueuePending:10,universeQueueCompleted:5},
    workCompleted:[],
    productionQueue:[],
    universeOpportunities:[{
      gapId:'old-gap',curveId:'old-curve',title:'Old',curveName:'Old',targetSpace:'Old',readiness:'pilot-ready',demandStatus:'observed',sampleSaturation:'low',independentCreators:3,targetEvidenceCount:2,firstTest:'Old test',reasons:[],risks:[]
    }],
    decisionsNeeded:[],
    blockers:[],
    notes:[]
  };
  const competitorA={kind:'competitor',id:'competitor:a',channelId:'a',name:'A',handle:'@a',url:'https://youtube.com/@a',avatar:'',language:'en',cluster:'History',subniche:'Sub',format:'Long form',description:'',subscribers:1000,videoCount:10,createdAt:'2026-01-01T00:00:00Z',importedAt:'2026-09-01T00:00:00Z',lastMonitoredAt:'2026-09-24T00:00:00Z',monitoringTier:'active',status:'breakout',recentAverageViews:100000,recentMedianViews:90000,recentVideoCount:5,uploadsLast30d:3,breakoutRatio:5,strongestRecentVideo:null,recentUploads:[],signals:['Breakout'],signalDetails:[],snapshots:[],dnaTags:[],updatedAt:'2026-09-24T00:00:00Z'} satisfies UniverseCompetitor;
  const competitorB={...competitorA,id:'competitor:b',channelId:'b',name:'B',handle:'@b',signals:[],dna:{generatedAt:'2026-09-24T00:00:00Z',summary:'S',primaryNiche:'History',subniche:'Sub',audienceIntent:'Learn',editorialPromise:'P',formatSignature:'Long',contentPillars:[],recurringEntities:[],titlePatterns:[],curiosityMechanisms:[],emotionalDrivers:[],differentiationSignals:[],limitations:[]}} satisfies UniverseCompetitor;
  const intelligence:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T14:00:00Z',
    sourceCompetitorIds:['a','b','c'],
    dnaCount:3,
    curves:[{id:'curve',key:'curve',name:'Curve',thesis:'T',mechanismSteps:['A'],supportingChannelIds:['a','b','c'],independentCreators:3,classification:'structural',clusters:['History'],evidence:['E'],counterEvidence:[],recurringTitlePatterns:[],transferableVariables:[],limitations:[]}],
    gaps:[
      {id:'gap:partial',curveId:'curve',title:'Current gap',targetSpace:'Target',preservedMechanism:'M',changedVariable:'V',demandStatus:'partial',targetEvidenceChannelIds:['a'],demandEvidence:['D'],sampleSaturation:'medium',rationale:'R',risks:[],firstTests:['Test']},
      {id:'gap:hypothesis',curveId:'curve',title:'Hypothesis',targetSpace:'Other',preservedMechanism:'M',changedVariable:'V',demandStatus:'hypothesis',targetEvidenceChannelIds:[],demandEvidence:[],sampleSaturation:'low',rationale:'R',risks:[],firstTests:['Other']}
    ],
    limitations:[]
  };
  const hydrated=hydrateMissionBriefUniverse(brief,[competitorA,competitorB],intelligence,{total:228,pending:0,processing:0,completed:223,failed:5,retryable:0,terminalFailed:5,resolved:228,progressPct:100});
  assert.ok(hydrated);
  assert.equal(hydrated.market.competitors,2);
  assert.equal(hydrated.market.competitorSignals,1);
  assert.equal(hydrated.market.competitorDna,1);
  assert.equal(hydrated.market.universeCurves,1);
  assert.equal(hydrated.market.universeGaps,2);
  assert.equal(hydrated.market.universeActionableGaps,1);
  assert.equal(hydrated.market.universeQueuePending,0);
  assert.equal(hydrated.market.universeQueueCompleted,223);
  assert.deepEqual(hydrated.universeOpportunities.map(item=>item.gapId),['gap:partial']);
});

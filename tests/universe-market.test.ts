import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUniverseCurveEvidence, selectUniverseDnaBootstrapBatch, selectUniverseGapValidationDnaBatch, selectUniverseMissionOpportunities, universeCurveClassification, universeGapDemandStatus } from '../src/lib/universe-market';
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


function missingDnaCompetitor(
  id:string,
  cluster:string,
  titles:string[],
  overrides:Partial<UniverseCompetitor>={}
){
  const item=competitor(id,cluster,'breakout');
  delete item.dna;
  item.recentUploads=titles.map((title,index)=>({
    id:`${id}-v${index}`,
    title,
    publishedAt:'2026-09-20T00:00:00Z',
    views:100000-index*1000,
    duration:'PT8M',
    thumbnail:'',
    url:`https://youtube.com/watch?v=${id}-v${index}`
  }));
  Object.assign(item,overrides);
  return item;
}

function gapDirectedMarket():UniverseMarketIntelligence{
  return {
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T00:00:00Z',
    sourceCompetitorIds:['source-a','source-b','source-c'],
    dnaCount:3,
    curves:[
      {id:'curve:animal',key:'animal',name:'Concrete Curiosity',thesis:'T',mechanismSteps:['A','B','C'],supportingChannelIds:['a','b','c'],independentCreators:3,classification:'structural',clusters:['Education'],evidence:['E'],counterEvidence:[],recurringTitlePatterns:[],transferableVariables:['target'],limitations:['Sample']},
      {id:'curve:jobs',key:'jobs',name:'Physical Stakes History',thesis:'T',mechanismSteps:['A','B','C'],supportingChannelIds:['a','b','c'],independentCreators:3,classification:'structural',clusters:['History'],evidence:['E'],counterEvidence:[],recurringTitlePatterns:[],transferableVariables:['target'],limitations:['Sample']}
    ],
    gaps:[
      {id:'gap:animal',curveId:'curve:animal',title:'Animal POV Survival',targetSpace:'Animal life from the perspective of being born as the animal',preservedMechanism:'M',changedVariable:'POV animal life',demandStatus:'partial',targetEvidenceChannelIds:['known-animal'],demandEvidence:['D'],sampleSaturation:'low',rationale:'Target still needs independent creators.',risks:[],firstTests:['Why Being Born a Sea Turtle Is a Survival Nightmare','What It Costs to Be Born a Cockroach','Why Being Born an Octopus Is So Brutal']},
      {id:'gap:jobs',curveId:'curve:jobs',title:'The Price of Ancient Jobs',targetSpace:'Historical professions explained through physical cost and survival',preservedMechanism:'M',changedVariable:'Ancient jobs and professions',demandStatus:'partial',targetEvidenceChannelIds:['known-job'],demandEvidence:['D'],sampleSaturation:'low',rationale:'Professions need more independent evidence.',risks:[],firstTests:['Why Being a Roman Miner Was Almost a Death Sentence','What It Cost to Be a Medieval Tanner','How Ancient Sailors Survived Months at Sea']}
    ],
    limitations:['Sample only']
  };
}

test('gap-directed DNA finds animal POV evidence across clusters from real title language',()=>{
  const wildlife=missingDnaCompetitor('wildlife','Animals',['POV: Your Life as Every Rank in a Wolf Pack']);
  const dinzo=missingDnaCompetitor('dinzo','Storytelling',['Why It Sucks to Be Born as a Giant Anaconda']);
  const selected=selectUniverseGapValidationDnaBatch([wildlife,dinzo],gapDirectedMarket(),5);
  assert.deepEqual(new Set(selected.map(item=>item.id)),new Set(['competitor:wildlife','competitor:dinzo']));
});

test('gap-directed DNA rejects noisy cluster matches without target semantics',()=>{
  const geo=missingDnaCompetitor('geo','Animals',['Chances of being born in Africa'],{description:'Daily maps, countries and statistics.'});
  const food=missingDnaCompetitor('food','Animals',['Which Country Food Would You Pick?'],{description:'Flags, food and landmarks.'});
  const roblox=missingDnaCompetitor('roblox','Animals',['POV: Intern vs Barney in Animal Hospital'],{description:'Roblox gameplay.'});
  assert.deepEqual(selectUniverseGapValidationDnaBatch([geo,food,roblox],gapDirectedMarket(),5),[]);
});

test('gap-directed DNA recognizes profession plus historical context',()=>{
  const miner=missingDnaCompetitor('miner','Explained',['I tried being a coal miner in Pennsylvania 1905 #history']);
  const gladiator=missingDnaCompetitor('gladiator','History',['What If You Were a Roman Gladiator?']);
  const ruins=missingDnaCompetitor('ruins','History',['10 Ancient Structures That Break Modern Engineering Physics']);
  const selected=selectUniverseGapValidationDnaBatch([miner,gladiator,ruins],gapDirectedMarket(),5);
  assert.equal(selected.some(item=>item.id==='competitor:miner'),true);
  assert.equal(selected.some(item=>item.id==='competitor:gladiator'),true);
  assert.equal(selected.some(item=>item.id==='competitor:ruins'),false);
});

test('DNA bootstrap reserves targeted slots without starving global priority',()=>{
  const targetedA=missingDnaCompetitor('target-a','Storytelling',['Why It Sucks to Be Born as a Lion'],{breakoutRatio:2});
  const targetedB=missingDnaCompetitor('target-b','Animals',['POV: Your Life as Every Rank in a BEE Colony'],{breakoutRatio:3});
  const normal=Array.from({length:5},(_,index)=>missingDnaCompetitor(
    `normal-${index}`,
    'Engineering',
    [`Massive machine explained ${index}`],
    {breakoutRatio:100-index}
  ));
  const selected=selectUniverseDnaBootstrapBatch([...normal,targetedA,targetedB],gapDirectedMarket(),5,2);
  assert.equal(selected.length,5);
  assert.equal(selected.slice(0,2).every(item=>item.id==='competitor:target-a'||item.id==='competitor:target-b'),true);
  assert.equal(selected.slice(2).every(item=>item.id.startsWith('competitor:normal-')),true);
});

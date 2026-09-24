import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUniverseGapEvidence, selectUniverseCoverageDnaBatch, selectUniverseCurveEvidence, selectUniverseDnaBootstrapBatch, selectUniverseGapValidationDnaBatch, selectUniverseMissionOpportunities, universeCoverageCluster, universeCurveClassification, universeGapDemandStatus, universeGapDnaCandidateMatch } from '../src/lib/universe-market';
import { preserveUniverseMarketContinuity } from '../src/lib/universe-market-continuity';
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


test('backend gap resolver adds corroborated independent target evidence and ignores semantic noise',()=>{
  const gap=gapDirectedMarket().gaps.find(item=>item.id==='gap:animal')!;
  const known=competitor('known-animal','Animal Science');
  known.recentUploads=[{id:'known-v',title:'POV: Born as a Wolf — Animal Survival Explained',publishedAt:'2026-09-20T00:00:00Z',views:100000,duration:'PT8M',thumbnail:'',url:''}];

  const wildlife=competitor('wildlife-evidence','Animals');
  wildlife.recentUploads=[{id:'wild-v',title:'POV: Your Life as Every Rank in a Wolf Pack',publishedAt:'2026-09-20T00:00:00Z',views:159226,duration:'PT8M',thumbnail:'',url:''}];

  const geo=competitor('geo-noise','Animals');
  geo.description='Daily maps, countries and statistics.';
  geo.recentUploads=[{id:'geo-v',title:'Chances of being born in Africa',publishedAt:'2026-09-20T00:00:00Z',views:89696,duration:'PT8M',thumbnail:'',url:''}];

  const resolved=resolveUniverseGapEvidence([known,wildlife,geo],gap,['known-animal','missing-id']);
  assert.deepEqual(new Set(resolved.channelIds),new Set(['known-animal','wildlife-evidence']));
  assert.equal(resolved.evidence.some(item=>item.includes('wildlife-evidence')),true);
  assert.equal(resolved.evidence.some(item=>item.includes('geo-noise')),false);
  assert.equal(universeGapDemandStatus('structural',resolved.channelIds),'observed');
});

test('backend gap resolver can corroborate historical professions beyond AI-suggested IDs',()=>{
  const gap=gapDirectedMarket().gaps.find(item=>item.id==='gap:jobs')!;
  const suggested=competitor('known-job','History');
  suggested.recentUploads=[{id:'known-job-v',title:'Roman Miner: The Ancient Job That Could Kill You',publishedAt:'2026-09-20T00:00:00Z',views:210000,duration:'PT8M',thumbnail:'',url:''}];
  const historic=competitor('historic-dave','Everyday History');
  historic.recentUploads=[{id:'job-v',title:'Medieval Jobs That Were Actually Secret Death Sentence',publishedAt:'2026-09-20T00:00:00Z',views:342400,duration:'PT8M',thumbnail:'',url:''}];

  const resolved=resolveUniverseGapEvidence([suggested,historic],gap,['known-job']);
  assert.deepEqual(new Set(resolved.channelIds),new Set(['known-job','historic-dave']));
  assert.equal(universeGapDemandStatus('structural',resolved.channelIds),'observed');
});


test('backend gap resolver ignores generic packaging words and first-test leakage',()=>{
  const gap={
    title:'Why Your Hallway Is Shaped by a Medieval Fire Problem',
    targetSpace:'Domestic architecture, medieval hallways and historical fire-design constraints',
    targetKeywords:['domestic architecture','medieval hallway','fire design'],
    changedVariable:'Home layouts',
    firstTests:[
      'Why Old Houses Had Windows in the Strangest Places',
      'The Bathroom Feature That Started as a Disease Solution'
    ]
  };
  const noisy=competitor('generic-language','Explained');
  noisy.recentUploads=[
    {id:'n1',title:'Your Life Started in the Strangest Place',publishedAt:'2026-09-20T00:00:00Z',views:100000,duration:'PT8M',thumbnail:'',url:''},
    {id:'n2',title:'Why You Had This Problem',publishedAt:'2026-09-20T00:00:00Z',views:90000,duration:'PT8M',thumbnail:'',url:''},
    {id:'n3',title:'Bathroom Disease Solution Explained',publishedAt:'2026-09-20T00:00:00Z',views:80000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const relevant=competitor('medieval-fire','History');
  relevant.recentUploads=[
    {id:'r1',title:'Medieval Hallway Fire Design Explained',publishedAt:'2026-09-20T00:00:00Z',views:120000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([noisy,relevant],gap,[]);
  assert.deepEqual(resolved.channelIds,['medieval-fire']);
  assert.equal(resolved.evidence.some(item=>item.includes('generic-language')),false);
});


test('AI-suggested target ids are rejected unless backend evidence matches the target',()=>{
  const gap={
    title:'Why Old Cities Hid Water in Plain Sight',
    targetSpace:'Urban water infrastructure, cisterns and historic city utilities',
    targetKeywords:['city water','urban infrastructure','cisterns'],
    changedVariable:'Civil water systems and city design',
    firstTests:['Why Old Cities Hid Water in Plain Sight']
  };
  const curveOnly=competitor('curve-only','Military History');
  curveOnly.recentUploads=[{id:'c1',title:'Why WW2 Tanks Had Strange Armor',publishedAt:'2026-09-20T00:00:00Z',views:500000,duration:'PT8M',thumbnail:'',url:''}];
  const target=competitor('target-city','Everyday History');
  target.recentUploads=[{id:'t1',title:'Old Cities Hid Water in Underground Cisterns',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}];

  const resolved=resolveUniverseGapEvidence([curveOnly,target],gap,['curve-only','target-city']);
  assert.deepEqual(resolved.channelIds,['target-city']);
  assert.equal(resolved.evidence.some(item=>item.includes('curve-only')),false);
  assert.equal(resolved.evidence.some(item=>item.includes('Sugestão da IA validada em target-city')),true);
});


test('source-domain words in changedVariable cannot validate the target space',()=>{
  const gap={
    title:'Human survival in impossible ecosystems',
    targetSpace:'Historical human adaptation to extreme environments',
    changedVariable:'Replace animals with humans while preserving the hostile-world mechanism',
    firstTests:['How Humans Survived the Harshest Desert']
  };
  const animal=competitor('animal-source','Animal Science');
  animal.recentUploads=[{id:'a1',title:'POV: Born as a Wolf — Animal Survival in a Hostile World',publishedAt:'2026-09-20T00:00:00Z',views:500000,duration:'PT8M',thumbnail:'',url:''}];
  const human=competitor('human-target','History');
  human.recentUploads=[{id:'h1',title:'Human Survival and Adaptation in Extreme Desert Environments',publishedAt:'2026-09-20T00:00:00Z',views:320000,duration:'PT8M',thumbnail:'',url:''}];

  const resolved=resolveUniverseGapEvidence([animal,human],gap,['animal-source','human-target']);
  assert.deepEqual(resolved.channelIds,['human-target']);
});


test('target evidence requires meaningful terms to co-occur in the same upload title',()=>{
  const gap={
    title:'Why Old Houses Had Rooms for Problems We Forgot',
    targetSpace:'Material history of the house, hygiene and domestic solutions before modern infrastructure',
    changedVariable:'Domestic architecture',
    firstTests:['Why Old Houses Had Rooms for Problems We Forgot']
  };

  const historic=competitor('historic-dave-house','Everyday History');
  historic.recentUploads=[
    {id:'h1',title:'Rooms in Your House That Only Exist Because of an Old Problem',publishedAt:'2026-09-08T00:00:00Z',views:20703,duration:'PT8M',thumbnail:'',url:''}
  ];

  const silas=competitor('silas-noise','Off-Grid Living');
  silas.description='Forgotten frontier skills for old houses and cabins.';
  silas.recentUploads=[
    {id:'s1',title:'11 Old Frontier Men Organization Rules Americans Break — That Make Your House Messy',publishedAt:'2026-09-19T00:00:00Z',views:5421,duration:'PT8M',thumbnail:'',url:''},
    {id:'s2',title:'5 Hidden Rooms Frontier Families Built Into Their Cabins',publishedAt:'2026-09-20T00:00:00Z',views:4683,duration:'PT8M',thumbnail:'',url:''}
  ];

  const stukalin=competitor('stukalin-noise','Home Transformation');
  stukalin.description='We transform old worn-out houses, rooms and buildings into new homes.';
  stukalin.recentUploads=[
    {id:'st1',title:'We Restored an Abandoned Mountain House for an Elderly Couple',publishedAt:'2026-07-02T00:00:00Z',views:106228,duration:'PT8M',thumbnail:'',url:''},
    {id:'st2',title:'Helping Dad Save an Old Windmill',publishedAt:'2026-08-25T00:00:00Z',views:307155,duration:'PT8M',thumbnail:'',url:''}
  ];

  const yakutia=competitor('yakutia-noise','Survival Stories');
  yakutia.description='History drifts into quiet rooms from the 1500s.';
  yakutia.recentUploads=[
    {id:'y1',title:'An Old Woman in -71°C Yakutia Saved a Freezing Wolf',publishedAt:'2026-03-06T00:00:00Z',views:1654,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([historic,silas,stukalin,yakutia],gap,[]);
  assert.deepEqual(resolved.channelIds,['historic-dave-house']);
  assert.equal(resolved.evidence.some(item=>item.includes('historic-dave-house')),true);
  assert.equal(resolved.evidence.some(item=>item.includes('silas-noise')),false);
  assert.equal(resolved.evidence.some(item=>item.includes('stukalin-noise')),false);
  assert.equal(resolved.evidence.some(item=>item.includes('yakutia-noise')),false);
});

test('plural target words still match singular upload wording inside one title',()=>{
  const gap={
    title:'Houses with rooms built for forgotten problems',
    targetSpace:'Domestic house rooms and practical problems',
    changedVariable:'Domestic architecture',
    firstTests:[]
  };
  const relevant=competitor('plural-normalization','Everyday History');
  relevant.recentUploads=[
    {id:'p1',title:'A Room in Your House Built for a Forgotten Problem',publishedAt:'2026-09-20T00:00:00Z',views:50000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([relevant],gap,[]);
  assert.deepEqual(resolved.channelIds,['plural-normalization']);
});


test('then-and-now packaging alone cannot validate an everyday-technology target',()=>{
  const gap={
    title:'Then and Now: Everyday Technology',
    targetSpace:'Visual nostalgia around household technology, workplace objects and recent-decade habits',
    changedVariable:'Technology instead of celebrities',
    firstTests:[]
  };

  const celebrity=competitor('celebrity-then-now','Celebrity Nostalgia');
  celebrity.recentUploads=[
    {id:'c1',title:'100+ Iconic Hollywood Actors: Then and Now',publishedAt:'2026-09-20T00:00:00Z',views:900000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const technology=competitor('technology-then-now','Technology History');
  technology.recentUploads=[
    {id:'t1',title:'Household Technology: Phones and Office Computers Then and Now',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([celebrity,technology],gap,[]);
  assert.deepEqual(resolved.channelIds,['technology-then-now']);
  assert.equal(resolved.evidence.some(item=>item.includes('celebrity-then-now')),false);
});


test('coverage DNA selector spreads a batch across the largest pending clusters',()=>{
  const items=[
    ...Array.from({length:8},(_,index)=>missingDnaCompetitor(`history-${index}`,'History',[`History title ${index}`],{breakoutRatio:100-index})),
    ...Array.from({length:5},(_,index)=>missingDnaCompetitor(`education-${index}`,'Education',[`Education title ${index}`],{breakoutRatio:50-index})),
    ...Array.from({length:4},(_,index)=>missingDnaCompetitor(`explained-${index}`,'Explained',[`Explained title ${index}`],{breakoutRatio:40-index})),
    ...Array.from({length:2},(_,index)=>missingDnaCompetitor(`story-${index}`,'Storytelling',[`Story title ${index}`],{breakoutRatio:30-index}))
  ];
  const selected=selectUniverseCoverageDnaBatch(items,3);
  assert.deepEqual(selected.map(item=>item.cluster),['History','Education','Explained']);
});

test('mixed DNA bootstrap keeps gap-directed, cluster-coverage and global-priority paths',()=>{
  const targetedA=missingDnaCompetitor('target-animal','Animals',['POV: Your Life as Every Rank in a Wolf Pack'],{breakoutRatio:2});
  const targetedB=missingDnaCompetitor('target-job','History',['Roman Miner: The Ancient Job That Could Kill You'],{breakoutRatio:3});
  const history=Array.from({length:8},(_,index)=>missingDnaCompetitor(
    `history-normal-${index}`,
    'History',
    [`History documentary ${index}`],
    {breakoutRatio:20-index}
  ));
  const education=Array.from({length:6},(_,index)=>missingDnaCompetitor(
    `education-normal-${index}`,
    'Education',
    [`Education explainer ${index}`],
    {breakoutRatio:10-index}
  ));
  const breakout=missingDnaCompetitor('global-breakout','Tiny Cluster',['Unrelated huge breakout'],{breakoutRatio:999});

  const selected=selectUniverseDnaBootstrapBatch(
    [...history,...education,breakout,targetedA,targetedB],
    gapDirectedMarket(),
    5,
    2
  );

  assert.equal(selected.slice(0,2).some(item=>item.id==='competitor:target-animal'),true);
  assert.equal(selected.slice(0,2).some(item=>item.id==='competitor:target-job'),true);
  const normal=selected.slice(2);
  assert.equal(normal.some(item=>item.cluster==='History'),true);
  assert.equal(normal.some(item=>item.cluster==='Education'),true);
  assert.equal(normal.some(item=>item.id==='competitor:global-breakout'),true);
});


test('coverage cluster remains the immutable source cluster after DNA refinement',()=>{
  const item=missingDnaCompetitor('refined','Technology',['How Computers Work']);
  item.sourceCluster='Education';
  item.cluster='Technology';
  assert.equal(universeCoverageCluster(item),'Education');
});

test('coverage selector groups pending channels by source cluster instead of refined display cluster',()=>{
  const history=missingDnaCompetitor('history-source','Technology',['History of Computing'],{sourceCluster:'History',breakoutRatio:20});
  const education=missingDnaCompetitor('education-source','Technology',['Physics of Computers'],{sourceCluster:'Education',breakoutRatio:10});
  const explained=missingDnaCompetitor('explained-source','Technology',['Computers Explained'],{sourceCluster:'Explained',breakoutRatio:5});
  const selected=selectUniverseCoverageDnaBatch([history,education,explained],3);
  assert.deepEqual(new Set(selected.map(item=>item.sourceCluster)),new Set(['History','Education','Explained']));
});


test('generic day-earth overlap cannot validate an extreme-cave survival target',()=>{
  const gap={
    title:'A Day Surviving the Deepest Cave on Earth',
    targetSpace:'Extreme-environment survival documentary and cave exploration',
    changedVariable:'Cave survival',
    firstTests:[]
  };
  const prehistoric=competitor('wild-horizons-noise','Prehistoric Earth');
  prehistoric.recentUploads=[
    {id:'w1',title:"The Day The Sea Died — Earth's Forgotten Mass Extinction",publishedAt:'2026-09-20T00:00:00Z',views:90000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const cave=competitor('cave-survival','Exploration');
  cave.recentUploads=[
    {id:'c1',title:'Surviving the Deepest Cave: 48 Hours Underground',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([prehistoric,cave],gap,[]);
  assert.deepEqual(resolved.channelIds,['cave-survival']);
});

test('used-ancient overlap cannot validate a dentist-tool target',()=>{
  const gap={
    title:'Every Strange Tool Used by Ancient Dentists Explained',
    targetSpace:'Historical dentistry, health tools and pre-modern medical solutions',
    changedVariable:'Dental tools',
    firstTests:[]
  };
  const weapons=competitor('ancient-weapons-noise','History');
  weapons.recentUploads=[
    {id:'w1',title:'Every Weapon Ancient Humans Used to Hunt Giants Explained',publishedAt:'2026-09-20T00:00:00Z',views:187739,duration:'PT8M',thumbnail:'',url:''}
  ];
  const dentistry=competitor('dentistry-target','Medical History');
  dentistry.recentUploads=[
    {id:'d1',title:'Medieval Dentist Tools That Made Tooth Extraction Terrifying',publishedAt:'2026-09-20T00:00:00Z',views:120000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([weapons,dentistry],gap,[]);
  assert.deepEqual(resolved.channelIds,['dentistry-target']);
});


test('title packaging cannot validate an unrelated target domain',()=>{
  const gap={
    title:'The Weird Side of Everyday Institutions',
    targetSpace:'Everyday public institutions, municipal services, civic signs and public-service objects',
    targetKeywords:['public institutions','municipal services','civic signs','public services'],
    changedVariable:'Institutions instead of celebrities',
    firstTests:[]
  };

  const brainCurious=competitor('braincurious-noise','Weird Facts');
  brainCurious.recentUploads=[
    {id:'b1',title:'The Weird Side of Vladimir Putin!',publishedAt:'2026-09-20T00:00:00Z',views:250000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const civic=competitor('civic-target','Everyday Systems');
  civic.recentUploads=[
    {id:'c1',title:'Weird Rules Hidden Inside Everyday Public Services',publishedAt:'2026-09-20T00:00:00Z',views:150000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([brainCurious,civic],gap,['braincurious-noise','civic-target']);
  assert.deepEqual(resolved.channelIds,['civic-target']);
  assert.equal(resolved.evidence.some(item=>item.includes('braincurious-noise')),false);
  assert.equal(resolved.evidence.some(item=>item.includes('domínio target: public services')),true);
});

test('target keywords override title packaging when validating direct evidence',()=>{
  const gap={
    title:'Every Weird Thing About a Famous City',
    targetSpace:'Urban water infrastructure, cisterns and municipal water systems',
    targetKeywords:['water infrastructure','cisterns','municipal water'],
    changedVariable:'Water systems',
    firstTests:[]
  };
  const packaging=competitor('famous-city-noise','Celebrity Cities');
  packaging.recentUploads=[
    {id:'p1',title:'Every Weird Thing About a Famous City',publishedAt:'2026-09-20T00:00:00Z',views:900000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const water=competitor('water-target','Urban History');
  water.recentUploads=[
    {id:'w1',title:'How Cisterns Kept a City Water System Alive',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([packaging,water],gap,[]);
  assert.deepEqual(resolved.channelIds,['water-target']);
});


test('multiword target keywords cannot be satisfied by unrelated isolated words',()=>{
  const gap={
    title:'Could a Modern Fire Crew Save a Medieval City From a Major Fire?',
    targetSpace:'urban fire response',
    targetKeywords:['firefighters','fire engines','water pumps','city fires','firebreaks','medieval towns'],
    changedVariable:'Modern fire response in a historical city',
    firstTests:[]
  };

  const warZone=competitor('war-zone-engine-pump','Military History');
  warZone.recentUploads=[
    {id:'w1',title:'How WW1 Pilots Started an Engine Without a Fuel Pump',publishedAt:'2026-09-20T00:00:00Z',views:250000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const fireHistory=competitor('fire-history-target','Urban History');
  fireHistory.recentUploads=[
    {id:'f1',title:'How Medieval Towns Used Firebreaks to Stop City Fires',publishedAt:'2026-09-20T00:00:00Z',views:140000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([warZone,fireHistory],gap,['war-zone-engine-pump']);
  assert.deepEqual(resolved.channelIds,['fire-history-target']);
  assert.equal(resolved.evidence.some(item=>item.includes('war-zone-engine-pump')),false);
});

test('multiword bridge keyword validates a real bridge-domain title',()=>{
  const gap={
    title:"How History's Greatest Bridge Builders Died",
    targetSpace:'historical bridge engineering',
    targetKeywords:['bridge builders','suspension bridges','stone bridges','civil engineers','bridge construction'],
    changedVariable:'Bridge engineering',
    firstTests:[]
  };
  const whirl=competitor('whirl-bridge','History');
  whirl.recentUploads=[
    {id:'b1',title:'How You Invented The Suspension Bridge (Accidentally)',publishedAt:'2026-09-20T00:00:00Z',views:120000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([whirl],gap,['whirl-bridge']);
  assert.deepEqual(resolved.channelIds,['whirl-bridge']);
  assert.equal(resolved.evidence.some(item=>item.includes('suspension bridges')),true);
});


test('Market continuity carries a prior actionable bridge gap only after current revalidation',()=>{
  const supportA=competitor('support-a','Explained');
  const supportB=competitor('support-b','Animals');
  const supportC=competitor('support-c','History');
  const whirl=competitor('whirl-bridge','History');
  whirl.recentUploads=[
    {id:'w1',title:'How You Invented The Suspension Bridge (Accidentally)',publishedAt:'2026-09-20T00:00:00Z',views:120000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const nknows=competitor('nknows-bridge','Engineering');
  nknows.recentUploads=[
    {id:'n1',title:'How Did the Ancient Romans Build Bridge Piers Underwater?',publishedAt:'2026-09-20T00:00:00Z',views:2482,duration:'PT8M',thumbnail:'',url:''}
  ];

  const previous:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:previous-test',
    generatedAt:'2026-09-24T16:03:04Z',
    sourceCompetitorIds:['support-a','support-b','support-c','whirl-bridge'],
    dnaCount:4,
    curves:[{
      id:'universe-curve:completion-map',
      key:'completion-map',
      name:'Completion Maps for Complex Domains',
      thesis:'Organize complex domains into a complete map.',
      mechanismSteps:['Choose a domain','Define a taxonomy','Signal coverage'],
      supportingChannelIds:['support-a','support-b','support-c'],
      independentCreators:3,
      classification:'structural',
      clusters:['Explained','Animals','History'],
      evidence:['Repeated taxonomy packaging'],
      counterEvidence:[],
      recurringTitlePatterns:['Every [category] Explained'],
      transferableVariables:['Domain'],
      limitations:['Metadata only']
    }],
    gaps:[{
      id:'universe-gap:completion-map:bridge-engineering',
      curveId:'universe-curve:completion-map',
      title:'Every Type of Bridge Failure Explained',
      targetSpace:'bridge engineering',
      targetKeywords:['bridge failures','suspension bridges','bridge piers'],
      preservedMechanism:'Complete taxonomy',
      changedVariable:'Civil engineering',
      demandStatus:'partial',
      targetEvidenceChannelIds:['whirl-bridge'],
      demandEvidence:['WhirlTales has a suspension bridge title.'],
      sampleSaturation:'low',
      rationale:'Test bridge engineering as a taxonomy.',
      risks:['Technical accuracy'],
      firstTests:['Every Type of Bridge Failure Explained']
    }],
    limitations:[]
  };

  const current:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T16:09:01Z',
    sourceCompetitorIds:[],
    dnaCount:5,
    curves:[],
    gaps:[],
    limitations:[]
  };

  const merged=preserveUniverseMarketContinuity(
    current,
    [previous],
    [supportA,supportB,supportC,whirl,nknows]
  );

  assert.equal(merged.gaps.length,1);
  assert.equal(merged.gaps[0].demandStatus,'observed');
  assert.deepEqual(new Set(merged.gaps[0].targetEvidenceChannelIds),new Set(['whirl-bridge','nknows-bridge']));
  assert.equal(selectUniverseMissionOpportunities(merged,5)[0]?.readiness,'pilot-ready');
});

test('Market continuity drops a prior actionable gap when current target evidence disappears',()=>{
  const supportA=competitor('drop-support-a','Explained');
  const supportB=competitor('drop-support-b','Animals');
  const supportC=competitor('drop-support-c','History');

  const previous:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:previous-drop',
    generatedAt:'2026-09-24T15:00:00Z',
    sourceCompetitorIds:['drop-support-a','drop-support-b','drop-support-c'],
    dnaCount:3,
    curves:[{
      id:'universe-curve:drop',
      key:'drop',
      name:'Prior structural curve',
      thesis:'Prior curve',
      mechanismSteps:['A','B','C'],
      supportingChannelIds:['drop-support-a','drop-support-b','drop-support-c'],
      independentCreators:3,
      classification:'structural',
      clusters:['Explained','Animals','History'],
      evidence:['Prior evidence'],
      counterEvidence:[],
      recurringTitlePatterns:['Pattern'],
      transferableVariables:['Domain'],
      limitations:['Metadata only']
    }],
    gaps:[{
      id:'universe-gap:drop:obsolete-target',
      curveId:'universe-curve:drop',
      title:'Every Obsolete Target Explained',
      targetSpace:'obsolete target domain',
      targetKeywords:['obsolete systems','obsolete tools'],
      preservedMechanism:'Taxonomy',
      changedVariable:'Obsolete domain',
      demandStatus:'partial',
      targetEvidenceChannelIds:['missing-channel'],
      demandEvidence:['Old evidence'],
      sampleSaturation:'low',
      rationale:'Old rationale',
      risks:[],
      firstTests:['Every Obsolete Target Explained']
    }],
    limitations:[]
  };

  const current:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T16:00:00Z',
    sourceCompetitorIds:[],
    dnaCount:3,
    curves:[],
    gaps:[],
    limitations:[]
  };

  const merged=preserveUniverseMarketContinuity(current,[previous],[supportA,supportB,supportC]);
  assert.equal(merged.gaps.length,0);
  assert.equal(merged.curves.length,1);
});


test('explicit target keywords require target-domain anchors and reject semantic-family leakage',()=>{
  const gap={
    title:'Why Your Family Name Still Carries a Medieval Job',
    targetSpace:'occupational surnames',
    targetKeywords:['occupational surnames','medieval trades','family names','guild occupations','name origins'],
    changedVariable:'Surname origins',
    firstTests:[]
  };

  const historicDave=competitor('historic-dave-surnames','Everyday History');
  historicDave.recentUploads=[
    {id:'h1',title:'Surnames That Prove Your Ancestor Had a Job Nobody Wanted',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const genericJob=competitor('generic-historical-job','History');
  genericJob.recentUploads=[
    {id:'i1',title:'Roman Miner: An Ancient Job Under Extreme Conditions',publishedAt:'2026-09-20T00:00:00Z',views:150000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([historicDave,genericJob],gap,['historic-dave-surnames','generic-historical-job']);
  assert.deepEqual(resolved.channelIds,['historic-dave-surnames']);
  assert.equal(resolved.evidence.some(item=>item.includes('âncora do target: surname')),true);
  assert.equal(resolved.evidence.some(item=>item.includes('generic-historical-job')),false);
});

test('legacy gaps without explicit target keywords may still use semantic-family matching',()=>{
  const gap={
    title:'Roman Miner: An Ancient Job Under Extreme Conditions',
    targetSpace:'Historical professions and dangerous work',
    changedVariable:'Historical jobs',
    firstTests:[]
  };
  const miner=competitor('legacy-miner','History');
  miner.recentUploads=[
    {id:'m1',title:'Ancient Roman Miner Jobs and Working Conditions',publishedAt:'2026-09-20T00:00:00Z',views:150000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const resolved=resolveUniverseGapEvidence([miner],gap,[]);
  assert.deepEqual(resolved.channelIds,['legacy-miner']);
});


test('Mission Control consolidates overlapping pilot-ready gaps into one opportunity family',()=>{
  const intelligence:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T16:26:49Z',
    sourceCompetitorIds:['s1','s2','s3','sab','nknows','whirl'],
    dnaCount:6,
    curves:[
      {
        id:'curve:completion',
        key:'completion',
        name:'Completion Maps',
        thesis:'Taxonomy',
        mechanismSteps:['A','B','C'],
        supportingChannelIds:['s1','s2','s3','s4','s5'],
        independentCreators:5,
        classification:'structural',
        clusters:['Explained'],
        evidence:['E'],
        counterEvidence:[],
        recurringTitlePatterns:['Every X'],
        transferableVariables:['Domain'],
        limitations:[]
      },
      {
        id:'curve:consequence',
        key:'consequence',
        name:'Failure Consequences',
        thesis:'Failure catalog',
        mechanismSteps:['A','B','C'],
        supportingChannelIds:['s1','s2','s3'],
        independentCreators:3,
        classification:'structural',
        clusters:['History'],
        evidence:['E'],
        counterEvidence:[],
        recurringTitlePatterns:['How X failed'],
        transferableVariables:['Domain'],
        limitations:[]
      }
    ],
    gaps:[
      {
        id:'gap:bridge-taxonomy',
        curveId:'curve:completion',
        title:'Every Type of Bridge Failure Explained',
        targetSpace:'bridge engineering',
        targetKeywords:['bridge failures','suspension bridges','bridge piers'],
        preservedMechanism:'Taxonomy',
        changedVariable:'Bridge engineering',
        demandStatus:'observed',
        targetEvidenceChannelIds:['sab','nknows','whirl'],
        demandEvidence:['D'],
        sampleSaturation:'low',
        rationale:'Three independent target creators.',
        risks:['Accuracy'],
        firstTests:['Every Type of Bridge Failure Explained']
      },
      {
        id:'gap:bridge-history',
        curveId:'curve:consequence',
        title:"How History's Most Dangerous Bridges Failed",
        targetSpace:'historic bridge failures',
        targetKeywords:['bridges','bridge collapses','civil engineering'],
        preservedMechanism:'Failure catalog',
        changedVariable:'Historic bridges',
        demandStatus:'observed',
        targetEvidenceChannelIds:['sab','nknows'],
        demandEvidence:['D'],
        sampleSaturation:'low',
        rationale:'Two independent target creators.',
        risks:['Accuracy'],
        firstTests:['How Three Famous Bridges Collapsed']
      }
    ],
    limitations:[]
  };

  const selected=selectUniverseMissionOpportunities(intelligence,5);
  assert.equal(selected.length,1);
  assert.equal(selected[0].gapId,'gap:bridge-taxonomy');
  assert.equal(selected[0].readiness,'pilot-ready');
  assert.equal(selected[0].alternateAngles?.length,1);
  assert.equal(selected[0].alternateAngles?.[0].title,"How History's Most Dangerous Bridges Failed");
});

test('Mission Control keeps unrelated targets in separate opportunity families',()=>{
  const intelligence=marketIntelligence();
  intelligence.gaps=[
    {
      id:'gap:bridges',
      curveId:'curve:structural',
      title:'Bridge failures',
      targetSpace:'bridge engineering',
      targetKeywords:['bridges','bridge failures'],
      preservedMechanism:'M',
      changedVariable:'Bridges',
      demandStatus:'observed',
      targetEvidenceChannelIds:['same','bridge-only'],
      demandEvidence:['D'],
      sampleSaturation:'low',
      rationale:'Bridge target.',
      risks:[],
      firstTests:['Bridge pilot']
    },
    {
      id:'gap:hospitals',
      curveId:'curve:structural',
      title:'Hospital systems',
      targetSpace:'hospital infrastructure',
      targetKeywords:['hospital elevators','operating rooms'],
      preservedMechanism:'M',
      changedVariable:'Hospitals',
      demandStatus:'observed',
      targetEvidenceChannelIds:['same','hospital-only'],
      demandEvidence:['D'],
      sampleSaturation:'low',
      rationale:'Hospital target.',
      risks:[],
      firstTests:['Hospital pilot']
    }
  ];
  const selected=selectUniverseMissionOpportunities(intelligence,5);
  assert.equal(selected.length,2);
  assert.equal(selected.every(item=>(item.alternateAngles?.length??0)===0),true);
});


test('DNA candidate retrieval can be broader than deterministic target evidence',()=>{
  const gap={
    title:"How History's Great Ocean Liners Met Their End",
    targetSpace:'historic ocean liners',
    targetKeywords:['ocean liners','passenger ships','shipwrecks','maritime disasters','salvage operations','Atlantic crossings'],
    changedVariable:'Historic ocean liners',
    firstTests:[]
  };
  const insight=missingDnaCompetitor(
    'insight-fusion-shipwreck',
    'History',
    ["How Sweden's Greatest Warship Sank in Minutes #history #sweden #shipwreck"],
    {breakoutRatio:2}
  );

  const candidate=universeGapDnaCandidateMatch(insight,gap);
  assert.equal(candidate.matched,true);
  assert.equal(candidate.strictEvidence,false);
  assert.equal(candidate.targetMatchedTerms.includes('shipwrecks'),true);

  const resolved=resolveUniverseGapEvidence([insight],gap,[]);
  assert.deepEqual(resolved.channelIds,[]);
});

test('gap-directed DNA selector may investigate a weak target signal without promoting demand',()=>{
  const candidate=missingDnaCompetitor(
    'shipwreck-candidate',
    'History',
    ['The Warship That Became a Shipwreck'],
    {breakoutRatio:8}
  );
  const unrelated=missingDnaCompetitor(
    'huge-unrelated-breakout',
    'Entertainment',
    ['The Biggest Celebrity Transformation Ever'],
    {breakoutRatio:999}
  );

  const intelligence:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:'2026-09-24T17:00:00Z',
    sourceCompetitorIds:['a','b','c','existing-ocean'],
    dnaCount:4,
    curves:[{
      id:'curve:ocean',
      key:'ocean',
      name:'Terminal Consequences',
      thesis:'T',
      mechanismSteps:['A','B','C'],
      supportingChannelIds:['a','b','c'],
      independentCreators:3,
      classification:'structural',
      clusters:['History'],
      evidence:['E'],
      counterEvidence:[],
      recurringTitlePatterns:['How X ended'],
      transferableVariables:['Domain'],
      limitations:[]
    }],
    gaps:[{
      id:'gap:ocean',
      curveId:'curve:ocean',
      title:"How History's Great Ocean Liners Met Their End",
      targetSpace:'historic ocean liners',
      targetKeywords:['ocean liners','passenger ships','shipwrecks','maritime disasters','salvage operations','Atlantic crossings'],
      preservedMechanism:'Terminal consequences',
      changedVariable:'Ocean liners',
      demandStatus:'partial',
      targetEvidenceChannelIds:['existing-ocean'],
      demandEvidence:['One confirmed target channel.'],
      sampleSaturation:'low',
      rationale:'Needs another independent target creator.',
      risks:[],
      firstTests:['How History\'s Great Ocean Liners Met Their End']
    }],
    limitations:[]
  };

  const selected=selectUniverseGapValidationDnaBatch([unrelated,candidate],intelligence,2);
  assert.deepEqual(selected.map(item=>item.id),['competitor:shipwreck-candidate']);

  const evidence=resolveUniverseGapEvidence([candidate],intelligence.gaps[0],[]);
  assert.equal(universeGapDemandStatus('structural',evidence.channelIds),'hypothesis');
});


test('DNA candidate retrieval rejects single generic coastal/flood anchors from real noisy titles',()=>{
  const coastalGap={
    title:'How Coastal Cities Build Against Rising Water',
    targetSpace:'coastal flood defenses',
    targetKeywords:['sea walls','storm surge barriers','coastal cities','floodgates','tidal basins','shoreline protection'],
    changedVariable:'Coastal defenses',
    firstTests:[]
  };

  const seventhKey=missingDnaCompetitor(
    'seventh-key-noise',
    'History',
    ['The Sumerian Tablet That Describes What the Nephilim Told Humans Before the Flood']
  );
  const timber=missingDnaCompetitor(
    'timber-time-noise',
    'Entertainment',
    ['Abandoned Mega Mansion Renovation Into a Luxury Coastal Retreat with Stunning Epoxy Floors']
  );

  assert.equal(universeGapDnaCandidateMatch(seventhKey,coastalGap).matched,false);
  assert.equal(universeGapDnaCandidateMatch(timber,coastalGap).matched,false);
});

test('DNA candidate retrieval still accepts a complete target keyword with only one lexical hit',()=>{
  const oceanGap={
    title:"How History's Great Ocean Liners Met Their End",
    targetSpace:'historic ocean liners',
    targetKeywords:['ocean liners','passenger ships','shipwrecks','maritime disasters','salvage operations','Atlantic crossings'],
    changedVariable:'Ocean liners',
    firstTests:[]
  };
  const insight=missingDnaCompetitor(
    'insight-shipwreck-target',
    'History',
    ["How Sweden's Greatest Warship Sank in Minutes #history #sweden #shipwreck"]
  );

  const match=universeGapDnaCandidateMatch(insight,oceanGap);
  assert.equal(match.matched,true);
  assert.equal(match.strictEvidence,false);
  assert.equal(match.targetMatchedTerms.includes('shipwrecks'),true);
});


test('generic single-word target keywords need additional context before spending DNA',()=>{
  const gap={
    title:'8 Household Objects With Dark Industrial Origins',
    targetSpace:'household objects and domestic infrastructure',
    targetKeywords:['bathrooms','kitchens','laundry rooms','door locks','heating systems','household plumbing'],
    changedVariable:'Domestic infrastructure',
    firstTests:[]
  };

  const mindful=missingDnaCompetitor(
    'mindful-kitchen-noise',
    'Education',
    ['7 Minimalist Japanese Kitchen Rules for a Peaceful & Clutter Free Small Home']
  );
  const mesigugu=missingDnaCompetitor(
    'bathroom-sketch-noise',
    'Explained',
    ['boys bathroom']
  );
  const plumbing=missingDnaCompetitor(
    'plumbing-target',
    'Engineering',
    ['Why Old Kitchen Plumbing Used Separate Drain Systems']
  );

  assert.equal(universeGapDnaCandidateMatch(mindful,gap).matched,false);
  assert.equal(universeGapDnaCandidateMatch(mesigugu,gap).matched,false);
  assert.equal(universeGapDnaCandidateMatch(plumbing,gap).matched,true);
});

test('specific single-word target keyword such as shipwreck remains a valid DNA candidate signal',()=>{
  const gap={
    title:"How History's Great Ocean Liners Met Their End",
    targetSpace:'historic ocean liners',
    targetKeywords:['ocean liners','passenger ships','shipwrecks','maritime disasters','salvage operations','Atlantic crossings'],
    changedVariable:'Ocean liners',
    firstTests:[]
  };
  const candidate=missingDnaCompetitor(
    'specific-shipwreck',
    'History',
    ['How Sweden\'s Greatest Warship Sank in Minutes #shipwreck']
  );
  const match=universeGapDnaCandidateMatch(candidate,gap);
  assert.equal(match.matched,true);
  assert.equal(match.strictEvidence,false);
  assert.equal(match.targetMatchedTerms.includes('shipwrecks'),true);
});


test('weak station anchors do not validate abandoned railway stations without railway context',()=>{
  const gap={
    title:'The Abandoned Railway Station That Became a Night Market',
    targetSpace:'abandoned railway stations',
    targetKeywords:['railway stations','platforms','ticket halls','night markets','rail corridors'],
    changedVariable:'Railway stations',
    firstTests:[]
  };
  const secretLegacy=competitor('secret-legacy-station','Dramatic Storytelling');
  secretLegacy.recentUploads=[
    {id:'s1',title:'Homeless at 19, She Worked Nights at a Gas Station',publishedAt:'2026-09-20T00:00:00Z',views:40000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const timber=competitor('timber-rail','Design Transformation');
  timber.recentUploads=[
    {id:'t1',title:'Abandoned Train Turned Into a Dream Home on Rails',publishedAt:'2026-09-20T00:00:00Z',views:2600000,duration:'PT8M',thumbnail:'',url:''}
  ];
  const railway=competitor('railway-station-target','Rail History');
  railway.recentUploads=[
    {id:'r1',title:'How an Abandoned Railway Station Became a Night Market',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([secretLegacy,timber,railway],gap,[]);
  assert.deepEqual(resolved.channelIds,['railway-station-target']);
});

test('broad medical anchor does not validate a plague-doctor target',()=>{
  const gap={
    title:'Why Plague Doctors Wore Those Beaked Masks',
    targetSpace:'medical history',
    targetKeywords:['plague doctors','beaked masks','Black Death','historical medicine','quarantine'],
    changedVariable:'Plague-doctor equipment',
    firstTests:[]
  };
  const insight=competitor('insight-medical-noise','Animated Curiosities');
  insight.recentUploads=[
    {id:'i1',title:'The Doctor Who Was Called Crazy for Saving Lives #medical #history',publishedAt:'2026-09-20T00:00:00Z',views:22805,duration:'PT8M',thumbnail:'',url:''}
  ];
  const paint=competitor('paint-plague-target','History');
  paint.recentUploads=[
    {id:'p1',title:'Why Did Plague Doctors Wear Beaked Masks Instead of Normal Masks?',publishedAt:'2026-09-20T00:00:00Z',views:65941,duration:'PT8M',thumbnail:'',url:''}
  ];

  const resolved=resolveUniverseGapEvidence([insight,paint],gap,[]);
  assert.deepEqual(resolved.channelIds,['paint-plague-target']);
});

test('strong surname and bridge anchors remain valid when supported in the same title',()=>{
  const surnameGap={
    title:'Why Your Family Name Still Carries a Medieval Job',
    targetSpace:'occupational surnames',
    targetKeywords:['occupational surnames','medieval trades','family names','guild occupations','name origins'],
    changedVariable:'Surname origins',
    firstTests:[]
  };
  const surname=competitor('surname-strong','Everyday History');
  surname.recentUploads=[
    {id:'s1',title:'Surnames That Prove Your Ancestor Had a Job Nobody Wanted',publishedAt:'2026-09-20T00:00:00Z',views:180000,duration:'PT8M',thumbnail:'',url:''}
  ];

  const bridgeGap={
    title:'Every Type of Bridge Failure Explained',
    targetSpace:'bridge engineering',
    targetKeywords:['bridge failures','suspension bridges','truss bridges','bridge piers','expansion joints','fatigue cracks'],
    changedVariable:'Bridge engineering',
    firstTests:[]
  };
  const bridge=competitor('bridge-strong','Engineering');
  bridge.recentUploads=[
    {id:'b1',title:'The GENIUS Engineering Behind Bailey Bridges!',publishedAt:'2026-09-20T00:00:00Z',views:1190000,duration:'PT8M',thumbnail:'',url:''}
  ];

  assert.deepEqual(resolveUniverseGapEvidence([surname],surnameGap,[]).channelIds,['surname-strong']);
  assert.deepEqual(resolveUniverseGapEvidence([bridge],bridgeGap,[]).channelIds,['bridge-strong']);
});

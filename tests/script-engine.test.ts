import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ContentFactCheck, EpisodeScriptPayload } from '../src/lib/types';
import {
  combineScriptSections, countScriptWords, documentaryScriptClaimIssues, estimateScriptMinutes,
  normalizeScriptPayload, retentionArchitectureIssues, scriptApprovalIssues,
  scriptGenerationIntegrityIssues
} from '../src/lib/script-policy';
import { episodeScriptPayloadSchema } from '../src/lib/server/validation';

const now='2026-09-23T18:30:00.000Z';
const payload:EpisodeScriptPayload={
  kind:'episode-script',
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  contentProjectId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  title:'How Grug Makes Rocks Grow',
  language:'English',
  sections:[
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',label:'Hook',purpose:'Open the contradiction.',content:'Grug saved rocks. Grug still poor.'},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',label:'Body',purpose:'Introduce productive assets.',content:'Then Grug notices one cave makes more rocks.'}
  ],
  content:'placeholder',
  wordCount:1,
  estimatedMinutes:null,
  continuityNotes:['Continue from the saving lesson.'],
  factCheckWarnings:[],
  provenance:{generatedBy:'operator'},
  createdAt:now,
  updatedAt:now
};

test('Script policy combines editable sections into continuous narration',()=>{
  assert.equal(
    combineScriptSections(payload.sections),
    'Grug saved rocks. Grug still poor.\n\nThen Grug notices one cave makes more rocks.'
  );
});

test('Script policy counts words and estimates duration from channel pace',()=>{
  assert.equal(countScriptWords('one two three four'),4);
  assert.equal(estimateScriptMinutes(300,150),2);
  assert.equal(estimateScriptMinutes(300,null),null);
});

test('Script normalization rebuilds content from sections',()=>{
  const normalized=normalizeScriptPayload(payload,120);
  assert.match(normalized.content,/Grug saved rocks/);
  assert.equal(normalized.wordCount,14);
  assert.equal(normalized.estimatedMinutes,0.12);
});

test('Script approval blocks fact-check warnings and verify markers',()=>{
  assert.deepEqual(scriptApprovalIssues({...payload,content:'Clean narration.',factCheckWarnings:[]}),[]);
  assert.deepEqual(
    scriptApprovalIssues({...payload,content:'This claim is [VERIFY].',factCheckWarnings:['Needs source']}),
    ['fact-check-warnings','verify-markers']
  );
});

test('Episode script schema accepts a normalized script payload',()=>{
  const normalized=normalizeScriptPayload(payload,120);
  const parsed=episodeScriptPayloadSchema.parse(normalized);
  assert.equal(parsed.sections.length,2);
  assert.equal(parsed.title,'How Grug Makes Rocks Grow');
});


const historicalClaimId='11111111-2222-4333-8444-555555555555';

function historicalClaim(overrides:Partial<ContentFactCheck>={}):ContentFactCheck{
  return {
    id:historicalClaimId,
    claim:'The documented event occurred in 1925.',
    status:'supported',
    claimType:'fact',
    narrationRule:'assert',
    sourceIds:['66666666-7777-4888-8999-aaaaaaaaaaaa'],
    notes:'Archive record.',
    ...overrides
  };
}

function documentaryScript(content:string,claimIds:string[]=[]):EpisodeScriptPayload{
  return normalizeScriptPayload({
    ...payload,
    sections:[{
      id:'12121212-3434-4567-8899-121212121212',
      label:'History',
      purpose:'State the historical point.',
      content,
      claimIds
    }],
    content,
    factCheckWarnings:[]
  },120);
}

test('Documentary script accepts a supported fact linked to the section',()=>{
  const script=documentaryScript('The archive records the event in 1925.',[historicalClaimId]);
  assert.deepEqual(documentaryScriptClaimIssues({
    payload:script,claims:[historicalClaim()],documentaryMode:true
  }),[]);
});

test('Documentary estimate must use uncertainty language',()=>{
  const claim=historicalClaim({
    claim:'The crowd contained 5,000 people.',
    claimType:'estimate',
    narrationRule:'qualify'
  });
  const certain=documentaryScript('The crowd contained 5,000 people.',[historicalClaimId]);
  assert.ok(documentaryScriptClaimIssues({
    payload:certain,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId));

  const qualified=documentaryScript('The crowd contained approximately 5,000 people.',[historicalClaimId]);
  assert.equal(documentaryScriptClaimIssues({
    payload:qualified,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId),false);
});

test('Documentary allegation must be attributed in narration',()=>{
  const claim=historicalClaim({
    claim:'An official was accused of hiding records.',
    claimType:'allegation',
    narrationRule:'attribute'
  });
  const direct=documentaryScript('An official hid the records in 1925.',[historicalClaimId]);
  assert.ok(documentaryScriptClaimIssues({
    payload:direct,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId));

  const attributed=documentaryScript('According to the archival report, an official allegedly hid the records in 1925.',[historicalClaimId]);
  assert.equal(documentaryScriptClaimIssues({
    payload:attributed,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId),false);
});

test('Documentary script blocks numeric assertions without a claim link',()=>{
  const script=documentaryScript('The tunnel collapsed in 1925.',[]);
  const issues=documentaryScriptClaimIssues({
    payload:script,claims:[historicalClaim()],documentaryMode:true
  });
  assert.ok(issues.some(issue=>issue.startsWith('documentary-unlinked-factual-section:')));
  assert.ok(issues.includes('documentary-script-without-claim-links'));
});

test('Documentary script blocks unknown and excluded claim links',()=>{
  const unknown='99999999-8888-4777-8666-555555555555';
  const unknownIssues=documentaryScriptClaimIssues({
    payload:documentaryScript('The archive records the event in 1925.',[unknown]),
    claims:[historicalClaim()],
    documentaryMode:true
  });
  assert.ok(unknownIssues.includes('documentary-unknown-claim:'+unknown));

  const excluded=historicalClaim({narrationRule:'exclude'});
  const excludedIssues=documentaryScriptClaimIssues({
    payload:documentaryScript('The archive records the event in 1925.',[historicalClaimId]),
    claims:[excluded],
    documentaryMode:true
  });
  assert.ok(excludedIssues.includes('documentary-excluded-claim-used:'+historicalClaimId));
});

test('Episode script schema accepts section-level claim provenance',()=>{
  const value=documentaryScript('The archive records the event in 1925.',[historicalClaimId]);
  const parsed=episodeScriptPayloadSchema.parse(value);
  assert.deepEqual(parsed.sections[0].claimIds,[historicalClaimId]);
});


test('Script approval blocks incomplete resumable generation and releases only when complete',()=>{
  const generation={
    stage:'sections' as const,
    targetWords:10800,
    completedSections:1,
    totalSections:16,
    sectionPlans:[
      {
        id:'91111111-1111-4111-8111-111111111111',
        label:'Opening',
        purpose:'Open the story.',
        targetWords:675,
        claimIds:[]
      }
    ],
    sectionSummaries:['Opening established.'],
    updatedAt:now
  };
  const partial=normalizeScriptPayload({...payload,generation},150);
  assert.ok(scriptApprovalIssues(partial).includes('script-generation-incomplete'));
  const complete=normalizeScriptPayload({
    ...payload,
    generation:{...generation,stage:'complete' as const,completedSections:16}
  },150);
  assert.equal(scriptApprovalIssues(complete).includes('script-generation-incomplete'),false);
});

test('Episode script schema accepts resumable generation state',()=>{
  const value=normalizeScriptPayload({
    ...payload,
    generation:{
      stage:'sections',
      targetWords:10800,
      completedSections:1,
      totalSections:3,
      sectionPlans:[
        {id:'92111111-1111-4111-8111-111111111111',label:'One',purpose:'Start',targetWords:3600,claimIds:[]},
        {id:'92222222-2222-4222-8222-222222222222',label:'Two',purpose:'Develop',targetWords:3600,claimIds:[]},
        {id:'93333333-3333-4333-8333-333333333333',label:'Three',purpose:'Finish',targetWords:3600,claimIds:[]}
      ],
      sectionSummaries:['Opening established.'],
      updatedAt:now
    }
  },150);
  const parsed=episodeScriptPayloadSchema.parse(value);
  assert.equal(parsed.generation?.completedSections,1);
  assert.equal(parsed.generation?.totalSections,3);
});

test('Long-form Script AI uses bounded outline and section calls instead of one huge response',()=>{
  const source=readFileSync('src/lib/server/script-ai.ts','utf8');
  assert.match(source,/planOwnedChannelScript/);
  assert.match(source,/generateOwnedPlannedSection/);
  assert.match(source,/max_output_tokens:4000/);
  assert.match(source,/Math\.max\(1800,Math\.min\(6500/);
  assert.match(source,/previous\.content\.slice\(-6000\)/);
  assert.match(source,/sections:z\.array\(outlineSectionSchema\)\.min\(3\)\.max\(24\)/);
});


test('Resumable Script generation detects a removed completed planned section',()=>{
  const first='94444444-4444-4444-8444-444444444444';
  const second='95555555-5555-4555-8555-555555555555';
  const value=normalizeScriptPayload({
    ...payload,
    sections:[{
      id:second,label:'Second',purpose:'Continue',content:'Second section.',claimIds:[]
    }],
    generation:{
      stage:'sections',
      targetWords:2000,
      completedSections:2,
      totalSections:2,
      sectionPlans:[
        {id:first,label:'First',purpose:'Open',targetWords:1000,claimIds:[]},
        {id:second,label:'Second',purpose:'Continue',targetWords:1000,claimIds:[]}
      ],
      sectionSummaries:['First summary','Second summary'],
      updatedAt:now
    }
  },150);
  const issues=scriptGenerationIntegrityIssues(value);
  assert.ok(issues.includes('script-generation-completed-section-missing:'+first));
});

test('Completed resumable Script requires every planned section id to exist',()=>{
  const first='96666666-6666-4666-8666-666666666666';
  const second='97777777-7777-4777-8777-777777777777';
  const value=normalizeScriptPayload({
    ...payload,
    sections:[{
      id:first,label:'First',purpose:'Open',content:'First section.',claimIds:[]
    }],
    generation:{
      stage:'complete',
      targetWords:2000,
      completedSections:2,
      totalSections:2,
      sectionPlans:[
        {id:first,label:'First',purpose:'Open',targetWords:1000,claimIds:[]},
        {id:second,label:'Second',purpose:'Close',targetWords:1000,claimIds:[]}
      ],
      sectionSummaries:['First summary','Second summary'],
      updatedAt:now
    }
  },150);
  const issues=scriptApprovalIssues(value);
  assert.ok(issues.includes('script-generation-planned-section-missing:'+second));
});

test('assisted-manual Script Engine imports ChatGPT output without provider generation',()=>{
  const route=readFileSync('src/app/api/script-engine/route.ts','utf8');
  const server=readFileSync('src/lib/server/episode-script.ts','utf8');
  assert.match(route,/importOperatorScript/);
  assert.match(route,/context.*operator/);
  assert.match(server,/operatorScriptContext/);
  assert.match(server,/importOperatorScript/);
  assert.match(server,/generatedBy:'chatgpt'/);
  assert.match(server,/chatgpt-operator/);
  assert.match(server,/expectedProjectVersion/);
  assert.match(server,/expectedBrainVersion/);
  assert.match(server,/expectedScriptVersion/);
});

test('Script Engine accepts legacy DB-approved Content Projects without embedded approval payload',()=>{
  const server=readFileSync('src/lib/server/episode-script.ts','utf8');
  assert.match(server,/project\.status==='approved'&&\(!approval\|\|approval\.status==='approved'\)/);
  assert.match(server,/project\.research\?\.factChecks\?\?\[\]/);
});

test('legacy approved scripts expose script text as modern content for Voice Engine',()=>{
  const server=readFileSync('src/lib/server/episode-script.ts','utf8');
  assert.match(server,/typeof raw\.script==='string'\?raw\.script:''/);
  assert.match(server,/content,/);
  assert.match(server,/provenance:raw\.provenance\?\?\{generatedBy:'operator'\}/);
});


function retentionLongForm(overrides:Partial<EpisodeScriptPayload>={}):EpisodeScriptPayload{
  const sections=[
    {
      id:'71111111-1111-4111-8111-111111111111',
      label:'Hook',
      purpose:'Open contradiction.',
      content:'A city solves one problem and creates the next. '.repeat(110),
      claimIds:[],
      retention:{
        role:'hook' as const,
        questionOpened:'Why do successful cities keep rebuilding things that once worked?',
        payoffDelivered:'The viewer sees that urban systems can become constraints.',
        nextQuestion:'What makes a good solution become the wrong solution later?'
      }
    },
    {
      id:'72222222-2222-4222-8222-222222222222',
      label:'Proof',
      purpose:'Show first mechanism.',
      content:'The first case shows demand outgrowing the old solution. '.repeat(100),
      claimIds:[],
      retention:{
        role:'proof' as const,
        questionOpened:'Is growth the whole explanation?',
        payoffDelivered:'Growth can overwhelm yesterday\'s infrastructure.',
        nextQuestion:'What if the city is not growing in the same way?'
      }
    },
    {
      id:'73333333-3333-4333-8333-333333333333',
      label:'Midpoint',
      purpose:'Reframe the interpretation.',
      content:'The next case breaks the growth explanation entirely. '.repeat(100),
      claimIds:[],
      retention:{
        role:'midpoint-reframe' as const,
        questionOpened:'Can a system become wrong even while it still works?',
        payoffDelivered:'Changing external conditions can invalidate a functioning design.',
        nextQuestion:'If planners know this, why can they not future-proof the city once?'
      }
    },
    {
      id:'74444444-4444-4444-8444-444444444444',
      label:'Second Question',
      purpose:'Open deeper problem.',
      content:'Every decision changes the city future decisions must respond to. '.repeat(95),
      claimIds:[],
      retention:{
        role:'second-question' as const,
        questionOpened:'Why can cities not be future-proofed once?',
        payoffDelivered:'Infrastructure changes the environment future planning inherits.',
        nextQuestion:'So what is a successful city actually optimizing for?'
      }
    },
    {
      id:'75555555-5555-4555-8555-555555555555',
      label:'Callback',
      purpose:'Pay off the opening.',
      content:'The city was never unfinished; it was adapting while still running. '.repeat(85),
      claimIds:[],
      retention:{
        role:'callback' as const,
        questionOpened:'',
        payoffDelivered:'The opening contradiction resolves as continuous adaptation.',
        nextQuestion:''
      }
    }
  ];
  const normalized=normalizeScriptPayload({
    ...payload,
    title:'Why Great Cities Never Stand Still',
    sections,
    retention:{
      macroQuestion:'Why do successful cities keep rebuilding things that once worked?',
      promisedPayoff:'Reveal the mechanism that turns yesterday\'s solution into tomorrow\'s constraint.',
      midpointReframe:'Growth is not the whole explanation; external conditions can make a working system wrong.',
      endingCallback:'A city is always building its future on top of yesterday\'s solution.'
    },
    continuityNotes:[],
    factCheckWarnings:[],
    ...overrides
  },155);
  return {...normalized,estimatedMinutes:12.5};
}

test('Retention architecture accepts causal long-form with midpoint and callback',()=>{
  assert.deepEqual(retentionArchitectureIssues(retentionLongForm()),[]);
});

test('Retention architecture blocks a long-form script without a Retention Map',()=>{
  const script=retentionLongForm({retention:undefined});
  assert.ok(retentionArchitectureIssues(script).includes('retention-map-missing'));
});

test('Retention architecture blocks dead-end sections and missing midpoint',()=>{
  const script=retentionLongForm();
  script.sections=script.sections.map((section,index)=>index===1
    ?{...section,retention:{...section.retention!,nextQuestion:''}}
    :section
  );
  script.sections=script.sections.map(section=>section.retention?.role==='midpoint-reframe'
    ?{...section,retention:{...section.retention,role:'proof' as const}}
    :section
  );
  const issues=retentionArchitectureIssues(script);
  assert.ok(issues.includes('retention-next-question-missing:72222222-2222-4222-8222-222222222222'));
  assert.ok(issues.includes('retention-midpoint-reframe-missing'));
});

test('Retention architecture flags repeated generic AI transitions',()=>{
  const script=retentionLongForm();
  script.sections[1].content+=' The important distinction is this.';
  script.sections[2].content+=' Think about what that means.';
  script.content=combineScriptSections(script.sections);
  assert.ok(retentionArchitectureIssues(script).includes('anti-slop-generic-transition-overuse'));
});

test('Script AI plans ending and midpoint before prose',()=>{
  const source=readFileSync('src/lib/server/script-ai.ts','utf8');
  assert.match(source,/Decide the ending and midpoint before the opening/);
  assert.match(source,/macroQuestion/);
  assert.match(source,/midpoint-reframe/);
  assert.match(source,/questionOpened/);
  assert.match(source,/nextQuestion/);
});

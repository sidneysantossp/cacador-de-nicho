import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelBrain, ChannelConcept, ChannelEpisode, ContentProjectPayload } from '../src/lib/types';
import { contentProjectReadiness, contentProjectStage } from '../src/lib/content-os-policy';

const now='2026-09-23T18:00:00.000Z';
const channelId='29383ee5-36cf-4f02-b64e-67371c9e076d';
const episodeId='11111111-1111-4111-8111-111111111111';
const sourceId='22222222-2222-4222-8222-222222222222';

const episode:ChannelEpisode={
  id:episodeId,
  channelId,
  sequence:1,
  status:'idea',
  title:'How Grug Makes Rocks Grow',
  thesis:'Grug learns that saved rocks can be put to work.',
  narrativeSummary:'',
  prerequisiteConcepts:['saving'],
  introducesConcepts:['assets'],
  reinforcesConcepts:[],
  opensThreads:[],
  resolvesThreads:[],
  repetitionKeys:[],
  createdAt:now,
  updatedAt:now
};

const saving:ChannelConcept={
  id:'33333333-3333-4333-8333-333333333333',
  channelId,
  key:'saving',
  label:'Saving',
  description:'',
  status:'established',
  prerequisiteKeys:[],
  createdAt:now,
  updatedAt:now
};

const brain={narrative:{doNotRepeat:[]}} as unknown as ChannelBrain;

function project():ContentProjectPayload{
  return {
    kind:'content-project',
    id:'44444444-4444-4444-8444-444444444444',
    channelId,
    episodeId,
    brief:{
      theme:'Investing basics',
      thesis:'Saved resources can be put to work.',
      angle:'Grug discovers the difference between keeping rocks and owning something productive.',
      promise:'Explain assets without financial jargon.',
      workingTitle:'How Grug Makes Rocks Grow',
      thumbnailConcept:'',
      targetAudience:'Beginners in personal finance.',
      objective:'Introduce assets as the bridge between saving and investing.',
      previousEpisodeConnection:'',
      arcConnection:'Foundations of Money'
    },
    research:{
      notes:'',
      sources:[{
        id:sourceId,
        title:'Primary source',
        url:'https://example.com/source',
        sourceType:'primary',
        claim:'Supports the core definition.',
        checkedAt:now
      }],
      factChecks:[{
        id:'55555555-5555-4555-8555-555555555555',
        claim:'Core factual claim.',
        status:'supported',
        sourceIds:[sourceId],
        notes:'Verified.'
      }]
    },
    approval:{status:'draft',notes:''},
    createdAt:now,
    updatedAt:now
  };
}

test('Content OS readiness passes when brief, fact-check and narrative prerequisites are valid',()=>{
  const result=contentProjectReadiness(project(),episode,[saving],brain);
  assert.equal(result.ready,true);
  assert.deepEqual(result.blockers,[]);
});

test('Content OS blocks missing brief fields',()=>{
  const input=project();
  input.brief.promise='';
  input.brief.objective='';
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,false);
  assert.deepEqual(result.missingBrief,['promise','objective']);
});

test('Content OS blocks unresolved and contradicted fact checks',()=>{
  const input=project();
  input.research.factChecks.push({
    id:'66666666-6666-4666-8666-666666666666',
    claim:'Unresolved claim',
    status:'needs-review',
    sourceIds:[sourceId],
    notes:''
  },{
    id:'77777777-7777-4777-8777-777777777777',
    claim:'Contradicted claim',
    status:'contradicted',
    sourceIds:[sourceId],
    notes:''
  });
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,false);
  assert.equal(result.unresolvedFactChecks.length,1);
  assert.equal(result.contradictedFactChecks.length,1);
});

test('Content OS blocks broken source references',()=>{
  const input=project();
  input.research.factChecks[0].sourceIds=['88888888-8888-4888-8888-888888888888'];
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,false);
  assert.equal(result.factCheckSourceErrors.length,1);
});

test('Content OS blocks approval when narrative prerequisite is unknown',()=>{
  const unknown={...saving,status:'unknown' as const};
  const result=contentProjectReadiness(project(),episode,[unknown],brain);
  assert.equal(result.ready,false);
  assert.deepEqual(result.narrative.missingConcepts,['saving']);
});

test('Content OS stage reflects draft research and approval lifecycle',()=>{
  const input=project();
  input.research={notes:'',sources:[],factChecks:[]};
  assert.equal(contentProjectStage(input),'brief');
  input.research.notes='Research started';
  assert.equal(contentProjectStage(input),'research');
  input.approval.status='ready';
  assert.equal(contentProjectStage(input),'review');
  input.approval.status='approved';
  assert.equal(contentProjectStage(input),'approved');
  input.approval.status='blocked';
  assert.equal(contentProjectStage(input),'blocked');
});

test('Content OS validates Research Pack source links',()=>{
  const input=project();
  input.research.pack={
    question:'How did this place change over time?',
    storyAngle:'Compare one recognizable location across decades.',
    entities:['Times Square'],
    timeline:[{
      id:'99999999-9999-4999-8999-999999999999',
      dateLabel:'1947',
      event:'A historical condition is documented.',
      sourceIds:['88888888-8888-4888-8888-888888888888']
    }],
    audienceSignals:[],
    visualLeads:[]
  };
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,false);
  assert.equal(result.researchPackSourceErrors.length,1);
  assert.match(result.researchPackSourceErrors[0],/^timeline:/);
});

test('Unknown visual rights are surfaced without blocking the pre-script gate',()=>{
  const input=project();
  input.research.pack={
    question:'How did this place change over time?',
    storyAngle:'Use sourced archival comparisons.',
    entities:['Times Square'],
    timeline:[],
    audienceSignals:[],
    visualLeads:[{
      id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title:'Historic Times Square photo',
      pageUrl:'https://example.com/archive/photo',
      provider:'archive',
      mediaType:'image',
      period:'1947',
      location:'Times Square, New York',
      rightsStatus:'unknown',
      licenseLabel:'',
      attribution:'',
      notes:'Review before production.'
    }]
  };
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,true);
  assert.equal(result.unknownVisualRights.length,1);
});

test('Content OS stage recognizes structured Research Pack work',()=>{
  const input=project();
  input.research={
    notes:'',sources:[],factChecks:[],
    pack:{
      question:'What changed?',storyAngle:'Then and now.',entities:['New York'],
      timeline:[],audienceSignals:[],visualLeads:[]
    }
  };
  assert.equal(contentProjectStage(input),'research');
});


test('Reddit alone cannot support a factual claim',()=>{
  const input=project();
  input.research.sources=[{
    id:sourceId,
    title:'Community thread',
    url:'https://reddit.com/r/example/comments/example',
    sourceType:'reference',
    origin:'reddit',
    role:'anecdotal',
    claim:'Community memory only.',
    checkedAt:now
  }];
  input.research.factChecks[0].sourceIds=[sourceId];
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,false);
  assert.deepEqual(result.weakFactCheckEvidence,[input.research.factChecks[0].id]);
  assert.ok(result.blockers.some(item=>item.startsWith('fact-check-evidence:')));
});

test('Wikipedia discovery plus institutional evidence can support a factual claim',()=>{
  const input=project();
  const wikipediaId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  input.research.sources=[{
    id:wikipediaId,
    title:'Wikipedia discovery map',
    url:'https://en.wikipedia.org/wiki/Times_Square',
    sourceType:'reference',
    origin:'wikipedia',
    role:'discovery',
    claim:'Maps entities and references.',
    checkedAt:now
  },{
    id:sourceId,
    title:'Institutional archive',
    url:'https://example.com/archive',
    sourceType:'primary',
    origin:'archive',
    role:'evidence',
    claim:'Supports the historical claim.',
    checkedAt:now
  }];
  input.research.factChecks[0].sourceIds=[wikipediaId,sourceId];
  const result=contentProjectReadiness(input,episode,[saving],brain);
  assert.equal(result.ready,true);
  assert.deepEqual(result.weakFactCheckEvidence,[]);
});

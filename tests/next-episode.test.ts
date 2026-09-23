import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ChannelBrain, ManagedChannel, NarrativeBundle
} from '../src/lib/types';
import {
  buildNextEpisodeEvidenceContext, compileNextEpisodePlan, type NextEpisodeModelResult
} from '../src/lib/next-episode-policy';

const now='2026-09-23T23:55:00.000Z';

function channel():ManagedChannel{
  return {
    id:'11111111-1111-4111-8111-111111111111',
    name:'Dino Knows',
    niche:'AI and future of humanity',
    format:'Animated long-form explainer',
    stage:'production',
    priority:'high',
    description:'A dinosaur interprets plausible futures for humanity.',
    opportunityId:'22222222-2222-4222-8222-222222222222',
    createdAt:now,
    updatedAt:now
  };
}

function brain():ChannelBrain{
  return {
    kind:'channel-brain',
    channelId:channel().id,
    version:7,
    constitution:{
      premise:'Explain plausible futures through Dino.',
      audience:'Adults interested in technology and humanity.',
      editorialPromise:'Each episode advances one concrete future question.',
      worldview:'Skeptical, curious and evidence-driven.',
      tone:['ironic','observant'],
      languageRules:['clear','direct'],
      humor:['dry'],
      universeRules:['Dino observes humanity from outside'],
      forbidden:['invent certainty'],
      metaphors:['prehistoric observer']
    },
    characters:[],
    narrative:{
      currentArc:'Humans after automation',
      stateSummary:'The audience already understands that AI automates tasks.',
      lastEpisodeId:'33333333-3333-4333-8333-333333333333',
      establishedConcepts:['ai-basics'],
      partialConcepts:['future-work'],
      unknownConcepts:['post-work-identity'],
      openThreads:['What happens to human identity when work stops defining people?'],
      resolvedThreads:[],
      doNotRepeat:['robots replace office tasks'],
      nextConcepts:['post-work-identity']
    },
    learnings:[
      {
        id:'44444444-4444-4444-8444-444444444444',
        type:'audience',
        statement:'Viewers repeatedly ask what people do after jobs are automated.',
        evidence:['audience-report:1'],
        confidence:'high',
        createdAt:now
      },
      {
        id:'55555555-5555-4555-8555-555555555555',
        type:'performance',
        statement:'Episodes built around one concrete future consequence retain better.',
        evidence:['performance-report:1'],
        confidence:'medium',
        createdAt:now
      }
    ],
    createdAt:now,
    updatedAt:now
  };
}

function bundle():NarrativeBundle{
  return {
    arcs:[
      {
        id:'66666666-6666-4666-8666-666666666666',
        channelId:channel().id,
        sequence:1,
        status:'active',
        name:'Life after work',
        objective:'Move from automation into identity, status and meaning.',
        premise:'Work stops being the central organizing force.',
        prerequisiteConcepts:['ai-basics'],
        targetConcepts:['post-work-identity'],
        notes:[],
        createdAt:now,
        updatedAt:now
      }
    ],
    episodes:[
      {
        id:'33333333-3333-4333-8333-333333333333',
        channelId:channel().id,
        arcId:'66666666-6666-4666-8666-666666666666',
        sequence:1,
        status:'published',
        title:'AI Took the Easy Jobs First',
        thesis:'Automation starts with repeatable office work.',
        narrativeSummary:'Introduced automation pressure.',
        prerequisiteConcepts:['ai-basics'],
        introducesConcepts:['future-work'],
        reinforcesConcepts:['ai-basics'],
        opensThreads:['What happens after automation spreads?'],
        resolvesThreads:[],
        repetitionKeys:['robots replace office tasks'],
        youtubeVideoId:'video-1',
        publishedAt:now,
        createdAt:now,
        updatedAt:now
      }
    ],
    concepts:[
      {
        id:'77777777-7777-4777-8777-777777777771',
        channelId:channel().id,
        key:'ai-basics',
        label:'AI basics',
        description:'Basic automation capability.',
        status:'established',
        prerequisiteKeys:[],
        createdAt:now,
        updatedAt:now
      },
      {
        id:'77777777-7777-4777-8777-777777777772',
        channelId:channel().id,
        key:'future-work',
        label:'Future of work',
        description:'How work changes under automation.',
        status:'partial',
        prerequisiteKeys:['ai-basics'],
        createdAt:now,
        updatedAt:now
      },
      {
        id:'77777777-7777-4777-8777-777777777773',
        channelId:channel().id,
        key:'post-work-identity',
        label:'Post-work identity',
        description:'Meaning and status when employment matters less.',
        status:'unknown',
        prerequisiteKeys:['future-work'],
        createdAt:now,
        updatedAt:now
      }
    ]
  };
}

function model():NextEpisodeModelResult{
  return {
    recommendedIndex:0,
    recommendationRationale:'Advance from automation into identity.',
    candidates:[
      {
        workingTitle:'Robots Replace Office Tasks Again',
        theme:'Automation',
        thesis:'Robots continue replacing office work.',
        angle:'Repeat the previous mechanism.',
        promise:'See the same automation story again.',
        thumbnailConcept:'Robot at an office desk.',
        targetAudience:'General technology audience.',
        objective:'Repeat automation.',
        previousEpisodeConnection:'Direct continuation.',
        arcRef:'arc:66666666-6666-4666-8666-666666666666',
        prerequisiteConceptRefs:['concept:ai-basics'],
        introducesConceptRefs:[],
        reinforcesConceptRefs:['concept:future-work'],
        opensThreads:[],
        resolvesThreadRefs:[],
        repetitionKeys:['robots replace office tasks'],
        evidenceRefs:[
          'learning:44444444-4444-4444-8444-444444444444',
          'episode:33333333-3333-4333-8333-333333333333'
        ],
        rationale:'Audience knows this mechanism already.',
        risks:['Repetition']
      },
      {
        workingTitle:'What Are Humans For When Work Disappears?',
        theme:'Identity after automation',
        thesis:'When jobs matter less, status and meaning become the next human problem.',
        angle:'Move from employment loss to identity.',
        promise:'Understand the social problem that comes after job automation.',
        thumbnailConcept:'Dino watching a human holding a useless office badge.',
        targetAudience:'Adults interested in AI and society.',
        objective:'Advance the active narrative arc.',
        previousEpisodeConnection:'Starts where the previous episode ended.',
        arcRef:'arc:66666666-6666-4666-8666-666666666666',
        prerequisiteConceptRefs:['concept:future-work'],
        introducesConceptRefs:['concept:post-work-identity'],
        reinforcesConceptRefs:['concept:future-work'],
        opensThreads:['If work no longer gives status, what replaces it?'],
        resolvesThreadRefs:['thread:t1'],
        repetitionKeys:['identity after work'],
        evidenceRefs:[
          'learning:44444444-4444-4444-8444-444444444444',
          'thread:t1',
          'concept:post-work-identity'
        ],
        rationale:'Audience demand and the open thread both point to identity as the next step.',
        risks:['The topic can become abstract without concrete examples.']
      },
      {
        workingTitle:'The New Economy of Free Time',
        theme:'Leisure after automation',
        thesis:'More free time creates new coordination problems.',
        angle:'Focus on leisure systems.',
        promise:'See what abundant free time changes.',
        thumbnailConcept:'Dino surrounded by clocks and empty offices.',
        targetAudience:'Future-focused viewers.',
        objective:'Explore a related branch.',
        previousEpisodeConnection:'Adjacent consequence of automation.',
        arcRef:'arc:66666666-6666-4666-8666-666666666666',
        prerequisiteConceptRefs:['concept:ai-basics'],
        introducesConceptRefs:[],
        reinforcesConceptRefs:['concept:future-work'],
        opensThreads:['Who controls abundant free time?'],
        resolvesThreadRefs:[],
        repetitionKeys:['free time economy'],
        evidenceRefs:['concept:future-work'],
        rationale:'Narratively valid but supported by weaker evidence.',
        risks:['Less direct audience evidence.']
      }
    ]
  };
}

test('Next Episode evidence context uses stable refs from channel memory',()=>{
  const context=buildNextEpisodeEvidenceContext(channel(),brain(),bundle());
  assert.ok(context.sources.some(item=>item.ref==='learning:44444444-4444-4444-8444-444444444444'));
  assert.ok(context.sources.some(item=>item.ref==='thread:t1'));
  assert.ok(context.sources.some(item=>item.ref==='concept:post-work-identity'));
  assert.ok(context.sources.some(item=>item.ref==='arc:66666666-6666-4666-8666-666666666666'));
  assert.equal(context.marketSignal,'linked-opportunity');
});

test('Next Episode compiler rejects invented evidence refs',()=>{
  const invalid=model();
  invalid.candidates[1].evidenceRefs=['learning:not-real'];
  assert.throws(
    ()=>compileNextEpisodePlan({
      id:'88888888-8888-4888-8888-888888888888',
      channel:channel(),brain:brain(),bundle:bundle(),model:invalid
    }),
    /Unknown next episode evidence ref/
  );
});

test('Narrative repetition blocks the model recommendation and selects a ready fallback',()=>{
  const plan=compileNextEpisodePlan({
    id:'88888888-8888-4888-8888-888888888888',
    channel:channel(),brain:brain(),bundle:bundle(),model:model()
  });
  const repeated=plan.candidates[0];
  const identity=plan.candidates[1];

  assert.equal(repeated.narrativeReady,false);
  assert.ok(repeated.blockers.includes('repetition-conflict:robots replace office tasks'));
  assert.equal(identity.narrativeReady,true);
  assert.equal(identity.evidenceStrength,'high');
  assert.equal(plan.recommendedCandidateId,identity.id);
});

test('Next Episode plan snapshots the exact evidence used at generation time',()=>{
  const sourceBrain=brain();
  const plan=compileNextEpisodePlan({
    id:'88888888-8888-4888-8888-888888888888',
    channel:channel(),brain:sourceBrain,bundle:bundle(),model:model()
  });
  const original=plan.context.evidenceSnapshot.find(item=>item.ref==='learning:44444444-4444-4444-8444-444444444444');
  assert.match(original?.summary??'',/repeatedly ask what people do/i);

  sourceBrain.learnings[0].statement='Changed after plan generation.';
  const frozen=plan.context.evidenceSnapshot.find(item=>item.ref==='learning:44444444-4444-4444-8444-444444444444');
  assert.match(frozen?.summary??'',/repeatedly ask what people do/i);
});

test('Strong audience and performance learnings avoid false data limitations',()=>{
  const plan=compileNextEpisodePlan({
    id:'88888888-8888-4888-8888-888888888888',
    channel:channel(),brain:brain(),bundle:bundle(),model:model()
  });
  assert.ok(!plan.limitations.some(item=>item.includes('learnings de audiência')));
  assert.ok(!plan.limitations.some(item=>item.includes('learnings de performance')));
  assert.ok(!plan.limitations.some(item=>item.includes('opportunityId')));
});

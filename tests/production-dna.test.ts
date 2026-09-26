import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProductionDnaPayload } from '../src/lib/types';
import { buildProductionPrompt, productionDnaFormatIssues } from '../src/lib/production-dna-policy';
import { productionDnaPayloadSchema } from '../src/lib/server/validation';

const now='2026-09-23T17:00:00.000Z';
const dna:ProductionDnaPayload={
  kind:'production-dna',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  format:{
    aspectRatio:'16:9',width:1920,height:1080,fps:30,
    targetDurationMinutes:{min:null,max:null},
    sceneDurationSeconds:{min:null,preferred:null,max:null}
  },
  visual:{
    styleName:'Grug Caveman Doodle 2D',
    styleDescription:'Simple hand-drawn 2D caveman doodle animation.',
    palette:['ochre','sand','brown','olive','dusty blue'],
    compositionRules:['Simple readable composition.'],
    cameraRules:['Prefer clear framing.'],
    motionRules:[],
    basePrompt:'hand-drawn 2D caveman doodle animation, flat colours, subtle paper texture',
    scenePromptTemplate:'{{scene_direction}} + {{character_bible}} + {{visual_bible}} + {{negative_rules}} + {{aspect_ratio}}',
    negativePrompt:'no realism, no 3D',
    forbidden:['glossy rendering','cinematic lighting']
  },
  characters:[{
    id:'grug',
    name:'Grug',
    description:'Recurring caveman protagonist.',
    visualRules:['plain white oval head','exactly two tiny black dot eyes','one tiny black line mouth'],
    forbidden:['nose','ears','eyebrows'],
    referenceAssets:[]
  }],
  voice:{
    language:'English',
    providerPreference:['ElevenLabs'],
    voiceId:'',
    voiceName:'',
    narrationStyle:[],
    paceWpm:null,
    pronunciationRules:[]
  },
  captions:{
    enabled:true,
    styleDescription:'',
    position:'bottom-center',
    maxWordsPerCaption:null,
    highlightKeywords:false
  },
  editing:{
    transitions:[],
    defaultTransition:'cut',
    kenBurns:false,
    musicStyle:[],
    sfxRules:[],
    pacingRules:[]
  },
  thumbnail:{styleRules:[],forbidden:[]},
  providers:{image:['Nano Banana'],video:[],voice:['ElevenLabs'],stock:[]},
  createdAt:now,
  updatedAt:now
};

test('Production DNA schema accepts the Grug-style production contract',()=>{
  const parsed=productionDnaPayloadSchema.parse(dna);
  assert.equal(parsed.format.aspectRatio,'16:9');
  assert.equal(parsed.characters[0].id,'grug');
  assert.deepEqual(parsed.providers.image,['Nano Banana']);
});

test('Production DNA compiler combines scene direction, character bible and visual bible',()=>{
  const result=buildProductionPrompt(dna,'medium-wide shot, @Grug raising both arms beside saved stones',['grug']);
  assert.match(result.positivePrompt,/medium-wide shot/);
  assert.match(result.positivePrompt,/plain white oval head/);
  assert.match(result.positivePrompt,/hand-drawn 2D caveman doodle animation/);
  assert.match(result.positivePrompt,/16:9/);
  assert.match(result.negativePrompt,/no realism/);
  assert.match(result.negativePrompt,/nose/);
});

test('Production DNA prompt compiler excludes character rules when character is not selected',()=>{
  const result=buildProductionPrompt(dna,'wide shot of an empty prehistoric market',[]);
  assert.doesNotMatch(result.positivePrompt,/plain white oval head/);
  assert.doesNotMatch(result.negativePrompt,/eyebrows/);
});

test('Production DNA detects contradictory duration ranges',()=>{
  const invalid:ProductionDnaPayload={
    ...dna,
    format:{
      ...dna.format,
      targetDurationMinutes:{min:15,max:10},
      sceneDurationSeconds:{min:4,preferred:3,max:2}
    }
  };
  assert.deepEqual(productionDnaFormatIssues(invalid),[
    'target-duration-min-greater-than-max',
    'scene-duration-min-greater-than-max',
    'scene-duration-preferred-below-min',
    'scene-duration-preferred-above-max'
  ]);
});


test('Production DNA schema accepts documentary research policy',()=>{
  const documentary:ProductionDnaPayload={
    ...dna,
    research:{documentaryMode:true,requireClaimLedger:true}
  };
  const parsed=productionDnaPayloadSchema.parse(documentary);
  assert.equal(parsed.research?.documentaryMode,true);
  assert.equal(parsed.research?.requireClaimLedger,true);
});

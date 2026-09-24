import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProductionDNA, ScenePlan } from '../src/lib/types';
import {
  buildInitialVisualPromptSet, compileScenePrompt, productionFileName, recurringCharacterIds,
  visualPromptIssues, visualTimecodeLabel
} from '../src/lib/visual-prompt-policy';

const now='2026-09-23T21:00:00.000Z';

const dna={
  kind:'production-dna',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  version:2,
  format:{aspectRatio:'16:9',width:1920,height:1080,fps:30,targetDurationMinutes:{min:null,max:null},sceneDurationSeconds:{min:null,preferred:null,max:null}},
  visual:{
    styleName:'Grug',
    styleDescription:'Simple 2D doodle.',
    palette:[],
    compositionRules:[],
    cameraRules:[],
    motionRules:[],
    basePrompt:'EXACT STYLE LOCK',
    scenePromptTemplate:'',
    negativePrompt:'no realism, no 3D',
    forbidden:[]
  },
  characters:[
    {id:'grug',name:'Grug',description:'Caveman protagonist.',visualRules:['plain white oval head'],forbidden:['nose'],referenceAssets:[]},
    {id:'merchant',name:'Merchant',description:'One-off merchant.',visualRules:['simple robe'],forbidden:[],referenceAssets:[]}
  ],
  voice:{language:'English',providerPreference:[],voiceId:'',voiceName:'',narrationStyle:[],paceWpm:null,pronunciationRules:[]},
  captions:{enabled:true,styleDescription:'',position:'bottom-center',maxWordsPerCaption:null,highlightKeywords:false},
  editing:{transitions:[],defaultTransition:'cut',kenBurns:false,musicStyle:[],sfxRules:[],pacingRules:[]},
  thumbnail:{styleRules:[],forbidden:[]},
  providers:{image:[],video:[],voice:[],stock:[]},
  createdAt:now,updatedAt:now
} as ProductionDNA;

const plan={
  kind:'scene-plan',
  id:'11111111-1111-4111-8111-111111111111',
  channelId:dna.channelId,
  episodeId:'22222222-2222-4222-8222-222222222222',
  scriptId:'33333333-3333-4333-8333-333333333333',
  voiceAssetId:'44444444-4444-4444-8444-444444444444',
  transcriptId:'55555555-5555-4555-8555-555555555555',
  transcriptVersion:3,
  voiceTake:1,
  audioDurationSeconds:10,
  scenes:[
    {
      id:'66666666-6666-4666-8666-666666666666',sequence:1,startSeconds:0,endSeconds:5,durationSeconds:5,
      narration:'Grug counts rocks with a merchant.',transcriptSegmentIds:[],transcriptWordIds:[],
      visualIntent:'Grug comparing two piles of rocks.',shotType:'medium shot',characterIds:['grug','merchant'],
      assetMode:'image',promptDirection:'Grug beside two piles of rocks and a generic merchant.',notes:''
    },
    {
      id:'77777777-7777-4777-8777-777777777777',sequence:2,startSeconds:5.4,endSeconds:10,durationSeconds:4.6,
      narration:'Grug walks home with fewer rocks.',transcriptSegmentIds:[],transcriptWordIds:[],
      visualIntent:'Grug walking toward his cave.',shotType:'wide shot',characterIds:['grug'],
      assetMode:'image',promptDirection:'Grug walking toward a cave carrying a small rock pouch.',notes:''
    }
  ],
  review:{notes:'',durationWarningsAccepted:false},
  createdAt:now,updatedAt:now,
  version:4,status:'approved'
} as ScenePlan;

test('Visual timecode labels use existing scene start without inventing new beats',()=>{
  assert.equal(visualTimecodeLabel(0),'#0-00');
  assert.equal(visualTimecodeLabel(65.9),'#1-05');
});

test('Only characters present in two or more scenes are recurring references',()=>{
  const recurring=recurringCharacterIds(plan.scenes.map(scene=>({sceneId:scene.id,characterIds:scene.characterIds})));
  assert.deepEqual(recurring,['grug']);
});

test('Initial visual prompt set creates one prompt per scene and one recurring reference',()=>{
  const set=buildInitialVisualPromptSet(plan,dna);
  assert.equal(set.scenePrompts.length,plan.scenes.length);
  assert.equal(set.characterReferences.length,1);
  assert.equal(set.characterReferences[0].characterId,'grug');
  assert.equal(set.characterReferences[0].refName,'#Grug');
  assert.equal(set.workflowStage,'references');
});

test('Scene prompts use @Name only for recurring characters and append style lock literally',()=>{
  const set=buildInitialVisualPromptSet(plan,dna);
  const first=set.scenePrompts[0];
  assert.match(first.prompt,/@Grug/);
  assert.doesNotMatch(first.prompt,/@Merchant/);
  assert.equal(first.prompt.endsWith('EXACT STYLE LOCK'),true);
  assert.equal(first.timecodeLabel,'#0-00');
});

test('Production filenames are deterministic from channel episode scene and take',()=>{
  const set=buildInitialVisualPromptSet(plan,dna,{channelCode:'GRUG',episodeNumber:3});
  assert.equal(set.productionNaming.pattern,'{CHANNEL}_V{VIDEO}_S{SCENE}_T{TAKE}.mp4');
  assert.equal(set.scenePrompts[0].outputFileStem,'GRUG_V03_S001_T01');
  assert.equal(set.scenePrompts[0].outputFileName,'GRUG_V03_S001_T01.mp4');
  assert.equal(set.scenePrompts[1].outputFileName,'GRUG_V03_S002_T01.mp4');
  assert.equal(productionFileName({channelCode:'Grug',episodeNumber:3},12,4),'GRUG_V03_S012_T04.mp4');
});

test('Compiler preserves one-off character ids without converting them into references',()=>{
  const compiled=compileScenePrompt(
    plan.scenes[0],
    dna,
    ['grug','merchant'],
    'Grug comparing rocks with a generic merchant.',
    ['grug'],
    {channelCode:'GRUG',episodeNumber:3}
  );
  assert.deepEqual(compiled.characterIds,['grug','merchant']);
  assert.deepEqual(compiled.referenceNames,['@Grug']);
  assert.equal(compiled.outputFileName,'GRUG_V03_S001_T01.mp4');
});

test('Visual approval blocks until recurring references are ready',()=>{
  const set=buildInitialVisualPromptSet(plan,dna);
  const issues=visualPromptIssues(set,plan,dna,true);
  assert.ok(issues.includes('character-reference-not-ready'));
  set.characterReferences[0].assetReady=true;
  assert.equal(visualPromptIssues(set,plan,dna,true).includes('character-reference-not-ready'),false);
});

test('Visual approval detects stale upstream versions and style lock drift',()=>{
  const set=buildInitialVisualPromptSet(plan,dna);
  set.characterReferences.forEach(ref=>{ref.assetReady=true;});
  set.scenePlanVersion=3;
  set.productionDnaVersion=1;
  set.styleLock='changed';
  const issues=visualPromptIssues(set,plan,dna,true);
  assert.ok(issues.includes('stale-scene-plan-version'));
  assert.ok(issues.includes('stale-production-dna-version'));
  assert.ok(issues.includes('style-lock-changed'));
});

test('Visual approval detects missing or extra scene prompts',()=>{
  const set=buildInitialVisualPromptSet(plan,dna);
  set.characterReferences.forEach(ref=>{ref.assetReady=true;});
  set.scenePrompts=set.scenePrompts.slice(0,1);
  const issues=visualPromptIssues(set,plan,dna,true);
  assert.ok(issues.includes('scene-prompt-count-mismatch'));
  assert.ok(issues.includes('missing-scene-prompt'));
});

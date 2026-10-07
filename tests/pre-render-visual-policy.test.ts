import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductionDNA, ScenePlanPayload } from '../src/lib/types';
import {
  preRenderVisualQaIssues, productionPrefersMotion, scenePlanVisualStrategyIssues
} from '../src/lib/pre-render-visual-policy';
import { classifyVisualBeat } from '../src/lib/visual-beat-policy';

const motionDna={
  visual:{
    styleDescription:'Premium documentary edit, never a generic AI slideshow.',
    negativePrompt:'no generic AI slideshow',
    motionRules:['Prefer continuous motion over static slides.'],
    cameraRules:[]
  },
  editing:{pacingRules:['Avoid static filler.']},
  research:{documentaryMode:true}
} as unknown as ProductionDNA;

function badScene(index:number){
  return {
    id:'scene-'+index,
    sequence:index,
    assetMode:'image',
    shotType:'editorial systems visualization',
    visualIntent:'Original illustrative systems visualization',
    promptDirection:'Reusable system diagram template',
    visualBeats:[{
      id:'beat-'+index,
      sequence:1,
      sourcePreference:'generated',
      type:'illustration'
    }]
  };
}

function motionScene(index:number){
  return {
    id:'scene-'+index,
    sequence:index,
    assetMode:'video',
    shotType:index%3===0?'wide shot':index%3===1?'medium shot':'close-up',
    visualIntent:'Specific visual intent '+index,
    promptDirection:'Specific direction '+index,
    visualBeats:[{
      id:'beat-'+index,
      sequence:1,
      sourcePreference:'stock-video',
      type:'literal'
    }]
  };
}

test('Production DNA can explicitly require motion-first planning',()=>{
  assert.equal(productionPrefersMotion(motionDna),true);
});

test('Scene Plan gate blocks generated system-slide monoculture before asset spend',()=>{
  const plan={scenes:Array.from({length:24},(_,index)=>badScene(index+1))} as unknown as ScenePlanPayload;
  const issues=scenePlanVisualStrategyIssues(plan,motionDna);
  assert.ok(issues.includes('visual-strategy-generated-concentration'));
  assert.ok(issues.includes('visual-strategy-motion-underplanned'));
  assert.ok(issues.includes('visual-strategy-image-heavy'));
  assert.ok(issues.includes('visual-strategy-shot-type-concentration'));
  assert.ok(issues.includes('visual-strategy-direction-repetition'));
});

test('Scene Plan gate allows diversified motion-first planning',()=>{
  const plan={scenes:Array.from({length:24},(_,index)=>motionScene(index+1))} as unknown as ScenePlanPayload;
  assert.deepEqual(scenePlanVisualStrategyIssues(plan,motionDna),[]);
});

function qa(overrides:Record<string,unknown>={}){
  return {
    policyVersion:'visual-qa-v1',
    status:'pass',
    reviewedAt:'2026-10-07T00:00:00.000Z',
    model:'test',
    query:'test',
    relevance:.9,
    qualityScore:.9,
    editorialUsefulness:.9,
    placeholderLike:false,
    templateLike:false,
    staticGraphic:false,
    visualClass:'live-footage',
    issues:[],
    summary:'usable',
    motion:{
      sampledFrames:3,
      freezeSeconds:0,
      freezeRatio:0,
      meaningfulMotion:true
    },
    ...overrides
  } as any;
}

test('Pre-render gate does not count an MP4 with static/template QA as valid motion',()=>{
  const assets=Array.from({length:20},(_,index)=>({
    assetId:'asset-'+index,
    sceneId:'scene-'+index,
    assetKind:'video' as const,
    visualQa:index<12
      ?qa({
        templateLike:true,
        staticGraphic:true,
        visualClass:'interface-card',
        motion:{sampledFrames:3,freezeSeconds:2.5,freezeRatio:.85,meaningfulMotion:false}
      })
      :qa()
  }));
  const issues=preRenderVisualQaIssues({assets,dna:motionDna});
  assert.ok(issues.includes('visual-video-without-meaningful-motion'));
  assert.ok(issues.includes('visual-static-graphic-concentration'));
  assert.ok(issues.includes('visual-template-concentration'));
  assert.ok(issues.includes('visual-static-class-concentration'));
});

test('Pre-render gate blocks missing QA instead of discovering it after render',()=>{
  const issues=preRenderVisualQaIssues({
    assets:[{assetId:'asset-1',sceneId:'scene-1',assetKind:'video'}],
    dna:motionDna
  });
  assert.ok(issues.includes('visual-qa-incomplete'));
});


test('Motion-first planning routes generic literal beats to video before stills',()=>{
  assert.equal(
    classifyVisualBeat('NPC behavior reveals another layer of the simulation',true).sourcePreference,
    'stock-video'
  );
  assert.equal(
    classifyVisualBeat('A 1947 archive photograph documents the original system',true).sourcePreference,
    'archive-image'
  );
});

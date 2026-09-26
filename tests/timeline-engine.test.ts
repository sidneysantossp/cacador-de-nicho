import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ProductionDNA, ScenePlan, TimelinePayload, VisualPromptSet, VoiceAsset
} from '../src/lib/types';
import {
  buildInitialTimeline, fitVideoSourceWindow, normalizeTimeline, timelineApprovalIssues,
  timelineAssetIssues, timelineStructuralIssues
} from '../src/lib/timeline-policy';

const now='2026-09-23T21:00:00.000Z';

const scenePlan={
  id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scriptId:'33333333-3333-4333-8333-333333333333',
  voiceAssetId:'44444444-4444-4444-8444-444444444444',
  transcriptId:'55555555-5555-4555-8555-555555555555',
  version:3,
  status:'approved',
  audioDurationSeconds:6,
  voiceTake:1,
  transcriptVersion:2,
  review:{notes:'',durationWarningsAccepted:false},
  scenes:[
    {id:'66666666-6666-4666-8666-666666666666',sequence:1,startSeconds:0,endSeconds:3,durationSeconds:3,narration:'First.',transcriptSegmentIds:[],transcriptWordIds:[],visualIntent:'',shotType:'',characterIds:[],assetMode:'image',promptDirection:'',notes:''},
    {id:'77777777-7777-4777-8777-777777777777',sequence:2,startSeconds:3,endSeconds:6,durationSeconds:3,narration:'Second.',transcriptSegmentIds:[],transcriptWordIds:[],visualIntent:'',shotType:'',characterIds:[],assetMode:'video',promptDirection:'',notes:''}
  ],
  kind:'scene-plan',
  createdAt:now,
  updatedAt:now
} as ScenePlan;

const dna={
  format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'}
} as ProductionDNA;

const promptSet={
  id:'88888888-8888-4888-8888-888888888888',
  version:4
} as VisualPromptSet;

const voice={
  id:scenePlan.voiceAssetId,
  take:1,
  durationSeconds:6
} as VoiceAsset;

const assets=[
  {id:'99999999-9999-4999-8999-999999999999',sceneId:scenePlan.scenes[0].id,assetKind:'image' as const,durationSeconds:null},
  {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sceneId:scenePlan.scenes[1].id,assetKind:'video' as const,durationSeconds:3}
];

function timeline():TimelinePayload{
  return buildInitialTimeline({
    scenePlan,productionDna:dna,visualPromptSet:promptSet,visualAssets:assets,voiceAsset:voice
  });
}

test('Timeline Engine builds visual and narration tracks from approved upstream state',()=>{
  const t=timeline();
  assert.equal(t.tracks.length,2);
  assert.equal(t.tracks.find(track=>track.type==='visual')?.clips.length,2);
  assert.equal(t.tracks.find(track=>track.type==='voice')?.clips.length,1);
  assert.equal(t.durationSeconds,6);
  assert.equal(t.format.width,1920);
});

test('Long video shortfall cannot silently pass approval as a loop',()=>{
  const shortAssets=[
    assets[0],
    {...assets[1],durationSeconds:2}
  ];
  const t=buildInitialTimeline({
    scenePlan,productionDna:dna,visualPromptSet:promptSet,visualAssets:shortAssets,voiceAsset:voice
  });
  const clip=t.tracks.find(track=>track.type==='visual')!.clips[1];
  assert.equal(clip.clipKind,'video');
  assert.equal(clip.playback,'loop');
  assert.equal(clip.sourceEndSeconds,2);
  assert.ok(timelineStructuralIssues(t,scenePlan).includes('video-loop-too-long'));
});

test('Timeline Engine makes missing media an explicit placeholder and blocks approval',()=>{
  const t=buildInitialTimeline({
    scenePlan,productionDna:dna,visualPromptSet:promptSet,visualAssets:[assets[0]],voiceAsset:voice
  });
  const visual=t.tracks.find(track=>track.type==='visual')!;
  assert.equal(visual.clips[1].clipKind,'placeholder');
  assert.ok(timelineStructuralIssues(t,scenePlan).includes('missing-scene-asset'));
});

test('Timeline structural gate accepts a fully mapped deterministic timeline',()=>{
  const t=timeline();
  assert.deepEqual(timelineStructuralIssues(t,scenePlan),[]);
});

test('Timeline structural gate detects visual gaps and scene timing drift',()=>{
  const t=timeline();
  const visual=t.tracks.find(track=>track.type==='visual')!;
  visual.clips[1]={...visual.clips[1],startSeconds:3.5};
  const issues=timelineStructuralIssues(normalizeTimeline(t),scenePlan);
  assert.ok(issues.includes('visual-gap'));
  assert.ok(issues.includes('visual-clip-scene-time-mismatch'));
});

test('Timeline structural gate requires narration to cover the full project',()=>{
  const t=timeline();
  const voiceTrack=t.tracks.find(track=>track.type==='voice')!;
  voiceTrack.clips[0]={...voiceTrack.clips[0],endSeconds:5.5};
  assert.ok(timelineStructuralIssues(normalizeTimeline(t),scenePlan).includes('voice-does-not-cover-timeline'));
});

test('Timeline asset gate detects changed selection and stale upstream assets',()=>{
  const t=timeline();
  const selected=new Map([
    [scenePlan.scenes[0].id,{id:assets[0].id,stale:false,ready:true}],
    [scenePlan.scenes[1].id,{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',stale:true,ready:true}]
  ]);
  const issues=timelineAssetIssues({
    timeline:t,
    currentScenePlanVersion:scenePlan.version,
    currentPromptSetVersion:promptSet.version,
    voiceReady:true,
    voiceStale:false,
    selectedSceneAssets:selected
  });
  assert.ok(issues.includes('scene-asset-selection-changed'));
});

test('Timeline approval combines structural and current asset gates',()=>{
  const t=timeline();
  const issues=timelineApprovalIssues(t,scenePlan,['voice-stale']);
  assert.deepEqual(issues,['voice-stale']);
});


test('Timeline preserves Visual Intelligence source trim instead of starting video at zero',()=>{
  const trimmedAssets=[
    assets[0],
    {
      ...assets[1],
      durationSeconds:20,
      sourceStartSeconds:13,
      sourceEndSeconds:18
    }
  ];
  const t=buildInitialTimeline({
    scenePlan,productionDna:dna,visualPromptSet:promptSet,visualAssets:trimmedAssets,voiceAsset:voice
  });
  const clip=t.tracks.find(track=>track.type==='visual')!.clips[1];
  assert.equal(clip.sourceStartSeconds,13);
  assert.equal(clip.sourceEndSeconds,18);
  assert.equal(clip.playback,'trim');
});


test('Source window fitting expands Manhattan Bridge within the same source asset',()=>{
  const fit=fitVideoSourceWindow({
    sourceStartSeconds:0,
    sourceEndSeconds:5.613333333333333,
    assetDurationSeconds:16.84,
    desiredDurationSeconds:7
  });
  assert.equal(fit.playback,'trim');
  assert.equal(fit.sourceStartSeconds,0);
  assert.equal(fit.sourceEndSeconds,7);
  assert.equal(fit.shortfallSeconds,0);
});

test('Source window fitting can extend backward when verified trim ends at source end',()=>{
  const fit=fitVideoSourceWindow({
    sourceStartSeconds:6.6733335,
    sourceEndSeconds:13.346667,
    assetDurationSeconds:13.346667,
    desiredDurationSeconds:7
  });
  assert.equal(fit.playback,'trim');
  assert.ok(Math.abs(fit.sourceStartSeconds-6.346667)<.00001);
  assert.equal(fit.sourceEndSeconds,13.346667);
  assert.ok(fit.shortfallSeconds<.00001);
});

test('Small source shortage freezes the final frame instead of looping',()=>{
  const fit=fitVideoSourceWindow({
    sourceStartSeconds:0,
    sourceEndSeconds:6.740067,
    assetDurationSeconds:6.740067,
    desiredDurationSeconds:7
  });
  assert.equal(fit.playback,'hold');
  assert.equal(fit.sourceEndSeconds,6.740067);
  assert.ok(fit.shortfallSeconds>.25&&fit.shortfallSeconds<.27);
});

test('Large source shortage remains explicit and blocks approval',()=>{
  const fit=fitVideoSourceWindow({
    sourceStartSeconds:0,
    sourceEndSeconds:2,
    assetDurationSeconds:2,
    desiredDurationSeconds:3
  });
  assert.equal(fit.playback,'loop');
  assert.equal(fit.shortfallSeconds,1);
});

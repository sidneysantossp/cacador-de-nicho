import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProductionDNA, ScenePlanPayload, Transcript } from '../src/lib/types';
import {
  createInitialScenes, normalizeScenePlan, sceneDurationWarnings,
  scenePlanApprovalIssues, scenePlanStructuralIssues
} from '../src/lib/scene-timecode-policy';

const now='2026-09-23T20:00:00.000Z';

const transcript:Transcript={
  kind:'transcript',
  id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scriptId:'33333333-3333-4333-8333-333333333333',
  voiceAssetId:'44444444-4444-4444-8444-444444444444',
  sourceType:'imported',
  languageCode:'en',
  text:'First line. Second line.',
  words:[],
  segments:[
    {id:'55555555-5555-4555-8555-555555555555',startSeconds:.5,endSeconds:2,text:'First line.',wordIds:[]},
    {id:'66666666-6666-4666-8666-666666666666',startSeconds:3,endSeconds:5,text:'Second line.',wordIds:[]}
  ],
  scriptMatchScore:1,
  scriptVersion:2,
  voiceTake:1,
  originalFormat:'srt',
  provenance:{importedBy:'operator'},
  review:{scriptMismatchOverride:false,notes:''},
  createdAt:now,
  updatedAt:now,
  version:3,
  status:'approved'
};

function plan():ScenePlanPayload{
  const scenes=createInitialScenes(transcript,6);
  return {
    kind:'scene-plan',
    id:'77777777-7777-4777-8777-777777777777',
    channelId:transcript.channelId,
    episodeId:transcript.episodeId,
    scriptId:transcript.scriptId,
    voiceAssetId:transcript.voiceAssetId,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    voiceTake:transcript.voiceTake,
    audioDurationSeconds:6,
    scenes,
    review:{notes:'',durationWarningsAccepted:false},
    createdAt:now,
    updatedAt:now
  };
}

const dna={
  format:{sceneDurationSeconds:{min:2,preferred:3,max:4}}
} as unknown as ProductionDNA;

test('Scene Timecode creates a contiguous initial timeline from transcript segments',()=>{
  const scenes=createInitialScenes(transcript,6);
  assert.equal(scenes.length,2);
  assert.equal(scenes[0].startSeconds,0);
  assert.equal(scenes[0].endSeconds,3);
  assert.equal(scenes[1].startSeconds,3);
  assert.equal(scenes[1].endSeconds,6);
  assert.deepEqual(scenes[0].transcriptSegmentIds,[transcript.segments[0].id]);
  assert.deepEqual(scenes[1].transcriptSegmentIds,[transcript.segments[1].id]);
});

test('Scene Timecode normalization resequences scenes and recalculates duration',()=>{
  const input=plan();
  input.scenes=[{...input.scenes[1],sequence:9},{...input.scenes[0],sequence:4}];
  const normalized=normalizeScenePlan(input);
  assert.deepEqual(normalized.scenes.map(scene=>scene.sequence),[1,2]);
  assert.deepEqual(normalized.scenes.map(scene=>scene.durationSeconds),[3,3]);
});

test('Scene Timecode detects overlap and timeline gaps',()=>{
  const overlap=plan();
  overlap.scenes[1]={...overlap.scenes[1],startSeconds:2.5};
  assert.ok(scenePlanStructuralIssues(normalizeScenePlan(overlap),transcript).includes('scene-overlap'));

  const gap=plan();
  gap.scenes[1]={...gap.scenes[1],startSeconds:3.5};
  assert.ok(scenePlanStructuralIssues(normalizeScenePlan(gap),transcript).includes('scene-gap'));
});

test('Scene Timecode blocks stale transcript versions and missing segment coverage',()=>{
  const input=plan();
  input.transcriptVersion=2;
  input.scenes[1]={...input.scenes[1],transcriptSegmentIds:[]};
  const issues=scenePlanStructuralIssues(input,transcript);
  assert.ok(issues.includes('stale-transcript-version'));
  assert.ok(issues.includes('missing-transcript-segment'));
});

test('Scene Timecode reports Production DNA duration exceptions separately',()=>{
  const input=plan();
  input.scenes[0]={...input.scenes[0],endSeconds:5,durationSeconds:5};
  input.scenes[1]={...input.scenes[1],startSeconds:5,endSeconds:6,durationSeconds:1};
  const warnings=sceneDurationWarnings(input,dna);
  assert.ok(warnings.includes('scene-1-above-max-duration'));
  assert.ok(warnings.includes('scene-2-below-min-duration'));
});

test('Duration warnings require explicit operator acceptance before approval',()=>{
  const input=plan();
  input.scenes[0]={...input.scenes[0],endSeconds:5,durationSeconds:5};
  input.scenes[1]={...input.scenes[1],startSeconds:5,endSeconds:6,durationSeconds:1};
  assert.ok(scenePlanApprovalIssues(input,transcript,dna).includes('duration-warnings-not-accepted'));
  input.review.durationWarningsAccepted=true;
  assert.equal(scenePlanApprovalIssues(input,transcript,dna).includes('duration-warnings-not-accepted'),false);
});

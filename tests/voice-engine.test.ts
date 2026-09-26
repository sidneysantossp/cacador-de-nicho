import test from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodeScript, VoiceAsset } from '../src/lib/types';
import {
  voiceAssetIsStale, voiceDownstreamStages, voiceGenerationIssues,
  voiceModelCharacterLimits, voicePipelineIssues
} from '../src/lib/voice-policy';

test('Voice Engine exposes conservative ElevenLabs character limits',()=>{
  assert.equal(voiceModelCharacterLimits.eleven_flash_v2_5,40000);
  assert.equal(voiceModelCharacterLimits.eleven_multilingual_v2,10000);
});

test('Voice Engine blocks unsupported, empty and oversized generations',()=>{
  assert.deepEqual(voiceGenerationIssues(12000,'eleven_multilingual_v2'),['text-too-long']);
  assert.deepEqual(voiceGenerationIssues(12000,'eleven_flash_v2_5'),[]);
  assert.deepEqual(voiceGenerationIssues(0,'eleven_flash_v2_5'),['empty-script']);
  assert.deepEqual(voiceGenerationIssues(100,'unknown-model'),['unsupported-model']);
});

test('Voice Engine marks an audio take stale when script version changes',()=>{
  const asset={scriptVersion:2,textHash:'hash-a'} as Pick<VoiceAsset,'scriptVersion'|'textHash'>;
  const script={version:3} as Pick<EpisodeScript,'version'>;
  assert.equal(voiceAssetIsStale(asset,script,'hash-a'),true);
});

test('Voice Engine marks an audio take stale when script text changes',()=>{
  const asset={scriptVersion:2,textHash:'hash-a'} as Pick<VoiceAsset,'scriptVersion'|'textHash'>;
  const script={version:2} as Pick<EpisodeScript,'version'>;
  assert.equal(voiceAssetIsStale(asset,script,'hash-b'),true);
  assert.equal(voiceAssetIsStale(asset,script,'hash-a'),false);
});


test('Audio-first gate rejects an inactive take even when the audio is ready',()=>{
  assert.deepEqual(voicePipelineIssues({ready:true,selected:false,stale:false}),['voice-not-selected']);
  assert.deepEqual(voicePipelineIssues({ready:true,selected:true,stale:false}),[]);
});

test('Changing the active take invalidates every downstream production stage',()=>{
  assert.deepEqual([...voiceDownstreamStages],[
    'transcript','scenes','visual-prompts','visual-assets','timeline',
    'video-edit','render','quality','packaging','publish'
  ]);
});

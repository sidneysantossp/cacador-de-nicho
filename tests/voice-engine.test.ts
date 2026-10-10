import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EpisodeScript, VoiceAlignment, VoiceAsset } from '../src/lib/types';
import {
  estimatedVoiceChunkCount, maxLongFormVoiceCharacters, mergeVoiceAlignments, splitVoiceText,
  voiceAssetIsStale, voiceDownstreamStages, voiceGenerationIssues,
  voiceModelCharacterLimits, voicePipelineIssues
} from '../src/lib/voice-policy';

test('Voice Engine exposes conservative ElevenLabs character limits',()=>{
  assert.equal(voiceModelCharacterLimits.eleven_flash_v2_5,40000);
  assert.equal(voiceModelCharacterLimits.eleven_multilingual_v2,10000);
});

test('Voice Engine accepts model-overflow text through long-form chunking but keeps a bounded take limit',()=>{
  assert.deepEqual(voiceGenerationIssues(12000,'eleven_multilingual_v2'),[]);
  assert.deepEqual(voiceGenerationIssues(75000,'eleven_flash_v2_5'),[]);
  assert.deepEqual(voiceGenerationIssues(maxLongFormVoiceCharacters+1,'eleven_flash_v2_5'),['text-too-long']);
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


test('Voice Engine splits a 60-minute-sized script below provider request limits without losing token order',()=>{
  const sentence='Great cities never stand still because people keep rewriting how they live, move, work, and build. ';
  const text=sentence.repeat(850).trim();
  assert.ok(text.length>70000);
  const chunks=splitVoiceText(text,'eleven_flash_v2_5');
  assert.ok(chunks.length>=4);
  assert.ok(chunks.every(chunk=>chunk.text.length<=voiceModelCharacterLimits.eleven_flash_v2_5));
  assert.ok(chunks.every(chunk=>chunk.previousText.length<=100&&chunk.nextText.length<=100));
  const originalTokens=text.match(/[\p{L}\p{N}']+/gu)??[];
  const chunkTokens=chunks.flatMap(chunk=>chunk.text.match(/[\p{L}\p{N}']+/gu)??[]);
  assert.deepEqual(chunkTokens,originalTokens);
});

test('Voice Engine keeps multilingual chunks below the smaller request limit',()=>{
  const text=('A carefully paced documentary sentence with useful context. ').repeat(700).trim();
  const chunks=splitVoiceText(text,'eleven_multilingual_v2');
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.text.length<=voiceModelCharacterLimits.eleven_multilingual_v2));
});

test('Voice Engine merges chunk alignments with cumulative offsets and an explicit boundary space',()=>{
  const first:VoiceAlignment={
    characters:['H','i'],
    characterStartTimesSeconds:[0,.1],
    characterEndTimesSeconds:[.1,.2]
  };
  const second:VoiceAlignment={
    characters:['T','h','e','r','e'],
    characterStartTimesSeconds:[0,.1,.2,.3,.4],
    characterEndTimesSeconds:[.1,.2,.3,.4,.5]
  };
  const merged=mergeVoiceAlignments([
    {alignment:first,offsetSeconds:0},
    {alignment:second,offsetSeconds:1.25}
  ]);
  assert.ok(merged);
  assert.equal(merged.characters.join(''),'Hi There');
  assert.equal(merged.characterStartTimesSeconds[3],1.25);
  assert.equal(merged.characterEndTimesSeconds.at(-1),1.75);
});


test('Voice UI can estimate chunk count from lightweight script character count',()=>{
  assert.equal(estimatedVoiceChunkCount(0,'eleven_flash_v2_5'),0);
  assert.equal(estimatedVoiceChunkCount(1000,'eleven_flash_v2_5'),1);
  assert.ok(estimatedVoiceChunkCount(75000,'eleven_flash_v2_5')>=4);
  assert.ok(
    estimatedVoiceChunkCount(12000,'eleven_multilingual_v2')>
    estimatedVoiceChunkCount(12000,'eleven_flash_v2_5')
  );
});


test('Voice Engine distinguishes ElevenLabs TTS permission and invalid-key failures',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  assert.match(source,/missing_permissions/);
  assert.match(source,/invalid_api_key/);
  assert.match(source,/ainda não possui permissão Text to Speech/);
  assert.match(source,/invalidada, revogada ou expirou/);
});

test('Voice Engine surfaces only sanitized ElevenLabs 401 detail',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  assert.match(source,/safeStatus/);
  assert.match(source,/safeMessage/);
  assert.match(source,/recusou a autenticação do Text to Speech/);
  assert.match(source,/slice\(0,220\)/);
});


test('Voice Engine can validate an exact ElevenLabs voice id without generating audio',()=>{
  const route=readFileSync(resolve(process.cwd(),'src/app/api/voice-engine/route.ts'),'utf8');
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  assert.match(route,/getVoiceProviderVoice/);
  assert.match(route,/searchParams\.get\('voiceId'\)/);
  assert.match(route,/searchParams\.get\('provider'\)/);
  assert.match(server,/\/v1\/voices\/'\+encodeURIComponent\(id\)/);
  assert.match(server,/não está disponível para a credencial atual/);
});

test('Voice Engine can discover and restore a shared ElevenLabs voice',()=>{
  const route=readFileSync(resolve(process.cwd(),'src/app/api/voice-engine/route.ts'),'utf8');
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  assert.match(route,/discoverVoiceId/);
  assert.match(route,/addSharedVoice/);
  assert.match(server,/\/v1\/shared-voices\?/);
  assert.match(server,/search:id/);
  assert.match(server,/public_owner_id/);
  assert.match(server,/\/v1\/voices\/add\//);
});

test('Voice Engine can search ElevenLabs voices by name',()=>{
  const route=readFileSync(resolve(process.cwd(),'src/app/api/voice-engine/route.ts'),'utf8');
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  assert.match(route,/searchParams\.get\('search'\)/);
  assert.match(server,/params\.set\('search',search\.trim\(\)\)/);
});


test('Voice Engine can generate through an external ElevenLabs-compatible API without changing the take pipeline',()=>{
  const route=readFileSync(resolve(process.cwd(),'src/app/api/voice-engine/route.ts'),'utf8');
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  const adapter=readFileSync(resolve(process.cwd(),'src/lib/server/compatible-voice-api.ts'),'utf8');
  assert.match(route,/provider:z\.enum\(\['elevenlabs','voiceapi'\]\)/);
  assert.match(route,/generateVoiceWithProvider/);
  assert.match(server,/VoiceGenerationProvider='elevenlabs'\|'voiceapi'/);
  assert.match(server,/generateVoiceProviderChunk/);
  assert.match(server,/application\/octet-stream/);
  assert.match(server,/audio_base64/);
  assert.match(server,/reserveAsset\(script,'generated',provider/);
  assert.match(adapter,/\/v2\/voices/);
  assert.match(adapter,/\/v1\/voices/);
});

test('Episode Automation prefers the external voice provider when configured unless Production DNA explicitly asks for ElevenLabs',()=>{
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/voice-engine.ts'),'utf8');
  const automation=readFileSync(resolve(process.cwd(),'src/lib/server/episode-automation.ts'),'utf8');
  assert.match(server,/generatePreferredVoice/);
  assert.match(server,/providerAvailable\('voiceapi'\)/);
  assert.match(server,/includes\('elevenlabs'\)/);
  assert.match(automation,/generatePreferredVoice/);
});

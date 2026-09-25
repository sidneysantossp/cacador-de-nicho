import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaLibraryItem } from '../src/lib/types';
import {
  mediaLibrarySearch, normalizeMediaSemantic, normalizeMediaTags, sceneLibraryItemIsStale,
  voiceLibraryItemIsStale
} from '../src/lib/media-library-policy';

function item(overrides:Partial<MediaLibraryItem>={}):MediaLibraryItem{
  return {
    mediaKey:'scene_asset:11111111-1111-4111-8111-111111111111',
    resourceType:'scene_asset',
    resourceId:'11111111-1111-4111-8111-111111111111',
    channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
    episodeId:'22222222-2222-4222-8222-222222222222',
    mediaKind:'image',
    sourceType:'generated',
    provider:'googleai',
    title:'Grug saved rocks',
    mimeType:'image/png',
    bytes:1024,
    width:1920,
    height:1080,
    durationSeconds:null,
    storagePath:'channels/test/grug.png',
    signedUrl:null,
    selected:true,
    stale:false,
    favorite:false,
    tags:['grug','rocks'],
    notes:'Good establishing shot',
    semantic:{subjects:['grug'],locations:['cave'],periods:[],shotTypes:['establishing'],moods:['curious']},
    createdAt:'2026-09-23T20:00:00.000Z',
    updatedAt:'2026-09-23T20:00:00.000Z',
    ...overrides
  };
}

test('Media Library normalizes tags case-insensitively and removes duplicates',()=>{
  assert.deepEqual(
    normalizeMediaTags([' Grug ','GRUG',' finance ','','Finance']),
    ['grug','finance']
  );
});

test('Media Library detects stale voice assets from script version or text hash',()=>{
  assert.equal(voiceLibraryItemIsStale({
    assetScriptVersion:2,assetTextHash:'a',currentScriptVersion:2,currentTextHash:'a'
  }),false);
  assert.equal(voiceLibraryItemIsStale({
    assetScriptVersion:2,assetTextHash:'a',currentScriptVersion:3,currentTextHash:'a'
  }),true);
  assert.equal(voiceLibraryItemIsStale({
    assetScriptVersion:2,assetTextHash:'a',currentScriptVersion:2,currentTextHash:'b'
  }),true);
});

test('Media Library detects stale scene assets from prompt set changes',()=>{
  assert.equal(sceneLibraryItemIsStale({
    assetPromptSetVersion:3,assetPrompt:'same',currentPromptSetVersion:3,currentPrompt:'same'
  }),false);
  assert.equal(sceneLibraryItemIsStale({
    assetPromptSetVersion:3,assetPrompt:'same',currentPromptSetVersion:4,currentPrompt:'same'
  }),true);
  assert.equal(sceneLibraryItemIsStale({
    assetPromptSetVersion:3,assetPrompt:'same',currentPromptSetVersion:3,currentPrompt:null
  }),true);
});

test('Media Library search filters kind source favorites stale and searchable metadata',()=>{
  const items=[
    item(),
    item({
      mediaKey:'voice_asset:33333333-3333-4333-8333-333333333333',
      resourceType:'voice_asset',
      resourceId:'33333333-3333-4333-8333-333333333333',
      mediaKind:'audio',
      sourceType:'uploaded',
      provider:'external',
      title:'Final narration',
      mimeType:'audio/mpeg',
      width:null,height:null,durationSeconds:120,
      favorite:true,
      stale:true,
      tags:['voice','final'],
      notes:'ElevenLabs external export'
    })
  ];
  assert.equal(mediaLibrarySearch(items,{kind:'audio'}).length,1);
  assert.equal(mediaLibrarySearch(items,{source:'generated'}).length,1);
  assert.equal(mediaLibrarySearch(items,{favoritesOnly:true}).length,1);
  assert.equal(mediaLibrarySearch(items,{staleOnly:true}).length,1);
  assert.equal(mediaLibrarySearch(items,{query:'elevenlabs'}).length,1);
  assert.equal(mediaLibrarySearch(items,{query:'rocks'}).length,1);
});


test('Media Library normalizes structured semantic metadata',()=>{
  assert.deepEqual(normalizeMediaSemantic({
    subjects:[' New York ','new york','Times Square'],
    locations:[' Manhattan ','manhattan'],
    periods:[' 1940s '],
    shotTypes:[' Aerial '],
    moods:[' Nostalgic ']
  }),{
    subjects:['new york','times square'],
    locations:['manhattan'],
    periods:['1940s'],
    shotTypes:['aerial'],
    moods:['nostalgic']
  });
});

test('Media Library search includes semantic vault metadata and channel name',()=>{
  const candidate=item({
    channelName:'Then And Now',
    semantic:{
      subjects:['times square'],
      locations:['new york'],
      periods:['1947'],
      shotTypes:['street-level'],
      moods:['nostalgia']
    }
  });
  assert.equal(mediaLibrarySearch([candidate],{query:'times square'}).length,1);
  assert.equal(mediaLibrarySearch([candidate],{query:'1947'}).length,1);
  assert.equal(mediaLibrarySearch([candidate],{query:'then and now'}).length,1);
});

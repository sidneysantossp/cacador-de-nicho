import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneAsset, VisualScenePrompt } from '../src/lib/types';
import {
  assetIsStale, assetKindForMime, generationLabel, googleImageModels, googleVideoModels,
  ownedSceneAssetTrim, sceneAssetOwnsStorage, validVideoGeneration
} from '../src/lib/asset-factory-policy';

test('Asset Factory exposes supported Google image and video model families',()=>{
  assert.ok(googleImageModels.includes('gemini-3.1-flash-image'));
  assert.ok(googleVideoModels.includes('veo-3.1-generate-preview'));
});

test('Asset Factory classifies supported upload MIME types',()=>{
  assert.equal(assetKindForMime('image/png'),'image');
  assert.equal(assetKindForMime('image/webp'),'image');
  assert.equal(assetKindForMime('video/mp4'),'video');
  assert.equal(assetKindForMime('application/pdf'),null);
});

test('Veo generation policy enforces resolution and duration constraints',()=>{
  assert.equal(validVideoGeneration('veo-3.1-generate-preview','720p',4),true);
  assert.equal(validVideoGeneration('veo-3.1-generate-preview','1080p',8),true);
  assert.equal(validVideoGeneration('veo-3.1-generate-preview','1080p',6),false);
  assert.equal(validVideoGeneration('veo-3.1-lite-generate-preview','4k',8),false);
  assert.equal(validVideoGeneration('unknown','720p',4),false);
});

test('Asset becomes stale when prompt set version changes',()=>{
  const asset={promptSetVersion:2,prompt:'same'} as Pick<SceneAsset,'promptSetVersion'|'prompt'>;
  const prompt={prompt:'same'} as Pick<VisualScenePrompt,'prompt'>;
  assert.equal(assetIsStale(asset,3,prompt),true);
});

test('Asset becomes stale when approved prompt changes without version equality',()=>{
  const asset={promptSetVersion:2,prompt:'old prompt'} as Pick<SceneAsset,'promptSetVersion'|'prompt'>;
  assert.equal(assetIsStale(asset,2,{prompt:'new prompt'}),true);
  assert.equal(assetIsStale(asset,2,{prompt:'old prompt'}),false);
});


test('OWNED scene links preserve validated trim and do not own master storage',()=>{
  const asset={
    sourceType:'owned',
    owned:{
      assetId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      segmentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourceStartSeconds:13,
      sourceEndSeconds:18
    }
  } as Pick<SceneAsset,'sourceType'|'owned'>;
  assert.deepEqual(ownedSceneAssetTrim(asset),{sourceStartSeconds:13,sourceEndSeconds:18});
  assert.equal(sceneAssetOwnsStorage(asset),false);
});

test('OWNED scene links reject malformed trims',()=>{
  const asset={
    sourceType:'owned',
    owned:{
      assetId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceStartSeconds:18,
      sourceEndSeconds:13
    }
  } as Pick<SceneAsset,'sourceType'|'owned'>;
  assert.equal(ownedSceneAssetTrim(asset),null);
});

test('Asset Factory labels OWNED library references distinctly',()=>{
  assert.equal(generationLabel({
    sourceType:'owned',
    provider:'owned-library'
  } as Pick<SceneAsset,'sourceType'|'provider'|'modelId'>),'OWNED Media Library');
});

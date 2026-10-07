import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SceneAsset, VisualScenePrompt } from '../src/lib/types';
import {
  assetIsStale, assetKindForMime, generationLabel, googleImageModels, googleVideoModels,
  ownedReferenceAssetId, ownedReferenceAssetIds, ownedSceneAssetTrim, sceneAssetOwnsStorage,
  validVideoGeneration, verifiedStockSceneAssetTrim
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


test('Verified stock trim remains deterministic for Timeline',()=>{
  const asset={
    sourceType:'stock',
    verifiedStock:{
      query:'Fremont Street Las Vegas',
      provider:'pexels',
      providerAssetId:'26856655',
      searchRelevance:.85,
      visualRelevance:.72,
      combinedScore:.79,
      sourceStartSeconds:4.25,
      sourceEndSeconds:10.25,
      verifiedAt:'2026-09-25T20:00:00.000Z'
    }
  } as Pick<SceneAsset,'sourceType'|'verifiedStock'>;
  assert.deepEqual(
    verifiedStockSceneAssetTrim(asset),
    {sourceStartSeconds:4.25,sourceEndSeconds:10.25}
  );
});

test('Unverified stock has no deterministic trim override',()=>{
  assert.equal(verifiedStockSceneAssetTrim({
    sourceType:'stock',
    verifiedStock:undefined
  } as Pick<SceneAsset,'sourceType'|'verifiedStock'>),null);
});

test('Character reference assets use explicit owned UUIDs only',()=>{
  assert.equal(
    ownedReferenceAssetId('owned:aa53d486-886f-47a2-be39-91496392a2a9'),
    'aa53d486-886f-47a2-be39-91496392a2a9'
  );
  assert.equal(ownedReferenceAssetId('file_00000000149481fa9409f65c53559a79'),null);
  assert.deepEqual(ownedReferenceAssetIds([
    'owned:aa53d486-886f-47a2-be39-91496392a2a9',
    'owned:aa53d486-886f-47a2-be39-91496392a2a9'
  ]),['aa53d486-886f-47a2-be39-91496392a2a9']);
});


test('Verified stock worker ignores stale selected assets from older prompt versions',()=>{
  const source=readFileSync('src/app/api/workers/verified-stock/route.ts','utf8');
  assert.match(source,/select\('id,asset_kind,source_type,provider,payload'\)/);
  assert.match(source,/loadVisualPromptSet\(String\(job\.visual_prompt_set_id\)\)/);
  assert.match(source,/assetIsStale/);
  assert.match(source,/promptSetVersion:Number\(selectedPayload\.promptSetVersion\?\?0\)/);
  assert.match(source,/prompt:String\(selectedPayload\.prompt\?\?''\)/);
  assert.match(source,/if\(selectedCurrent&&selected&&String\(selected\.asset_kind\)===\'video\'\)/);
});

test('Google generation sends real character reference images to Gemini and Veo',()=>{
  const server=readFileSync('src/lib/server/asset-factory.ts','utf8');
  assert.match(server,/providerReferenceImages/);
  assert.match(server,/type:'image',mime_type:reference\.mimeType,data:reference\.data/);
  assert.match(server,/referenceImages:references\.map/);
  assert.match(server,/inlineData:\{mimeType:reference\.mimeType,data:reference\.data\}/);
  assert.match(server,/references\.length&&durationSeconds!==8/);
  assert.match(server,/modelId==='veo-3\.1-lite-generate-preview'/);
});


test('Library First filters new OWNED matches by preferred media kind',()=>{
  const source=readFileSync('src/lib/server/asset-factory.ts','utf8');
  assert.match(source,/preferredKind\?:'video'\|'image'/);
  assert.match(source,/!input\.preferredKind\|\|match\.assetKind===input\.preferredKind/);
  assert.match(source,/!input\.preferredKind\|\|selected\.assetKind===input\.preferredKind/);
  assert.match(source,/videoFirstFallback:payload\.videoFirstFallback/);
});



test('Library First skips OWNED segments already rejected by visual QA',()=>{
  const source=readFileSync('src/lib/server/asset-factory.ts','utf8');
  assert.ok(source.includes(".eq('status','rejected')"));
  assert.ok(source.includes("rejectedOwnedSegments.has(match.assetId+':'+match.segment.id)"));
  assert.ok(source.includes("'visual-qa-rejected'"));
});


test('Visual QA cache is tied to the current editorial query',()=>{
  const preflight=readFileSync('src/lib/server/visual-asset-preflight.ts','utf8');
  assert.ok(preflight.includes("cached.query===query"));
  assert.ok(preflight.includes("reusedImageVerification(payload,query)"));
  assert.ok(preflight.includes("String(source.query??'')!==query"));
});

test('Automation revalidates selected stale assets before replacement search',()=>{
  const automation=readFileSync('src/lib/server/episode-automation.ts','utf8');
  const factory=readFileSync('src/lib/server/asset-factory.ts','utf8');
  assert.ok(automation.includes("asset.sceneId===sceneId&&asset.selected&&asset.status==='ready'"));
  assert.ok(automation.includes("refreshSceneAssetPromptContext(existingSelected.id)"));
  assert.ok(automation.includes("'visual-qa-revalidated'"));
  assert.ok(factory.includes("promptContextRevalidatedAt"));
});

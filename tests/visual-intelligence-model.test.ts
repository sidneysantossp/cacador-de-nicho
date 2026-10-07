import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Gemini vision model resolution ignores retired pinned models when availability disagrees',()=>{
  const source=readFileSync('src/lib/server/google-vision-model.ts','utf8');
  assert.match(source,/gemini-3\.5-flash-lite/);
  assert.match(source,/configured&&names\.includes\(configured\)/);
  assert.match(source,/PREFERRED_MODELS\.find\(item=>names\.includes\(item\)\)/);
  assert.match(source,/forceRefresh/);
  assert.match(source,/excludeModel/);
  assert.match(source,/item!==excluded/);
  assert.match(source,/CACHE_MS/);
});

test('Video visual intelligence retries once after an unavailable Gemini model',()=>{
  const source=readFileSync('src/lib/server/visual-intelligence.ts','utf8');
  assert.match(source,/resolveGoogleVisionModel/);
  assert.match(source,/googleVisionModelUnavailable/);
  assert.match(source,/forceRefresh:true,excludeModel:model/);
  assert.match(source,/configured-model-unavailable/);
});

test('OWNED visual intelligence shares the same Gemini model fallback',()=>{
  const source=readFileSync('src/lib/server/owned-media-intelligence.ts','utf8');
  assert.match(source,/resolveGoogleVisionModel/);
  assert.match(source,/googleVisionModelUnavailable/);
  assert.match(source,/forceRefresh:true,excludeModel:model/);
});

test('Still verification uses an OpenAI-specific model variable',()=>{
  const source=readFileSync('src/lib/server/visual-image-verification.ts','utf8');
  assert.match(source,/VISUAL_IMAGE_VERIFICATION_MODEL/);
  assert.match(source,/\^gpt-/);
  assert.match(source,/gpt-5\.6-luna/);
});

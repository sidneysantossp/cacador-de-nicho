import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('YouTube source discovery is restricted to verified Creative Commons videos',()=>{
  const source=readFileSync('src/lib/server/youtube.ts','utf8');
  assert.match(source,/searchYouTubeCreativeCommonsSources/);
  assert.match(source,/videoLicense:'creativeCommon'/);
  assert.match(source,/video\.status\?\.license==='creativeCommon'/);
  assert.match(source,/purpose[^\n]*source-media|,'source-media'/);
  assert.doesNotMatch(source,/yt-dlp|youtube-dl/);
});

test('Source Router uses YouTube CC only after normal real-media fallbacks',()=>{
  const policy=readFileSync('src/lib/source-router-policy.ts','utf8');
  const router=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(policy,/actions:\['owned','stock-video','stock-image','youtube-cc'\]/);
  assert.match(policy,/actions:\['owned','wikimedia','stock-video','stock-image','youtube-cc','generated-image'\]/);
  assert.match(router,/searchYouTubeCreativeCommonsSources/);
  assert.match(router,/status:'operator-source-required'/);
  assert.match(router,/origem direta autorizada/);
});

test('Persisted YouTube budgets are forward-compatible with new purposes',()=>{
  const source=readFileSync('src/lib/server/youtube-search-budget.ts','utf8');
  assert.match(source,/byPurpose:\{\.\.\.base\.byPurpose,\.\.\.raw\.byPurpose\}/);
  assert.match(source,/purposeLimits:\{\.\.\.base\.purposeLimits,\.\.\.raw\.purposeLimits\}/);
});

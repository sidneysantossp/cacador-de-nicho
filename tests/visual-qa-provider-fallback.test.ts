import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source=()=>readFileSync(resolve(process.cwd(),'src/lib/server/visual-image-verification.ts'),'utf8');

test('Pre-Render Visual QA keeps OpenAI primary and uses Google only on provider failure',()=>{
  const s=source();
  assert.match(s,/async function verifyVisualFramesPrimary/);
  assert.match(s,/return await verifyVisualFramesPrimary\(input\)/);
  assert.match(s,/if\(!visualQaProviderFailure\(error\)\)throw error/);
  assert.match(s,/return verifyVisualFramesWithGoogle\(input\)/);
});

test('Google fallback uses the same structured visual review contract',()=>{
  const s=source();
  assert.match(s,/imageVerificationSchema\.parse\(parsed\)/);
  assert.match(s,/responseMimeType:'application\/json'/);
  assert.match(s,/responseSchema:googleResponseSchema/);
  assert.match(s,/model:'googleai:'\+model/);
  assert.match(s,/resolveGoogleVisionModel/);
});

test('fallback is provider-failure based and cannot replace a valid reject result',()=>{
  const s=source();
  assert.match(s,/visualQaProviderFailure/);
  assert.doesNotMatch(s,/status\s*===?\s*['"]reject['"][\s\S]{0,180}verifyVisualFramesWithGoogle/);
});

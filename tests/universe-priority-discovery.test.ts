import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('priority Universe discovery falls back from video search to channel search',()=>{
  const source=readFileSync('src/lib/server/youtube.ts','utf8');
  assert.match(source,/requestKey\+'\:video-v2'/);
  assert.match(source,/type:'channel'/);
  assert.match(source,/requestKey\+'\:channel-v2'/);
  assert.match(source,/Channel discovery:/);
  assert.match(source,/MIN_LONG_FORM_SECONDS/);
});

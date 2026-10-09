import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Universe priority scope validates recurring content and language before intelligence',()=>{
  const source=readFileSync('src/lib/server/universe.ts','utf8');
  assert.match(source,/function competitorLooksEnglish/);
  assert.match(source,/asciiLetters\/letters\.length>=\.9/);
  assert.match(source,/Math\.max\(2,Math\.ceil\(titles\.length\*\.3\)\)/);
  assert.match(source,/export async function revalidatePriorityUniverseScope/);
  assert.match(source,/priorityModelId:classified\.id/);
});

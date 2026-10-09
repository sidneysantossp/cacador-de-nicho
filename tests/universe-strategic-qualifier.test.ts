import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PRIORITY_CONTENT_MODELS } from '../src/lib/priority-content-models';

test('strategic Universe catalog avoids generic adjacent-topic match terms',()=>{
  const city=PRIORITY_CONTENT_MODELS.find(model=>model.id==='city-history-evolution')!;
  const geo=PRIORITY_CONTENT_MODELS.find(model=>model.id==='geography-countries-borders')!;
  const engineering=PRIORITY_CONTENT_MODELS.find(model=>model.id==='megaprojects-engineering-future-cities')!;
  const mystery=PRIORITY_CONTENT_MODELS.find(model=>model.id==='historical-mysteries-abandoned-places')!;
  assert.ok(!city.matchTerms.includes('then and now'));
  assert.ok(!city.matchTerms.includes('evolution of'));
  assert.ok(!geo.matchTerms.includes('country'));
  assert.ok(!engineering.matchTerms.includes('built'));
  assert.ok(!engineering.matchTerms.includes('building'));
  assert.ok(!mystery.matchTerms.includes('mystery'));
});

test('strategic Universe qualification requires recurring long-form evidence in backend and UI',()=>{
  const server=readFileSync('src/lib/server/universe.ts','utf8');
  const ui=readFileSync('src/components/competitor-universe.tsx','utf8');
  assert.match(server,/longFormCount/);
  assert.match(server,/MIN_LONG_FORM_SECONDS/);
  assert.match(server,/Math\.max\(3,Math\.ceil\(uploads\.length\*\.5\)\)/);
  assert.match(ui,/longFormCount/);
  assert.match(ui,/MIN_LONG_FORM_SECONDS/);
});

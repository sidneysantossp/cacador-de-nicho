import test from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptSegment } from '../src/lib/types';
import { buildVisualBeat, buildVisualBeats, classifyVisualBeat } from '../src/lib/visual-beat-policy';

function segment(text:string,start=0,end=6):TranscriptSegment{
  return {
    id:'11111111-1111-4111-8111-111111111111',
    startSeconds:start,
    endSeconds:end,
    text,
    wordIds:[]
  };
}

test('Visual Beat classifies historical narration as archive-first',()=>{
  const result=classifyVisualBeat('In 1925 the Chesapeake and Ohio Railway reopened the Church Hill Tunnel.');
  assert.equal(result.type,'archive');
  assert.equal(result.sourcePreference,'archive-image');
});

test('Visual Beat routes records and reports to documentary source material',()=>{
  const result=classifyVisualBeat('Contemporary newspaper records listed six workers missing.');
  assert.equal(result.type,'document');
  assert.equal(result.sourcePreference,'document');
});

test('Visual Beat routes geographic narration to maps',()=>{
  const result=classifyVisualBeat('The route followed the James River to the port below Richmond.');
  assert.equal(result.type,'map');
  assert.equal(result.sourcePreference,'map');
});

test('Visual Beat extracts search candidates and explicit entities',()=>{
  const beat=buildVisualBeat({
    segment:segment('On October 2 1925, a Chesapeake railway locomotive entered Richmond with 10 flat cars.'),
    sequence:3
  });
  assert.equal(beat.sequence,3);
  assert.equal(beat.confidence,'heuristic');
  assert.ok(beat.entities.some(entity=>entity.value==='1925'&&entity.kind==='date'));
  assert.ok(beat.entities.some(entity=>entity.value==='10'&&entity.kind==='number'));
  assert.ok(beat.queries.some(query=>query.toLowerCase().includes('historical')));
});

test('Visual Beat builder preserves transcript timing order',()=>{
  const beats=buildVisualBeats([
    segment('Second beat.',5,9),
    {...segment('First beat.',0,5),id:'22222222-2222-4222-8222-222222222222'}
  ]);
  assert.deepEqual(beats.map(item=>item.sequence),[1,2]);
  assert.deepEqual(beats.map(item=>item.startSeconds),[0,5]);
});

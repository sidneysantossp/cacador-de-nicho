import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisualSegmentWindow } from '../src/lib/visual-segment-window';

const segment=(id:string,startSeconds:number,endSeconds:number)=>({
  id,startSeconds,endSeconds
});

test('Visual segment selector preserves best-first behavior when no ranges are excluded',()=>{
  const result=selectVisualSegmentWindow({
    ranked:[
      {segment:segment('best',2,10),relevance:.8,score:.9},
      {segment:segment('second',10,18),relevance:.7,score:.8}
    ],
    desiredDurationSeconds:4
  });
  assert.equal(result?.segment.id,'best');
  assert.equal(result?.sourceStartSeconds,2);
  assert.equal(result?.sourceEndSeconds,6);
});

test('Visual segment selector chooses a different microcut inside the same segment when possible',()=>{
  const result=selectVisualSegmentWindow({
    ranked:[
      {segment:segment('wide',0,12),relevance:.8,score:.9}
    ],
    desiredDurationSeconds:4,
    excludedSourceRanges:[{startSeconds:0,endSeconds:4}]
  });
  assert.equal(result?.segment.id,'wide');
  assert.equal(result?.sourceStartSeconds,8);
  assert.equal(result?.sourceEndSeconds,12);
});

test('Visual segment selector falls through to the next semantic segment when the best one overlaps',()=>{
  const result=selectVisualSegmentWindow({
    ranked:[
      {segment:segment('blocked',0,4),relevance:.9,score:.95},
      {segment:segment('alternate',5,10),relevance:.7,score:.8}
    ],
    desiredDurationSeconds:4,
    excludedSourceRanges:[{startSeconds:0,endSeconds:4}]
  });
  assert.equal(result?.segment.id,'alternate');
  assert.equal(result?.sourceStartSeconds,5);
  assert.equal(result?.sourceEndSeconds,9);
});

test('Exactly 25 percent overlap remains allowed to match source diversity policy',()=>{
  const result=selectVisualSegmentWindow({
    ranked:[
      {segment:segment('candidate',3,7),relevance:.8,score:.9}
    ],
    desiredDurationSeconds:4,
    excludedSourceRanges:[{startSeconds:0,endSeconds:4}]
  });
  assert.equal(result?.segment.id,'candidate');
  assert.equal(result?.sourceStartSeconds,3);
  assert.equal(result?.sourceEndSeconds,7);
});

test('Short semantic segments keep legacy behavior when there are no excluded ranges',()=>{
  const result=selectVisualSegmentWindow({
    ranked:[
      {segment:segment('short',0,2),relevance:.8,score:.9}
    ],
    desiredDurationSeconds:4
  });
  assert.equal(result?.sourceStartSeconds,0);
  assert.equal(result?.sourceEndSeconds,2);
});

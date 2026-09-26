import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneTimecode, VisualBeat } from '../src/lib/types';
import {
  archiveTemporalEvidence, sourceRouteForScene
} from '../src/lib/source-router-policy';

function beat(overrides:Partial<VisualBeat>={}):VisualBeat{
  return {
    id:'11111111-1111-4111-8111-111111111111',
    sequence:1,startSeconds:0,endSeconds:6,durationSeconds:6,
    narration:'In 1925 the tunnel collapsed.',
    transcriptSegmentIds:['22222222-2222-4222-8222-222222222222'],
    transcriptWordIds:[],
    type:'archive',
    sourcePreference:'archive-image',
    entities:[{kind:'date',value:'1925'}],
    queries:['Church Hill Tunnel Richmond 1925 historical photograph'],
    confidence:'heuristic',
    ...overrides
  };
}
function scene(v:VisualBeat):SceneTimecode{
  return {
    id:'33333333-3333-4333-8333-333333333333',
    sequence:1,startSeconds:0,endSeconds:6,durationSeconds:6,
    narration:v.narration,
    transcriptSegmentIds:v.transcriptSegmentIds,
    transcriptWordIds:[],
    visualIntent:'',
    shotType:'',
    characterIds:[],
    assetMode:'image',
    promptDirection:'',
    notes:'',
    visualBeats:[v]
  };
}

test('Source Router keeps archive beats on real-source routes',()=>{
  const route=sourceRouteForScene(scene(beat()));
  assert.deepEqual(route.actions,['owned','wikimedia','manual-archive']);
  assert.equal(route.syntheticAllowed,false);
  assert.match(route.query,/Church Hill Tunnel/i);
});

test('Source Router blocks synthetic fallback for documents and maps',()=>{
  const documentRoute=sourceRouteForScene(scene(beat({
    type:'document',sourcePreference:'document',
    queries:['Richmond Times Dispatch October 1925']
  })));
  const mapRoute=sourceRouteForScene(scene(beat({
    type:'map',sourcePreference:'map',
    queries:['Richmond James River railway route map']
  })));
  assert.equal(documentRoute.syntheticAllowed,false);
  assert.equal(documentRoute.actions.at(-1),'manual-document');
  assert.equal(mapRoute.syntheticAllowed,false);
  assert.equal(mapRoute.actions.at(-1),'manual-map');
});

test('Source Router prefers motion for live-action stock video beats',()=>{
  const route=sourceRouteForScene(scene(beat({
    type:'literal',sourcePreference:'stock-video',
    narration:'People walk through a busy city street.',
    queries:['people walking busy city street']
  })));
  assert.deepEqual(route.actions,['owned','stock-video','stock-image']);
  assert.equal(route.syntheticAllowed,false);
});

test('Source Router allows generation only for editorially eligible still-image beats',()=>{
  const route=sourceRouteForScene(scene(beat({
    type:'literal',sourcePreference:'stock-image',
    queries:['safe suburban homes exterior']
  })));
  assert.deepEqual(route.actions,['owned','stock-image','stock-video','generated-image']);
  assert.equal(route.syntheticAllowed,true);
});


test('Archive routes never fall back to modern stock or synthetic media',()=>{
  const route=sourceRouteForScene(scene(beat()));
  assert.equal(route.actions.includes('stock-image'),false);
  assert.equal(route.actions.includes('stock-video'),false);
  assert.equal(route.actions.includes('generated-image'),false);
  assert.equal(route.syntheticAllowed,false);
  assert.equal(route.actions.at(-1),'manual-archive');
});


test('Archive temporal provenance rejects modern photographs for a dated historical beat',()=>{
  const result=archiveTemporalEvidence({
    query:'Church Hill Tunnel Richmond 1925 historical photograph',
    sourceDate:'1981-06-01',
    title:'Church Hill Tunnel East Entrance 1981'
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'archive-date-mismatch');
  assert.deepEqual(result.expectedYears,['1925']);
  assert.deepEqual(result.observedYears,['1981']);
});

test('Archive temporal provenance accepts media explicitly dated to the requested year',()=>{
  const result=archiveTemporalEvidence({
    query:'Church Hill Tunnel Richmond 1925 historical photograph',
    sourceDate:'1925-10-02',
    title:'Church Hill Tunnel collapse'
  });
  assert.equal(result.ok,true);
  assert.equal(result.reason,null);
});

test('Archive temporal provenance rejects undated evidence when the beat requires an explicit year',()=>{
  const result=archiveTemporalEvidence({
    query:'Church Hill Tunnel Richmond 1925 historical photograph',
    sourceDate:'',
    title:'Church Hill Tunnel East Entrance'
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'archive-date-missing');
});

test('Archive temporal provenance does not require a date for undated archive queries',()=>{
  const result=archiveTemporalEvidence({
    query:'Church Hill Tunnel Richmond historical photograph',
    sourceDate:'',
    title:'Church Hill Tunnel East Entrance'
  });
  assert.equal(result.ok,true);
  assert.equal(result.required,false);
});

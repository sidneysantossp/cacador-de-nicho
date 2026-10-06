import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SceneTimecode, VisualBeat } from '../src/lib/types';
import {
  applyDocumentarySourcePolicy, archiveTemporalEvidence, sourceRouteForScene
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


test('Source Router uses enriched editorial direction when supplied',()=>{
  const route=sourceRouteForScene(
    scene(beat({queries:['Then it spent years putting that highway underground.']})),
    'Boston Big Dig Central Artery underground highway construction archival documentary'
  );
  assert.match(route.query,/Boston Big Dig Central Artery/);
  assert.doesNotMatch(route.query,/Then it spent years/);
  assert.deepEqual(route.actions,['owned','wikimedia','manual-archive']);
});


test('Documentary mode removes automatic synthetic fallback from real-source beats',()=>{
  const base=sourceRouteForScene(scene(beat({
    type:'literal',sourcePreference:'stock-image',
    queries:['Boston Big Dig elevated Central Artery documentary photograph']
  })));
  const route=applyDocumentarySourcePolicy(base,true);
  assert.equal(route.syntheticAllowed,false);
  assert.equal(route.actions.includes('generated-image'),false);
  assert.deepEqual(route.actions,['owned','stock-video','stock-image']);
});

test('Documentary mode still permits generation when the beat explicitly requests generated imagery',()=>{
  const base=sourceRouteForScene(scene(beat({
    type:'illustration',sourcePreference:'generated',
    queries:['conceptual city infrastructure layers illustration']
  })));
  const route=applyDocumentarySourcePolicy(base,true);
  assert.equal(route.syntheticAllowed,true);
  assert.deepEqual(route.actions,['owned','generated-image']);
});

test('Documentary mode keeps archive document and map routes factual rather than motion-forcing them',()=>{
  const cases=[
    {type:'archive' as const,sourcePreference:'archive-image' as const},
    {type:'document' as const,sourcePreference:'document' as const},
    {type:'map' as const,sourcePreference:'map' as const}
  ];
  for(const item of cases){
    const base=sourceRouteForScene(scene(beat({
      type:item.type,sourcePreference:item.sourcePreference
    })));
    const route=applyDocumentarySourcePolicy(base,true);
    assert.equal(route.actions[0],'owned');
    assert.equal(route.actions.includes('generated-image'),false);
    assert.equal(route.syntheticAllowed,false);
  }
});

test('Source Router requeues verified stock when the enriched visual query changes',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/existing\.query!==jobInput\.query/);
  assert.match(source,/reason:'visual-query-changed'/);
  assert.match(source,/enqueueVerifiedStockJob\(jobInput\)/);
});

test('Source Router reopens stock gaps when the query compiler changes',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/previousCompiledQuery!==currentCompiledQuery/);
  assert.match(source,/reason:'stock-query-compiler-changed'/);
  assert.match(source,/stockDiscoveryQuery\(route\.query\)/);
});
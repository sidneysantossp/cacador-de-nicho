import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SceneTimecode, VisualBeat } from '../src/lib/types';
import {
  applyDocumentarySourcePolicy, archiveTemporalEvidence, motionRouteAssetSatisfied, routePrefersMotion,
  sourceDiversityAssessment, sourceReuseDecision, sourceRouteForScene
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

test('Existing selected assets are greedily reconciled into a diverse scene set',()=>{
  const result=sourceDiversityAssessment([
    {
      sceneId:'s1',sceneSequence:1,
      payload:{stock:{providerAssetId:'p1'},verifiedStock:{provider:'pexels',sourceStartSeconds:0,sourceEndSeconds:4}}
    },
    {
      sceneId:'s2',sceneSequence:2,
      payload:{stock:{providerAssetId:'p1'},verifiedStock:{provider:'pexels',sourceStartSeconds:5,sourceEndSeconds:9}}
    },
    {
      sceneId:'s3',sceneSequence:3,
      payload:{stock:{providerAssetId:'p1'},verifiedStock:{provider:'pexels',sourceStartSeconds:10,sourceEndSeconds:14}}
    },
    {
      sceneId:'s4',sceneSequence:4,
      payload:{owned:{assetId:'o1',sourceStartSeconds:10,sourceEndSeconds:15}}
    },
    {
      sceneId:'s5',sceneSequence:5,
      payload:{owned:{assetId:'o1',sourceStartSeconds:20,sourceEndSeconds:25}}
    },
    {
      sceneId:'s6',sceneSequence:6,
      payload:{generation:{},modelId:'generated'}
    }
  ]);

  assert.deepEqual(result.acceptedSceneIds,['s1','s3','s4','s6']);
  assert.deepEqual(
    result.rejected.map(item=>[item.sceneId,item.reason]),
    [
      ['s2','adjacent-source-reuse'],
      ['s5','adjacent-source-reuse']
    ]
  );
});

test('Source reuse allows separated microcuts but blocks adjacent, overlapping, and dominant reuse',()=>{
  const separated=sourceReuseDecision({
    sourceType:'stock',
    targetSequence:20,
    observations:[
      {sceneSequence:3,sourceStartSeconds:0,sourceEndSeconds:4},
      {sceneSequence:10,sourceStartSeconds:8,sourceEndSeconds:12}
    ],
    candidateStartSeconds:20,
    candidateEndSeconds:24
  });
  assert.equal(separated.ok,true);

  const adjacent=sourceReuseDecision({
    sourceType:'stock',
    targetSequence:20,
    observations:[{sceneSequence:19,sourceStartSeconds:0,sourceEndSeconds:4}],
    candidateStartSeconds:12,
    candidateEndSeconds:16
  });
  assert.equal(adjacent.ok,false);
  assert.equal(adjacent.reason,'adjacent-source-reuse');

  const overlapping=sourceReuseDecision({
    sourceType:'owned',
    targetSequence:20,
    observations:[{sceneSequence:5,sourceStartSeconds:10,sourceEndSeconds:15}],
    candidateStartSeconds:13,
    candidateEndSeconds:17
  });
  assert.equal(overlapping.ok,false);
  assert.equal(overlapping.reason,'overlapping-source-trim');

  const stockCap=sourceReuseDecision({
    sourceType:'stock',
    targetSequence:30,
    observations:[2,8,14,22].map(sceneSequence=>({sceneSequence}))
  });
  assert.equal(stockCap.ok,false);
  assert.equal(stockCap.reason,'source-reuse-cap');

  const ownedStillAllowed=sourceReuseDecision({
    sourceType:'owned',
    targetSequence:30,
    observations:[2,5,8,11,14,17,20].map(sceneSequence=>({sceneSequence}))
  });
  assert.equal(ownedStillAllowed.ok,true);
});

test('Automatic paid image generation is gated by episode cost policy before provider call',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/AUTOMATION_VISUAL_EPISODE_BUDGET_USD/);
  assert.match(source,/AUTOMATION_GOOGLE_IMAGE_ESTIMATED_COST_USD/);
  assert.match(source,/visualGenerationBudgetDecision/);
  assert.match(source,/status:'deferred'/);
  assert.match(source,/reason:cost\.reason/);
  const decisionIndex=source.indexOf('const cost=visualGenerationBudgetDecision');
  const generateIndex=source.indexOf('const asset=await generateGoogleImage',decisionIndex);
  assert.ok(decisionIndex>=0&&generateIndex>decisionIndex,'budget decision must happen before paid generation');
  assert.match(source,/estimatedCostUsd:cost\.estimatedCostUsd/);
});

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
  assert.deepEqual(route.actions,['owned','stock-video','stock-image','youtube-cc']);
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


test('Source Router ignores stale media-class wording in visual prompts when a canonical stock-video beat exists',()=>{
  const route=sourceRouteForScene(
    scene(beat({
      type:'literal',
      sourcePreference:'stock-video',
      narration:'How should the route change when traffic or speed changes?',
      queries:[
        'How should the route change when traffic or speed changes?',
        'pedestrian pathfinding adapting route to traffic speed'
      ]
    })),
    'authentic geographic map map how should route change traffic speed changes'
  );
  assert.equal(route.preference,'stock-video');
  assert.deepEqual(route.actions,['owned','stock-video','stock-image','youtube-cc']);
  assert.equal(route.query,'pedestrian pathfinding adapting route to traffic speed');
  assert.doesNotMatch(route.query,/authentic geographic map/i);
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

test('Source selection applies diversity before reusing OWNED or stock sources',()=>{
  const assetFactory=readFileSync('src/lib/server/asset-factory.ts','utf8');
  const stock=readFileSync('src/lib/server/stock-media.ts','utf8');
  assert.match(assetFactory,/sourceReuseDecision/);
  assert.match(assetFactory,/sourceType:'owned'/);
  assert.match(assetFactory,/source-diversity-exhausted/);
  assert.match(stock,/sourceType:'stock'/);
  assert.match(stock,/stage:'source-diversity'/);
  assert.match(stock,/reuseWithTrim/);
  assert.match(stock,/sourceDiversityReason/);
});

test('Source Router can bypass an already-selected asset when diversity requires replacement',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/forceSelectedReplacement\?:boolean/);
  assert.match(source,/force:input\.forceSelectedReplacement===true/);
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
test('Source Router prioritizes Vecteezy in autonomous stock provider order',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/STOCK_IMAGE_PROVIDERS:StockMediaProvider\[\]=\['vecteezy','pexels','pixabay'\]/);
  assert.match(source,/STOCK_VIDEO_PROVIDERS:StockMediaProvider\[\]=\['vecteezy','pexels','pixabay'\]/);
  assert.match(source,/for\(const provider of STOCK_IMAGE_PROVIDERS\)/);
  assert.match(source,/providers:STOCK_VIDEO_PROVIDERS/);
});


test('documentary evidence forces real sources',()=>{
  const base=sourceRouteForScene(
    scene(beat({type:'illustration',sourcePreference:'generated'})),
    'Documentary evidence for: layered city systems visualization'
  );
  const route=applyDocumentarySourcePolicy(base,true);
  assert.equal(route.syntheticAllowed,false);
  assert.deepEqual(route.actions,['owned','stock-video','stock-image','wikimedia']);
});


test('Documentary source policy explicitly marks motion-first routes',()=>{
  const documentary=applyDocumentarySourcePolicy(
    sourceRouteForScene(
      scene(beat({type:'illustration',sourcePreference:'generated'})),
      'Documentary evidence for: city traffic reacting to police response'
    ),
    true
  );
  const imageLed=sourceRouteForScene(scene(beat({
    type:'literal',sourcePreference:'stock-image',
    queries:['house exterior still photograph']
  })));
  assert.equal(routePrefersMotion(documentary),true);
  assert.equal(routePrefersMotion(imageLed),false);
});

test('Video-first Source Router keeps selected stills behind real video attempts',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  const assetFactory=readFileSync('src/lib/server/asset-factory.ts','utf8');
  const routerStart=source.indexOf('export async function resolveSourceForScene');
  const videoAction=source.indexOf("if(action==='stock-video')",routerStart);
  const uploadFallback=source.indexOf('const reused=await revalidateExistingUploadedStill',routerStart);
  assert.ok(videoAction>routerStart);
  assert.ok(uploadFallback>videoAction);
  assert.match(source,/preferredKind:videoFirst\?'video':undefined/);
  assert.match(assetFactory,/preferredKind\?:'video'\|'image'/);
  assert.match(assetFactory,/!input\.preferredKind\|\|selected\.assetKind===input\.preferredKind/);
});


test('Video-first still fallback is accepted only after video exhaustion is recorded',()=>{
  const route=applyDocumentarySourcePolicy(
    sourceRouteForScene(scene(beat({
      type:'literal',sourcePreference:'stock-image',
      queries:['documentary urban traffic']
    }))),
    true
  );
  assert.equal(routePrefersMotion(route),true);
  assert.equal(motionRouteAssetSatisfied({route,assetKind:'video'}),false);
  assert.equal(motionRouteAssetSatisfied({
    route,
    assetKind:'video',
    payload:{
      visualQa:{
        status:'pass',
        staticGraphic:false,
        motion:{meaningfulMotion:true}
      }
    }
  }),true);
  assert.equal(motionRouteAssetSatisfied({
    route,
    assetKind:'video',
    payload:{
      visualQa:{
        status:'pass',
        staticGraphic:true,
        motion:{meaningfulMotion:true}
      }
    }
  }),false);
  assert.equal(motionRouteAssetSatisfied({route,assetKind:'image',payload:{}}),false);
  assert.equal(motionRouteAssetSatisfied({
    route,
    assetKind:'image',
    payload:{
      videoFirstFallback:{
        policyVersion:'video-first-v1',
        videoExhausted:true
      }
    }
  }),true);
  assert.equal(motionRouteAssetSatisfied({
    route,
    assetKind:'image',
    payload:{
      videoFirstFallback:{
        policyVersion:'legacy-v0',
        videoExhausted:true
      }
    }
  }),false);
});

test('Source Router reopens frozen legacy stock jobs during video-first reprocessing',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/existing\.lastError==='frozen-after-timeline-v5'/);
  assert.match(source,/reason:existing\.lastError==='frozen-after-timeline-v5'/);
  assert.match(source,/legacy-frozen-video-first-reprocess/);
  assert.match(source,/videoExhausted=true/);
  assert.match(source,/markVideoFirstFallback/);
  assert.match(source,/VIDEO_FIRST_FALLBACK_POLICY_VERSION/);
});


test('Source Router reopens completed stock gaps caused by a retired visual model',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/verifiedStockGapNeedsVisualModelRetry/);
  assert.match(source,/gemini-2\.5-flash-lite/);
  assert.match(source,/reason:'visual-model-retired'/);
  const retryIndex=source.indexOf('verifiedStockGapNeedsVisualModelRetry(existing.result)');
  const exhaustedIndex=source.indexOf('videoExhausted=true',retryIndex);
  assert.ok(retryIndex>=0&&exhaustedIndex>retryIndex);
});


test('Visual QA rejects obvious frozen or black video locally before semantic AI review',()=>{
  const preflight=readFileSync('src/lib/server/visual-asset-preflight.ts','utf8');
  assert.match(preflight,/blackdetect=d=0\.2:pix_th=0\.10,freezedetect/);
  assert.match(preflight,/local-ffmpeg-preflight/);
  assert.match(preflight,/excessive-black-frames/);
  assert.match(preflight,/local-technical-reject/);
  const localGate=preflight.indexOf('const review=localTechnicalReject(query,sampled.motion)');
  const semanticAi=preflight.indexOf('verification=await verifyVisualFramesWithOpenAI({',localGate);
  assert.ok(localGate>=0&&semanticAi>localGate,'local video gate must run before semantic AI review');
});

test('Scene asset selection is guarded by Pre-Render Visual QA',()=>{
  const assetFactory=readFileSync('src/lib/server/asset-factory.ts','utf8');
  const preflight=readFileSync('src/lib/server/visual-asset-preflight.ts','utf8');
  assert.match(assetFactory,/await assertSceneAssetVisualQa\(assetId\)/);
  assert.match(assetFactory,/ensureSceneAssetVisualQa\(assetId\)/);
  assert.match(preflight,/static-graphic-disguised-as-video/);
  assert.match(preflight,/template-animation-not-motion/);
});

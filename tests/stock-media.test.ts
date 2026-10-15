import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deterministicStockFallbackTrim, rankStockMediaResults, STOCK_DISCOVERY_POLICY_VERSION,
  stockCandidateAccepted, stockDiscoveryQueries, stockDiscoveryQuery, stockDownloadHostAllowed,
  stockFallbackEligible, stockVisualAnalysisFallbackAllowed, stockVisualConstraintsSatisfied,
  stockVisualValidationQuery, validStockQuery, verifiedStockGapNeedsTransientRecovery,
  verifiedStockGapNeedsVisualModelRecovery, verifiedStockGapRecoverable,
  verifiedStockSearchRelevance
} from '../src/lib/stock-media-policy';

test('Stock Media allows only expected Pexels media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('pexels','images.pexels.com'),true);
  assert.equal(stockDownloadHostAllowed('pexels','videos.pexels.com'),true);
  assert.equal(stockDownloadHostAllowed('pexels','vod-progressive.akamaized.net'),true);
  assert.equal(stockDownloadHostAllowed('pexels','evil.example.com'),false);
  assert.equal(stockDownloadHostAllowed('pexels','images.pexels.com.evil.example.com'),false);
});

test('Stock Media allows only expected Pixabay media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('pixabay','cdn.pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','sub.pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','pixabay.com.attacker.test'),false);
});


test('Stock Media allows only expected Unsplash image hosts',()=>{
  assert.equal(stockDownloadHostAllowed('unsplash','images.unsplash.com'),true);
  assert.equal(stockDownloadHostAllowed('unsplash','plus.unsplash.com'),true);
  assert.equal(stockDownloadHostAllowed('unsplash','images.unsplash.com.attacker.test'),false);
});

test('Stock Media allows only Wikimedia Commons media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('wikimedia','upload.wikimedia.org'),true);
  assert.equal(stockDownloadHostAllowed('wikimedia','commons.wikimedia.org'),true);
  assert.equal(stockDownloadHostAllowed('wikimedia','upload.wikimedia.org.attacker.test'),false);
});

test('Stock Media rejects non-HTTPS at download layer via host policy caller and invalid search lengths',()=>{
  assert.equal(validStockQuery('prehistoric cave'),true);
  assert.equal(validStockQuery('   '),false);
  assert.equal(validStockQuery('x'.repeat(101)),false);
});


test('Stock Media allows only expected Vecteezy media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('vecteezy','downloads.vecteezy.com'),true);
  assert.equal(stockDownloadHostAllowed('vecteezy','static.vecteezy.com'),true);
  assert.equal(stockDownloadHostAllowed('vecteezy','files.vecteezy.com'),true);
  assert.equal(stockDownloadHostAllowed('vecteezy','downloads.vecteezy.com.attacker.test'),false);
});


test('Stock fallback only runs for real-world media instructions',()=>{
  assert.equal(stockFallbackEligible('present-day Las Vegas documentary stock footage'),true);
  assert.equal(stockFallbackEligible('realistic current-location city footage'),true);
  assert.equal(stockFallbackEligible('minimal hand-drawn 2D editorial caveman on off-white paper'),false);
  assert.equal(stockFallbackEligible('3D animation of a robot laboratory'),false);
});

test('Stock fallback ranks exact provider metadata above loose location matches',()=>{
  const ranked=rankStockMediaResults({
    query:'fremont street las vegas',
    desiredDurationSeconds:6,
    orientation:'landscape',
    results:[
      {
        provider:'pexels',
        providerAssetId:'1',
        kind:'video',
        title:'Pexels video 1',
        previewUrl:'https://images.pexels.com/a.jpg',
        pageUrl:'https://www.pexels.com/video/fremont-street-las-vegas-1/',
        creatorName:'A',
        width:1920,height:1080,durationSeconds:13,
        licenseLabel:'Pexels License',attributionLabel:'A'
      },
      {
        provider:'pexels',
        providerAssetId:'2',
        kind:'video',
        title:'Pexels video 2',
        previewUrl:'https://images.pexels.com/b.jpg',
        pageUrl:'https://www.pexels.com/video/las-vegas-flag-2/',
        creatorName:'B',
        width:1920,height:1080,durationSeconds:13,
        licenseLabel:'Pexels License',attributionLabel:'B'
      }
    ]
  });
  assert.equal(ranked[0].result.providerAssetId,'1');
  assert.ok(ranked[0].relevance>ranked[1].relevance);
});

test('Stock fallback rejects portrait candidates for a landscape production',()=>{
  const ranked=rankStockMediaResults({
    query:'New York skyline',
    desiredDurationSeconds:6,
    orientation:'landscape',
    results:[{
      provider:'pexels',
      providerAssetId:'1',
      kind:'video',
      title:'New York skyline',
      previewUrl:'https://images.pexels.com/a.jpg',
      pageUrl:'https://www.pexels.com/video/new-york-skyline-1/',
      creatorName:'A',
      width:1080,height:1920,durationSeconds:10,
      licenseLabel:'Pexels License',attributionLabel:'A'
    }]
  });
  assert.equal(ranked.length,0);
});

test('Verified-stock gaps from retired visual models remain recoverable',()=>{
  const retired={
    status:'gap',
    discoveryPolicyVersion:'filmable-v2',
    attempts:[
      {
        stage:'candidate',
        error:'A Google AI falhou durante a análise visual (HTTP 404): This model models/gemini-2.5-flash-lite is no longer available to new users. status NOT_FOUND'
      }
    ]
  };
  assert.equal(verifiedStockGapNeedsVisualModelRecovery(retired),true);
  assert.equal(verifiedStockGapRecoverable(retired),true);

  const genuine={
    status:'gap',
    discoveryPolicyVersion:'filmable-v2',
    attempts:[
      {stage:'visual-verification',accepted:false,visualRelevance:.08}
    ]
  };
  assert.equal(verifiedStockGapNeedsVisualModelRecovery(genuine),false);
  assert.equal(verifiedStockGapRecoverable(genuine),false);
});

test('Legacy verified-stock gaps caused by transient providers are reopened once',()=>{
  const legacy={
    status:'gap',
    attempts:[
      {stage:'candidate',error:'A Google AI atingiu quota ou limite durante a análise visual.'}
    ]
  };
  assert.equal(verifiedStockGapNeedsTransientRecovery(legacy),true);

  const migrated={
    status:'gap',
    attempts:[
      {stage:'visual-index-fallback',reason:'quota exceeded'},
      {stage:'candidate',error:'A OpenAI atingiu o limite de uso durante a validação visual.'}
    ]
  };
  assert.equal(verifiedStockGapNeedsTransientRecovery(migrated),false);

  const genuineGap={
    status:'gap',
    attempts:[
      {stage:'visual-verification',accepted:false,visualRelevance:.07}
    ]
  };
  assert.equal(verifiedStockGapNeedsTransientRecovery(genuineGap),false);
});

test('Stock visual indexing falls back only for transient provider failures',()=>{
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:429,message:'quota exceeded'
  }),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:504,message:'timed out'
  }),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:502,message:'temporarily unavailable'
  }),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:404,
    message:'This model models/gemini-2.5-flash-lite is no longer available to new users. status NOT_FOUND'
  }),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:404,message:'stock asset not found'
  }),false);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:422,message:'invalid asset'
  }),false);
  assert.equal(stockVisualAnalysisFallbackAllowed({
    status:403,message:'credential rejected'
  }),false);
});

test('Stock fallback trim is deterministic, bounded, and varies by seed',()=>{
  const first=deterministicStockFallbackTrim({
    durationSeconds:20,
    desiredDurationSeconds:4.7,
    seed:84
  });
  const repeat=deterministicStockFallbackTrim({
    durationSeconds:20,
    desiredDurationSeconds:4.7,
    seed:84
  });
  const other=deterministicStockFallbackTrim({
    durationSeconds:20,
    desiredDurationSeconds:4.7,
    seed:85
  });
  assert.deepEqual(first,repeat);
  assert.ok(first);
  assert.ok(other);
  assert.notDeepEqual(first,other);
  assert.ok(first.sourceStartSeconds>=0);
  assert.ok(first.sourceEndSeconds<=20);
  assert.ok(first.sourceEndSeconds-first.sourceStartSeconds>=4.69);
  assert.equal(deterministicStockFallbackTrim({
    durationSeconds:null,
    desiredDurationSeconds:5,
    seed:1
  }),null);
});

test('Stock fallback requires both provider relevance and visual verification',()=>{
  assert.equal(stockCandidateAccepted({
    searchScore:.85,visualRelevance:.45,combinedScore:.67
  }),true);
  assert.equal(stockCandidateAccepted({
    searchScore:.20,visualRelevance:.70,combinedScore:.43
  }),false);
  assert.equal(stockCandidateAccepted({
    searchScore:.85,visualRelevance:.10,combinedScore:.51
  }),false);
});


test('Stock visual indexing falls back only for transient provider failures',()=>{
  assert.equal(stockVisualAnalysisFallbackAllowed({status:429,message:'quota exceeded'}),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({status:503,message:'temporarily unavailable'}),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({status:504,message:'timeout'}),true);
  assert.equal(stockVisualAnalysisFallbackAllowed({status:422,message:'invalid media'}),false);
  assert.equal(stockVisualAnalysisFallbackAllowed({status:403,message:'permission denied'}),false);
});

test('Stock fallback trim is deterministic, bounded, and varies with scene seed',()=>{
  const a=deterministicStockFallbackTrim({
    durationSeconds:30,
    desiredDurationSeconds:4,
    seed:10
  });
  const b=deterministicStockFallbackTrim({
    durationSeconds:30,
    desiredDurationSeconds:4,
    seed:11
  });
  assert.ok(a);
  assert.ok(b);
  assert.equal(Number((a!.sourceEndSeconds-a!.sourceStartSeconds).toFixed(3)),4);
  assert.equal(Number((b!.sourceEndSeconds-b!.sourceStartSeconds).toFixed(3)),4);
  assert.notEqual(a!.sourceStartSeconds,b!.sourceStartSeconds);
  assert.ok(a!.sourceStartSeconds>=0&&a!.sourceEndSeconds<=30);
  assert.equal(deterministicStockFallbackTrim({
    durationSeconds:null,
    desiredDurationSeconds:4,
    seed:1
  }),null);
});

test('Stock discovery v2 expands abstract routing concepts into filmable search variants',()=>{
  const queries=stockDiscoveryQueries(
    'pedestrian pathfinding adapting route to traffic speed'
  );
  assert.equal(STOCK_DISCOVERY_POLICY_VERSION,'filmable-v2');
  assert.equal(queries[0],'pedestrian pathfinding adapting route to traffic speed');
  assert.ok(queries.includes('pedestrians crossing busy city intersection'));
  assert.ok(queries.includes('people walking city crosswalk traffic'));
  assert.ok(queries.includes('crowd navigating urban sidewalk'));
  assert.ok(queries.includes('busy city intersection traffic pedestrians'));
});

test('Stock discovery strips production-only words but preserves semantic location',()=>{
  assert.equal(
    stockDiscoveryQuery('Present-day Fremont Street / Las Vegas establishing shot. Real current-location stock only.'),
    'fremont street las vegas'
  );
});


test('Stock discovery prioritizes exact landmark geography',()=>{
  assert.equal(
    stockDiscoveryQuery('Bryant Park Midtown Manhattan urban park skyscrapers people'),
    'bryant park new york city'
  );
});

test('Stock discovery prioritizes exact district geography',()=>{
  assert.equal(
    stockDiscoveryQuery('Present-day Fremont Street / Las Vegas establishing shot. Real current-location stock only.'),
    'fremont street las vegas'
  );
});


test('Exact landmark stock search keeps top provider results eligible for visual verification',()=>{
  const ranked=rankStockMediaResults({
    query:'bryant park new york city',
    desiredDurationSeconds:7,
    orientation:'landscape',
    results:[{
      provider:'pexels',
      providerAssetId:'5834294',
      kind:'video',
      title:'Panning shot of an elderly man using mobile while sitting on a bench',
      previewUrl:'https://images.pexels.com/example.jpg',
      pageUrl:'https://www.pexels.com/video/panning-shot-of-an-elderly-man-using-mobile-while-sitting-on-the-bench-at-the-park-5834294/',
      creatorName:'Pexels contributor',
      width:3840,height:2160,durationSeconds:12,
      licenseLabel:'Pexels License',attributionLabel:'Pexels contributor'
    }]
  });
  assert.equal(ranked.length,1);
  assert.ok(ranked[0].metadataRelevance<.45);
  assert.ok(ranked[0].relevance>=.45);
});

test('Generic stock search does not receive exact-location provider-rank boost',()=>{
  const ranked=rankStockMediaResults({
    query:'people walking busy city streets',
    desiredDurationSeconds:7,
    orientation:'landscape',
    results:[{
      provider:'pexels',
      providerAssetId:'x',
      kind:'video',
      title:'Abstract lights',
      previewUrl:'https://images.pexels.com/example.jpg',
      pageUrl:'https://www.pexels.com/video/abstract-lights-x/',
      creatorName:'Pexels contributor',
      width:1920,height:1080,durationSeconds:10,
      licenseLabel:'Pexels License',attributionLabel:'Pexels contributor'
    }]
  });
  assert.equal(ranked[0].providerRankRelevance,0);
});


test('Visual validation keeps editorial time-of-day while discovery stays compact',()=>{
  const editorial='Las Vegas city night neon traffic spectacle Fremont Street, real present-day stock footage, 16:9';
  assert.equal(stockDiscoveryQuery(editorial),'fremont street las vegas');
  assert.match(stockVisualValidationQuery(editorial),/night/i);
  assert.match(stockVisualValidationQuery(editorial),/neon/i);
});

test('Night intent rejects dusk or evening-only stock evidence',()=>{
  const result=stockVisualConstraintsSatisfied({
    query:'Fremont Street Las Vegas night neon traffic',
    timeOfDay:['evening','dusk']
  });
  assert.equal(result.ok,false);
  assert.equal(result.expected,'night');
});

test('Sunset intent accepts golden-hour visual evidence',()=>{
  const result=stockVisualConstraintsSatisfied({
    query:'New York skyline sunset golden hour',
    timeOfDay:['golden hour','sunset']
  });
  assert.equal(result.ok,true);
  assert.equal(result.expected,'sunset');
});


test('Verified Stock persists discovery policy version and Source Router reopens older compiler gaps once',()=>{
  const stock=readFileSync('src/lib/server/stock-media.ts','utf8');
  const router=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(stock,/discoveryPolicyVersion:STOCK_DISCOVERY_POLICY_VERSION/);
  assert.match(router,/previousPolicyVersion!==STOCK_DISCOVERY_POLICY_VERSION/);
  assert.match(router,/reason:'stock-discovery-policy-upgraded'/);
});

test('Source Router reopens only legacy transient completed stock gaps',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/verifiedStockGapNeedsTransientRecovery/);
  assert.match(source,/reason:'legacy-transient-gap-recovery'/);
  const recoveryIndex=source.indexOf('verifiedStockGapNeedsTransientRecovery(existing.result)');
  const exhaustedIndex=source.indexOf('videoExhausted=true',recoveryIndex);
  assert.ok(recoveryIndex>=0&&exhaustedIndex>recoveryIndex);
});

test('Verified Stock falls back from transient visual-index failures to mandatory Pre-Render Visual QA',()=>{
  const source=readFileSync('src/lib/server/stock-media.ts','utf8');
  assert.match(source,/ensureStockVisualIndex/);
  assert.match(source,/stockVisualAnalysisFallbackAllowed/);
  assert.match(source,/deterministicStockFallbackTrim/);
  assert.match(source,/verificationMode='pre-render-fallback'|pre-render-fallback/);
  assert.match(source,/await ensureSceneAssetVisualQa\(asset\.id\)/);
  assert.match(source,/review\.status!=='pass'/);
  assert.match(source,/stockCandidateAccepted/);
  assert.match(source,/await selectSceneAsset\(asset\.id\)/);
  const qaIndex=source.indexOf('await ensureSceneAssetVisualQa(asset.id)');
  const selectIndex=source.indexOf('await selectSceneAsset(asset.id)',qaIndex);
  assert.ok(qaIndex>=0&&selectIndex>qaIndex,'fallback QA must run before selection');
});

test('Verified Stock worker remains valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/verified-stock-worker.mjs'],{stdio:'pipe'});
});

test('Verified Stock worker prefers self-hosted database credentials',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/verified-stock-worker.mjs'),'utf8');
  assert.match(source,/process\.env\.DATABASE_API_URL\|\|process\.env\.SUPABASE_URL/);
  assert.match(source,/process\.env\.DATABASE_SERVICE_ROLE_KEY\|\|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source,/DATABASE_URL\+'\/rest\/v1\/rpc\/'/);
});

test('Verified Stock worker sync joins the self-hosted database network',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-verified-stock-worker-sync'),'utf8');
  assert.match(source,/--network cacadores-infra/);
});

test('Verified Stock workers roll releases by drain marker instead of force-killing active jobs',()=>{
  const worker=readFileSync(resolve(process.cwd(),'scripts/verified-stock-worker.mjs'),'utf8');
  const sync=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-verified-stock-worker-sync'),'utf8');
  assert.match(worker,/VERIFIED_STOCK_WORKER_DRAIN_FILE/);
  assert.match(worker,/drainRequested/);
  assert.match(worker,/verified-stock-worker-drained/);
  assert.match(worker,/drain-file-after-job/);
  assert.match(sync,/request_drain/);
  assert.match(sync,/docker update --restart=no/);
  assert.match(sync,/touch '\$DRAIN_FILE'/);
  assert.match(sync,/VERIFIED_STOCK_WORKERS_DRAINING/);
  assert.match(sync,/deferredWorkers/);
  assert.match(sync,/\.State\.Status/);
  assert.match(sync,/main_drain_marker_present/);
  assert.match(sync,/clear_main_drain_marker/);
  assert.match(sync,/stable>=4/);
  assert.match(sync,/State\.Status/);
  assert.match(sync,/\$status.*!=.*running/);
  assert.doesNotMatch(sync,/if ! main_matches_target; then\n\s+docker rm -f "\$CONTAINER"/);
  assert.doesNotMatch(sync,/if fast_matches_target "\$name"; then[\s\S]{0,120}docker rm -f "\$name"/);
});

test('Verified Stock worker drains backlog quickly but keeps normal idle/error polling',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/verified-stock-worker.mjs'),'utf8');
  assert.match(source,/VERIFIED_STOCK_WORKER_DRAIN_YIELD_MS/);
  assert.match(source,/DRAIN_YIELD_MS/);
  assert.match(source,/if\(!claimed\)\{await sleep\(POLL_MS\);continue;\}/);
  assert.match(source,/await sleep\(executionFailed\?POLL_MS:DRAIN_YIELD_MS\);/);
  assert.match(source,/await sleep\(Math\.max\(POLL_MS,5000\)\);/);
  assert.match(source,/drainYieldMs:DRAIN_YIELD_MS/);
});


test('Stock discovery compacts enriched documentary directions into provider-friendly subject queries',()=>{
  const editorial='Real documentary photo or footage of Boston, Massachusetts — Central Artery and Big Dig urban infrastructure; visibly illustrate: Boston once ran a major elevated highway through the middle of downtown; prioritize location-specific infrastructure, street-level evidence or a clear physical mechanism; avoid generic unrelated skyline imagery.';
  const query=stockDiscoveryQuery(editorial);
  assert.match(query,/Boston/i);
  assert.match(query,/Central Artery|Big Dig/i);
  assert.match(query,/elevated highway|downtown/i);
  assert.equal(query.length<=100,true);
  assert.doesNotMatch(query,/documentary|photo or footage|prioritize|avoid/i);
});

test('Wikimedia search only tolerates the known legacy provider constraint until schema migration lands',()=>{
  const source=readFileSync('src/lib/server/stock-media.ts','utf8');
  const schema=readFileSync('docs/schema.sql','utf8');
  assert.match(source,/legacyWikimediaConstraint=input\.provider==='wikimedia'/);
  assert.match(source,/ledger\.error\?\.code==='23514'/);
  assert.match(source,/radar_stock_searches_provider_check/);
  assert.match(schema,/provider in \('pexels','pixabay','unsplash','vecteezy','wikimedia'\)/);
});


test('Verified stock lets top provider results reach visual validation without treating them as visually proven',()=>{
  assert.equal(verifiedStockSearchRelevance(0,0),.5);
  assert.equal(verifiedStockSearchRelevance(0,1),.475);
  assert.equal(verifiedStockSearchRelevance(0,2),.45);
  assert.equal(verifiedStockSearchRelevance(.82,0),.82);
  const weakVisual=.18;
  const weakCombined=verifiedStockSearchRelevance(0,0)*.55+weakVisual*.45;
  assert.equal(stockCandidateAccepted({
    searchScore:verifiedStockSearchRelevance(0,0),
    visualRelevance:weakVisual,
    combinedScore:weakCombined
  }),false);
  const usefulVisual=.35;
  const usefulCombined=verifiedStockSearchRelevance(0,0)*.55+usefulVisual*.45;
  assert.equal(stockCandidateAccepted({
    searchScore:verifiedStockSearchRelevance(0,0),
    visualRelevance:usefulVisual,
    combinedScore:usefulCombined
  }),true);
});

test('Stock discovery expands enriched documentary directions into layered provider queries',()=>{
  const editorial='Real documentary photo or footage of Boston, Massachusetts — Central Artery and Big Dig urban infrastructure; visibly illustrate: Boston once ran a major elevated highway through the middle of downtown; prioritize location-specific infrastructure, street-level evidence or a clear physical mechanism; avoid generic unrelated skyline imagery.';
  const queries=stockDiscoveryQueries(editorial);
  assert.equal(queries[0],stockDiscoveryQuery(editorial));
  assert.ok(queries.some(query=>/Boston.*highway/i.test(query)));
  assert.ok(queries.some(query=>/Boston city infrastructure/i.test(query)));
  assert.equal(queries.length>=3,true);
  assert.equal(queries.every(query=>query.length<=100),true);
});

test('Verified Stock worker only treats a selected motion-QA video as resolved',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/app/api/workers/verified-stock/route.ts'),'utf8');
  assert.match(source,/select\('id,asset_kind,source_type,provider,payload'\)/);
  assert.match(source,/selectedCurrent&&selected&&String\(selected\.asset_kind\)===\'video\'/);
  assert.match(source,/selectedVideoPassesVisualQa\(selected\.payload\)/);
  assert.match(source,/qa\.status===\'pass\'/);
  assert.match(source,/motion\.meaningfulMotion===true/);
});



test('Verified stock sync clears a persisted main-worker drain marker before launching the replacement',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-verified-stock-worker-sync'),'utf8');
  const removeIndex=source.indexOf('if remove_after_drain "$CONTAINER"; then');
  const clearIndex=source.indexOf('rm -f "$WORK_DIR/${DRAIN_FILE#/tmp/}"',removeIndex);
  const runIndex=source.indexOf('docker run -d',removeIndex);
  assert.ok(removeIndex>=0&&clearIndex>removeIndex&&runIndex>clearIndex);
});

test('Verified stock sync keeps fast workers on the promoted release and stable URL',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-verified-stock-worker-sync'),'utf8');
  assert.match(source,/FAST_WORKERS="\$\{VERIFIED_STOCK_FAST_WORKERS:-1\}"/);
  assert.match(source,/auditseo\.verified-stock-fast\.sha/);
  assert.match(source,/\$PROJECT-stock-fast-\$i/);
  assert.match(source,/--env-file "\$ENV_FILE"/);
  assert.match(source,/-e VERIFIED_STOCK_WORKER_URL="\$FAST_WORKER_URL"/);
  assert.match(source,/AUTOMATION_WORKER_URL/);
  assert.match(source,/node scripts\/verified-stock-worker\.mjs/);
  assert.doesNotMatch(source,/prod-3102|prod-3103/);
  assert.match(source,/suffix>FAST_WORKERS/);
});


test('Verified stock asks Visual Intelligence for a non-overlapping microcut before rejecting source reuse',()=>{
  const source=readFileSync('src/lib/server/stock-media.ts','utf8');
  const intelligence=readFileSync('src/lib/server/visual-intelligence.ts','utf8');
  assert.match(source,/const excludedSourceRanges=priorUses/);
  assert.match(source,/desiredDurationSeconds:input\.desiredDurationSeconds,\n\s+excludedSourceRanges/);
  assert.match(intelligence,/selectVisualSegmentWindow/);
  assert.match(intelligence,/excludedSourceRanges:input\.excludedSourceRanges/);
});

test('Verified stock requires Pre-Render Visual QA for every accepted video path',()=>{
  const source=readFileSync('src/lib/server/stock-media.ts','utf8');
  assert.match(source,/ensureStockVisualIndex/);
  assert.match(source,/stockVisualAnalysisFallbackAllowed/);
  assert.match(source,/deterministicStockFallbackTrim/);
  assert.match(source,/verificationMode=fallbackAccepted\?'pre-render-fallback':'visual-index'/);
  const accept=source.indexOf('if(indexedAccepted||fallbackAccepted)');
  const qa=source.indexOf('const review=await ensureSceneAssetVisualQa(asset.id)',accept);
  const select=source.indexOf('await selectSceneAsset(asset.id)',qa);
  assert.ok(accept>=0&&qa>accept&&select>qa,'visual QA must run before stock selection for all accepted paths');
  assert.match(source,/stage:'pre-render-visual-qa'/);
  assert.match(source,/review\.motion\?\.meaningfulMotion!==true/);
  assert.match(source,/O candidato stock não passou no Pre-Render Visual QA de movimento/);
});

test('Verified stock selection recovery is bounded instead of restarting forever',()=>{
  const router=readFileSync('src/lib/server/source-router.ts','utf8');
  const jobs=readFileSync('src/lib/server/verified-stock-jobs.ts','utf8');
  assert.match(router,/if\(existing\.attempts<2\)/);
  assert.match(router,/restartVerifiedStockJob\(existing\.id,\{resetAttempts:false\}\)/);
  assert.match(router,/selection-recovery-exhausted/);
  assert.match(router,/videoExhausted=true/);
  assert.match(jobs,/options:\{resetAttempts\?:boolean\}=\{\}/);
  assert.match(jobs,/options\.resetAttempts===false\?\{\}:\{attempts:0\}/);
});

test('Verified Stock worker retries failures from preflight reads instead of leaving processing leases stuck',()=>{
  const source=readFileSync('src/app/api/workers/verified-stock/route.ts','utf8');
  const guarded=source.indexOf("try{\n      const selected=checked");
  const providers=source.indexOf('const providers=',guarded);
  const retryCatch=source.indexOf('}catch(error){',guarded);
  assert.ok(guarded>0);
  assert.ok(providers>guarded);
  assert.ok(retryCatch>providers);
  assert.ok(source.includes("status:'queued'"));
  assert.ok(source.includes("status:'failed'"));
});

test('Verified Stock worker route recovers its own lease after unhandled 5xx failures',()=>{
  const source=readFileSync('src/app/api/workers/verified-stock/route.ts','utf8');
  assert.match(source,/let claimedLease:\{jobId:string;workerToken:string\}\|null=null/);
  assert.match(source,/claimedLease=\{/);
  assert.match(source,/claimedLease&&status>=500/);
  assert.match(source,/worker-route-unhandled/);
  assert.match(source,/\.eq\('status','processing'\)/);
  assert.match(source,/\.eq\('worker_token',claimedLease\.workerToken\)/);
  assert.match(source,/available_at:new Date\(Date\.now\(\)\+5000\)\.toISOString\(\)/);
});


test('Verified stock opens a per-job circuit breaker after transient provider search failures',()=>{
  const source=readFileSync('src/lib/server/stock-media.ts','utf8');
  assert.match(source,/function stockProviderSearchShouldTrip/);
  assert.match(source,/status===429\|\|status===500\|\|status===502\|\|status===503\|\|status===504/);
  assert.match(source,/let providerCircuitOpen=false/);
  assert.match(source,/stage:'provider-circuit-breaker'/);
  assert.match(source,/if\(providerCircuitOpen\)continue/);
});

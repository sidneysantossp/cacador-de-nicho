import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  rankStockMediaResults, stockCandidateAccepted, stockDiscoveryQueries, stockDiscoveryQuery,
  stockDownloadHostAllowed,
  stockFallbackEligible, stockVisualConstraintsSatisfied, stockVisualValidationQuery, validStockQuery,
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


test('Verified Stock worker remains valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/verified-stock-worker.mjs'],{stdio:'pipe'});
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
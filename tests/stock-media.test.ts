import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankStockMediaResults, stockCandidateAccepted, stockDiscoveryQuery, stockDownloadHostAllowed,
  stockFallbackEligible, validStockQuery
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
    query:'Fremont Street Las Vegas',
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
    'Fremont Street Las Vegas'
  );
});


test('Stock discovery prioritizes exact landmark geography',()=>{
  assert.equal(
    stockDiscoveryQuery('Bryant Park Midtown Manhattan urban park skyscrapers people'),
    'Bryant Park New York City'
  );
});

test('Stock discovery prioritizes exact district geography',()=>{
  assert.equal(
    stockDiscoveryQuery('Present-day Fremont Street / Las Vegas establishing shot. Real current-location stock only.'),
    'Fremont Street Las Vegas'
  );
});

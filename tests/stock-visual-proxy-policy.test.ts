import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stockVisualProxyQuery } from '../src/lib/stock-visual-proxy-policy';

test('Concrete visual direction becomes a filmable proxy query',()=>{
  assert.equal(
    stockVisualProxyQuery({
      canonical:'without becoming another rumor feed',
      direction:'people talking naturally street without becoming another'
    }),
    'people talking street'
  );
  assert.equal(
    stockVisualProxyQuery({
      canonical:'most impressive npc system might one never notice',
      direction:'pedestrians walking interacting sidewalks most impressive npc'
    }),
    'pedestrians walking interacting sidewalks'
  );
});

test('Stale factual media-class wording never overrides canonical stock intent',()=>{
  assert.equal(
    stockVisualProxyQuery({
      canonical:'pedestrian pathfinding adapting route to traffic speed',
      direction:'authentic geographic map map route traffic speed'
    }),
    'pedestrian pathfinding adapting route to traffic speed'
  );
  assert.equal(
    stockVisualProxyQuery({
      canonical:'Rockstar design goals public statements not technical architecture',
      direction:'authentic source document archive document design goals'
    }),
    'software developer working at computer office'
  );
});

test('Abstract stock beats receive safe generic visual fallbacks',()=>{
  assert.equal(
    stockVisualProxyQuery({
      canonical:'leads strange conclusion',
      direction:''
    }),
    'people walking busy modern city street'
  );
  assert.equal(
    stockVisualProxyQuery({
      canonical:'civilian moving away danger',
      direction:''
    }),
    'person moving away from danger city street'
  );
});

test('Source Router compiles one sourceQuery and uses it across automatic visual sources',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/const sourceQuery=sourceRouteRequiresAuthenticEvidence\(route\)/);
  assert.match(source,/stockVisualProxyQuery\(\{/);
  assert.match(source,/query:sourceQuery,/);
  assert.match(source,/const candidates=await searchYouTubeCreativeCommonsSources\(sourceQuery,6\)/);
  assert.match(source,/const currentCompiledQuery=stockDiscoveryQuery\(sourceQuery\)/);
  assert.match(source,/query:sourceQuery\n    \}\);/);
});

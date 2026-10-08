import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceRouteExecutionKey, type SourceRoutePlan } from '../src/lib/source-router-policy';

const route:SourceRoutePlan={
  beatId:'beat-1',
  preference:'stock-video',
  query:'without becoming another rumor feed',
  actions:['owned','stock-video','stock-image','youtube-cc'],
  syntheticAllowed:false
};

test('Terminal route fingerprint changes when the effective sourcing query changes',()=>{
  const canonical=sourceRouteExecutionKey(route);
  const proxy=sourceRouteExecutionKey(route,'people talking street');
  assert.notEqual(canonical,proxy);
  assert.equal(
    sourceRouteExecutionKey(route,'people talking street'),
    proxy
  );
});

test('Source Router stores effective source query in terminal fingerprints',()=>{
  const source=readFileSync('src/lib/server/source-router.ts','utf8');
  assert.match(source,/sourceQuery:string/);
  assert.match(source,/sourceRouteExecutionKey\(input\.route,input\.sourceQuery\)/);
  assert.match(source,/sourceQuery,\n\s+status:'operator-source-required'/);
  assert.match(source,/sourceQuery,\n\s+status:'gap'/);
});

test('Episode Automation invalidates old terminal gaps when visual proxy changes',()=>{
  const source=readFileSync('src/lib/server/episode-automation.ts','utf8');
  assert.match(source,/stockVisualProxyQuery\(\{/);
  assert.match(source,/sourceRouteExecutionKey\(route,sourceQuery\)/);
  const proxyIndex=source.indexOf('const sourceQuery=sourceRouteRequiresAuthenticEvidence(route)');
  const compareIndex=source.indexOf('sourceRouteExecutionKey(route,sourceQuery)',proxyIndex);
  assert.ok(proxyIndex>=0&&compareIndex>proxyIndex);
});

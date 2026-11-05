import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bridgeSecretValid,scopedYoutubeChannel,safeBridgeMetrics} from '../src/lib/gomotion-bridge-policy';

const expected='UCVqoM3LGRS2nrfKk2CzeXjQ';

test('Bridge requires strong secret and exact constant-time comparison',()=>{
  const secret='x'.repeat(64);
  assert.equal(bridgeSecretValid(secret,secret),true);
  for(const invalid of [null,'short','x'.repeat(63),'z'.repeat(64),'',undefined] as const){
    assert.equal(bridgeSecretValid(invalid??null,secret),false);
  }
  assert.equal(bridgeSecretValid('short','short'),false);
  assert.equal(bridgeSecretValid(secret,undefined),false);
});

test('Only the requested Elétrico em Movimento YouTube channel is selected',()=>{
  const channels=[
    {youtubeChannelId:'UC2DFMulDl9YpjDoM0iZf3Pw',status:'connected',isPrimary:true,youtubeTitle:'Guia das Bancas'},
    {youtubeChannelId:expected,status:'connected',isPrimary:false,youtubeTitle:'Elétrico em Movimento'},
    {youtubeChannelId:expected,status:'needs-reauth',isPrimary:true,youtubeTitle:'Old EV identity'}
  ];
  assert.equal(scopedYoutubeChannel(channels,expected)?.youtubeTitle,'Elétrico em Movimento');
  assert.equal(scopedYoutubeChannel(channels,'UCNoOtherChannelAllowed__'),null);
  assert.equal(scopedYoutubeChannel(channels,''),null);
  assert.equal(scopedYoutubeChannel(channels.filter(x=>x.youtubeChannelId!==expected),expected),null);
});

test('Never silently fall back to Guia das Bancas when EV is missing',()=>{
  const channels=[{youtubeChannelId:'UC2DFMulDl9YpjDoM0iZf3Pw',status:'connected',isPrimary:true}];
  assert.equal(scopedYoutubeChannel(channels,expected),null);
});

test('Only allowlisted finite numeric analytics are returned',()=>{
  const result=safeBridgeMetrics({
    views:150,impressions:20000,ctrPercent:7.1,likes:19,
    accessToken:'do-not-include',email:'hidden',comments:[{text:'private'}],
    revenue:NaN,rpm:Infinity,viewsPrivate:999
  });
  assert.deepEqual(result,{views:150,impressions:20000,ctrPercent:7.1,likes:19});
  assert.equal(JSON.stringify(result).includes('do-not-include'),false);
});

test('This pilot exposes only GET and no video mutation route',()=>{
  const content=readFileSync(new URL('../src/app/api/gomotion-youtube/route.ts',import.meta.url),'utf8');
  assert.match(content,/export async function GET\(/);
  assert.doesNotMatch(content,/export async function (?:POST|PUT|PATCH|DELETE)\(/);
  assert.match(content,/Cache-Control':'no-store'/);
});

test('Reconnection requests explicit Google account selection and consent',()=>{
  const source=readFileSync(new URL('../src/lib/server/youtube-oauth.ts',import.meta.url),'utf8');
  assert.match(source,/url\.searchParams\.set\('prompt','select_account consent'\)/);
});

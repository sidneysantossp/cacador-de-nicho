import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSpendYouTubeSearch,
  emptyYouTubeSearchBudget,
  pacificDate,
  spendYouTubeSearch,
  YOUTUBE_SEARCH_DAILY_LIMIT,
  YOUTUBE_SEARCH_PURPOSE_LIMITS
} from '../src/lib/youtube-quota';

test('YouTube search budget resets on the Pacific calendar day',()=>{
  const before=new Date('2026-09-23T06:59:00.000Z');
  const after=new Date('2026-09-23T07:01:00.000Z');
  assert.equal(pacificDate(before),'2026-09-22');
  assert.equal(pacificDate(after),'2026-09-23');
  assert.notEqual(emptyYouTubeSearchBudget(before).id,emptyYouTubeSearchBudget(after).id);
});

test('YouTube search budget starts with 100 calls and purpose reserves',()=>{
  const state=emptyYouTubeSearchBudget(new Date('2026-09-23T12:00:00Z'));
  assert.equal(state.limit,YOUTUBE_SEARCH_DAILY_LIMIT);
  assert.equal(state.remaining,100);
  assert.equal(state.purposeLimits['radar-discovery'],48);
  assert.equal(state.purposeLimits['channel-study'],16);
  assert.equal(state.purposeLimits['similar-channels'],24);
});

test('discovery cannot consume investigation reserves',()=>{
  let state=emptyYouTubeSearchBudget(new Date('2026-09-23T12:00:00Z'));
  for(let i=0;i<YOUTUBE_SEARCH_PURPOSE_LIMITS['radar-discovery'];i++){
    state=spendYouTubeSearch(state,'radar-discovery',`q-${i}`);
  }
  assert.deepEqual(canSpendYouTubeSearch(state,'radar-discovery'),{allowed:false,reason:'purpose-limit'});
  assert.deepEqual(canSpendYouTubeSearch(state,'channel-study'),{allowed:true,reason:null});
  assert.deepEqual(canSpendYouTubeSearch(state,'similar-channels'),{allowed:true,reason:null});
});

test('global limit blocks every search purpose',()=>{
  let state=emptyYouTubeSearchBudget(new Date('2026-09-23T12:00:00Z'));
  state={...state,used:100,remaining:0};
  for(const purpose of Object.keys(YOUTUBE_SEARCH_PURPOSE_LIMITS) as Array<keyof typeof YOUTUBE_SEARCH_PURPOSE_LIMITS>){
    assert.deepEqual(canSpendYouTubeSearch(state,purpose),{allowed:false,reason:'daily-limit'});
  }
});

test('blocked external quota state stops all new search requests',()=>{
  const state={...emptyYouTubeSearchBudget(new Date('2026-09-23T12:00:00Z')),blocked:true,blockedReason:'quotaExceeded'};
  assert.deepEqual(canSpendYouTubeSearch(state,'radar-discovery'),{allowed:false,reason:'blocked'});
  assert.deepEqual(canSpendYouTubeSearch(state,'channel-study'),{allowed:false,reason:'blocked'});
});

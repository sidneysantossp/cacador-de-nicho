import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpportunityCandidate, qualifiesOpportunityCandidate } from '../src/lib/opportunity-criteria';
import type { Channel, Settings } from '../src/lib/types';

const config:Pick<Settings,'minViews'|'maxVideoAgeHours'|'maxChannelVideos'|'maxChannelAgeDays'>={
  minViews:500000,
  maxVideoAgeHours:72,
  maxChannelVideos:20,
  maxChannelAgeDays:180
};

function channel(overrides:Partial<Channel>={}):Channel{
  return {
    id:'c1',
    name:'Breakout Lab',
    handle:'@breakout',
    niche:'Education',
    language:'en-US',
    country:'US',
    format:'2D Animation',
    description:'',
    lens:'',
    thumbnail:'',
    url:'https://youtube.com/channel/c1',
    createdAt:'2026-07-01T12:00:00.000Z',
    firstSeenAt:'2026-09-22T12:00:00.000Z',
    observedAt:'2026-09-22T12:00:00.000Z',
    videoCount:12,
    subscribers:15000,
    video:{
      id:'v1',
      title:'Breakout',
      publishedAt:'2026-09-20T12:00:01.000Z',
      views:650000,
      duration:'PT8M',
      thumbnail:'',
      url:'https://youtube.com/watch?v=v1'
    },
    status:'new',
    evidence:[],
    discoverySource:'reference-adjacent',
    ...overrides
  };
}

test('strict opportunity gate accepts a young small channel with a recent breakout',()=>{
  const q=evaluateOpportunityCandidate(channel(),config);
  assert.equal(q.qualified,true);
  assert.equal(q.failed.length,0);
  assert.ok((q.breakoutRatio??0)>1);
});

test('strict opportunity gate rejects large back catalogs',()=>{
  const q=evaluateOpportunityCandidate(channel({videoCount:21}),config);
  assert.equal(q.qualified,false);
  assert.match(q.failed.join(' '),/mais de 20 vídeos/);
});

test('strict opportunity gate rejects stale videos and old channels',()=>{
  assert.equal(qualifiesOpportunityCandidate(channel({video:{...channel().video,publishedAt:'2026-09-19T12:00:00.000Z'}}),config),false);
  assert.equal(qualifiesOpportunityCandidate(channel({createdAt:'2026-01-01T12:00:00.000Z'}),config),false);
});

test('strict opportunity gate rejects weak reach and non-breakout videos',()=>{
  assert.equal(qualifiesOpportunityCandidate(channel({video:{...channel().video,views:499999}}),config),false);
  assert.equal(qualifiesOpportunityCandidate(channel({subscribers:900000}),config),false);
});

test('hidden subscriber counts do not block an otherwise qualifying channel',()=>{
  assert.equal(qualifiesOpportunityCandidate(channel({subscribers:null}),config),true);
});

test('strict market gate rejects non-US, non-English and short-form candidates',()=>{
  assert.equal(qualifiesOpportunityCandidate(channel({country:'IN'}),config),false);
  assert.equal(qualifiesOpportunityCandidate(channel({language:'hi'}),config),false);
  assert.equal(qualifiesOpportunityCandidate(channel({video:{...channel().video,duration:'PT2M59S'}}),config),false);
});

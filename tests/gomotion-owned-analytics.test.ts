import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  analyticsDateWindow,googleAnalyticsMetrics,safeAnalyticsReport,
  safeLatestVideoList,EV_CHANNEL_ID,ANALYTICS_READ_SCOPE
} from '../src/lib/gomotion-owned-analytics-policy';

test('7 and 28 completed UTC calendar day windows are inclusive',()=>{
  const now=new Date('2026-11-05T10:45:00Z');
  assert.deepEqual([analyticsDateWindow(7,now).startDate,analyticsDateWindow(7,now).endDate],['2026-10-29','2026-11-04']);
  assert.deepEqual([analyticsDateWindow(28,now).startDate,analyticsDateWindow(28,now).endDate],['2026-10-08','2026-11-04']);
});
test('Month/year boundaries do not silently drift',()=>{
  const w=analyticsDateWindow(7,new Date('2027-01-02T00:10:00Z'));
  assert.equal(w.startDate,'2026-12-26');
  assert.equal(w.endDate,'2027-01-01');
});
test('Google report maps only explicitly allowlisted finite metrics',()=>{
  const report={
    columnHeaders:[{name:'views'},{name:'estimatedMinutesWatched'},{name:'averageViewPercentage'},{name:'likes'},{name:'estimatedRevenue'},{name:'unknown'}],
    rows:[[133,298.5,46.4,12,490.3,999]]
  };
  assert.deepEqual(safeAnalyticsReport(report),{
    status:'available',
    metrics:{views:133,watchTimeMinutes:298.5,averagePercentageViewed:46.4,likes:12}
  });
  assert.equal(JSON.stringify(safeAnalyticsReport(report)).includes('490.3'),false);
});
test('No-rows is explicitly unknown, never invented zero views',()=>{
  assert.deepEqual(safeAnalyticsReport({columnHeaders:[{name:'views'}],rows:[]}),
    {status:'no-rows',metrics:null});
  assert.deepEqual(safeAnalyticsReport(null),{status:'no-rows',metrics:null});
});
test('Rejects negative, null, NaN and infinite metrics',()=>{
  const report={columnHeaders:[{name:'views'},{name:'likes'},{name:'subscribersGained'},{name:'comments'}],
    rows:[[-1,null,Number.NaN,Number.POSITIVE_INFINITY]]};
  assert.deepEqual(safeAnalyticsReport(report),{status:'available',metrics:{}});
});
test('Latest videos never mixes an unrelated channel or invalid video IDs',()=>{
  const r=safeLatestVideoList([
    {snippet:{channelId:EV_CHANNEL_ID,title:'EP01',publishedAt:'2026-11-01T12:00:00Z'},
      contentDetails:{videoId:'eVq56yXTiwE'}},
    {snippet:{channelId:'UC2DFMulDl9YpjDoM0iZf3Pw',title:'Guia'},
      contentDetails:{videoId:'01234567890'}},
    {snippet:{channelId:EV_CHANNEL_ID,title:'Bad'},contentDetails:{videoId:'bad!'}},
  ],EV_CHANNEL_ID);
  assert.equal(r.length,1);
  assert.equal(r[0].videoId,'eVq56yXTiwE');
});
test('Read-only endpoint authenticates before Google calls, scopes the channel and never mutates',()=>{
  const s=readFileSync(new URL('../src/app/api/gomotion-youtube/analytics/route.ts',import.meta.url),'utf8');
  assert.match(s,/bridgeSecretValid\(request\.headers\.get\('x-gomotion-bridge-secret'\)/);
  assert.match(s,/channelId!==EV_CHANNEL_ID/);
  assert.match(s,/ownChannel\.youtubeChannelId!==EV_CHANNEL_ID/);
  assert.match(s,/export async function GET\(/);
  assert.doesNotMatch(s,/export async function (POST|PUT|PATCH|DELETE)\(/);
  assert.match(s,/readOnly:true/);
  assert.match(s,/Cache-Control':'no-store'/);
  assert.ok(googleAnalyticsMetrics.includes('views'));
  assert.ok(ANALYTICS_READ_SCOPE.endsWith('yt-analytics.readonly'));
});

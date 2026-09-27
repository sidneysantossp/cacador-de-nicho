import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PublicationPackage, YouTubeConnection } from '../src/lib/types';
import {
  buildYouTubePublishPayload, youtubePublishReadinessIssues, youtubeWatchUrl
} from '../src/lib/youtube-publisher-policy';

const now='2026-09-23T22:30:00.000Z';

function pkg():PublicationPackage{
  return {
    kind:'publication-package',
    id:'11111111-1111-4111-8111-111111111111',
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'33333333-3333-4333-8333-333333333333',
    qualityReportId:'44444444-4444-4444-8444-444444444444',
    qualityReportVersion:2,
    renderJobId:'55555555-5555-4555-8555-555555555555',
    renderOutputPath:'channels/x/final.mp4',
    renderOutputBytes:5*1024*1024*1024,
    metadata:{
      title:'Will AI Change What It Means to Be Human?',
      description:'Description',
      tags:['AI','future'],
      language:'en',
      categoryId:'28',
      visibility:'private',
      audience:'not-made-for-kids',
      syntheticMediaDisclosure:'yes',
      license:'youtube'
    },
    thumbnail:{
      source:'uploaded',
      storagePath:'channels/x/thumb.jpg',
      mimeType:'image/jpeg',
      originalName:'thumb.jpg',
      bytes:500000,
      width:1280,
      height:720,
      concept:'Dino and robot',
      overlayText:'',
      altText:''
    },
    review:{notes:'',approvedAt:now,approvedBy:'operator'},
    createdAt:now,updatedAt:now,
    version:4,status:'approved'
  };
}

function connection():YouTubeConnection{
  return {
    id:'66666666-6666-4666-8666-666666666666',
    channelId:'22222222-2222-4222-8222-222222222222',
    youtubeChannelId:'UC_TEST_CHANNEL',
    youtubeTitle:'Test Channel',
    youtubeHandle:'@test',
    scopes:[
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload'
    ],
    status:'connected',
    lastValidatedAt:now,
    createdAt:now,updatedAt:now
  };
}

test('YouTube publisher accepts only approved package and connected matching channel',()=>{
  assert.deepEqual(youtubePublishReadinessIssues(pkg(),connection()),[]);
  assert.ok(youtubePublishReadinessIssues({...pkg(),status:'draft'},connection()).includes('package-not-approved'));
  assert.ok(youtubePublishReadinessIssues(pkg(),{...connection(),status:'needs-reauth'}).includes('youtube-reauth-required'));
  assert.ok(youtubePublishReadinessIssues(pkg(),{...connection(),channelId:'77777777-7777-4777-8777-777777777777'}).includes('youtube-channel-mismatch'));
});

test('YouTube publish snapshot maps compliance fields explicitly',()=>{
  const payload=buildYouTubePublishPayload(pkg(),connection());
  assert.equal(payload.packageVersion,4);
  assert.equal(payload.youtubeChannelId,'UC_TEST_CHANNEL');
  assert.equal(payload.video.privacyStatus,'private');
  assert.equal(payload.video.selfDeclaredMadeForKids,false);
  assert.equal(payload.video.containsSyntheticMedia,true);
  assert.equal(payload.renderOutputPath,'channels/x/final.mp4');
  assert.equal(payload.renderOutputBytes,5*1024*1024*1024);
  assert.equal(payload.thumbnailStoragePath,'channels/x/thumb.jpg');
});

test('YouTube publisher blocks unconfirmed compliance and missing thumbnail',()=>{
  const value=pkg();
  value.metadata.audience='unset';
  value.metadata.syntheticMediaDisclosure='review';
  value.thumbnail.storagePath=null;
  const issues=youtubePublishReadinessIssues(value,connection());
  assert.ok(issues.includes('audience-unconfirmed'));
  assert.ok(issues.includes('synthetic-disclosure-unconfirmed'));
  assert.ok(issues.includes('thumbnail-missing'));
});

test('YouTube watch URL safely encodes video id',()=>{
  assert.equal(youtubeWatchUrl('abc_123-XYZ'),'https://www.youtube.com/watch?v=abc_123-XYZ');
});

test('YouTube publication worker is valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/youtube-publish-worker.mjs'],{stdio:'pipe'});
});


test('YouTube publication worker keeps large-file disk preflight and bounded upload requests',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/youtube-publish-worker.mjs'),'utf8');
  assert.match(source,/publishDiskReady/);
  assert.match(source,/HeadObjectCommand/);
  assert.match(source,/YOUTUBE_PUBLISH_MIN_FREE_DISK_GB/);
  assert.match(source,/YOUTUBE_PUBLISH_DISK_MARGIN_GB/);
  assert.match(source,/withLeaseHeartbeat/);
  assert.match(source,/AbortSignal\.timeout\(UPLOAD_REQUEST_TIMEOUT_MS\)/);
  assert.match(source,/error\.code='LOW_DISK'/);
});


test('Self-hosted YouTube publish worker sync is syntax-valid and guarded by OAuth readiness',()=>{
  const file=resolve(process.cwd(),'ops/self-hosted/bin/cacadores-youtube-publish-worker-sync');
  execFileSync('bash',['-n',file],{stdio:'pipe'});
  const source=readFileSync(file,'utf8');
  assert.match(source,/YOUTUBE_OAUTH_CLIENT_ID/);
  assert.match(source,/YOUTUBE_OAUTH_CLIENT_SECRET/);
  assert.match(source,/YOUTUBE_TOKEN_ENCRYPTION_KEY/);
  assert.match(source,/YOUTUBE_PUBLISH_WORKER_BLOCKED/);
  assert.match(source,/node scripts\/youtube-publish-worker\.mjs/);
  assert.match(source,/auditseo\.youtube-publish\.sha/);
});

test('Assisted-manual mode does not auto-enable the YouTube publish worker timer',()=>{
  const promote=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-promote'),'utf8');
  const health=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-health-watch'),'utf8');
  assert.match(promote,/cacadores-youtube-publish-worker-sync\.timer/);
  assert.match(promote,/assisted-manual/);
  assert.match(health,/cacadores-youtube-publish-worker-sync\.timer/);
  assert.match(health,/OPERATION_MODE.*assisted-manual/s);
});


test('YouTube publishing OAuth requests only the scopes needed for connection and upload',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/youtube-oauth.ts'),'utf8');
  const scopeBlock=source.match(/export const YOUTUBE_OAUTH_SCOPES=\[([\s\S]*?)\] as const;/)?.[1]??'';
  assert.match(scopeBlock,/youtube\.upload/);
  assert.match(scopeBlock,/youtube\.readonly/);
  assert.doesNotMatch(scopeBlock,/yt-analytics/);
});

test('YouTube OAuth callback redirects to the configured public origin, not the container request URL',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/app/api/youtube-oauth/callback/route.ts'),'utf8');
  assert.match(source,/youtubeOAuthConfig\(\)\.redirectUri/);
  assert.doesNotMatch(source,/new URL\('\/',request\.url\)/);
});


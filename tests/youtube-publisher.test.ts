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

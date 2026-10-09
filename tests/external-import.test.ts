import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ExternalImportItem, VisualScenePrompt } from '../src/lib/types';
import {
  externalMediaIpIsPublic, externalMediaMaxBytes, externalMediaMimeKind,
  externalMediaUrlShapeAllowed
} from '../src/lib/external-media-url-policy';
import {
  classifyExternalFile, externalBatchStatus, matchExternalFileToScene,
  parseExternalMediaMarker, previewExternalImportFiles
} from '../src/lib/external-import-policy';

const scenes=[
  {sceneId:'11111111-1111-4111-8111-111111111111',sequence:1,startSeconds:0,timecodeLabel:'#0-00'},
  {sceneId:'22222222-2222-4222-8222-222222222222',sequence:2,startSeconds:3,timecodeLabel:'#0-03'},
  {sceneId:'33333333-3333-4333-8333-333333333333',sequence:3,startSeconds:7,timecodeLabel:'#0-07'}
] as Pick<VisualScenePrompt,'sceneId'|'sequence'|'startSeconds'|'timecodeLabel'>[];

test('External import classifies production file types',()=>{
  assert.equal(classifyExternalFile({name:'0-03.png',type:'image/png'}),'image');
  assert.equal(classifyExternalFile({name:'0-07.mp4',type:'video/mp4'}),'video');
  assert.equal(classifyExternalFile({name:'voice.mp3',type:'audio/mpeg'}),'audio');
  assert.equal(classifyExternalFile({name:'transcript.srt',type:''}),'transcript');
  assert.equal(classifyExternalFile({name:'notes.docx',type:''}),'other');
});

test('External import parses AutoEditor minute-second markers',()=>{
  assert.deepEqual(parseExternalMediaMarker('0-00.png'),{kind:'timecode',startSeconds:0,label:'#0-00'});
  assert.deepEqual(parseExternalMediaMarker('#0-03 final.png'),{kind:'timecode',startSeconds:3,label:'#0-03'});
  assert.deepEqual(parseExternalMediaMarker('12_34.webp'),{kind:'timecode',startSeconds:754,label:'#12-34'});
  assert.deepEqual(parseExternalMediaMarker('1-02-03.mp4'),{kind:'timecode',startSeconds:3723,label:'#1-02-03'});
});

test('External import parses explicit scene numbers without confusing them with timecodes',()=>{
  assert.deepEqual(parseExternalMediaMarker('scene-003.png'),{kind:'sequence',sequence:3,label:'scene-003'});
  assert.deepEqual(parseExternalMediaMarker('my_scene_0007_final.webp'),{kind:'sequence',sequence:7,label:'scene-007'});
});

test('External import maps timestamped files to the correct scene',()=>{
  assert.equal(matchExternalFileToScene('0-03.png',scenes).sceneId,scenes[1].sceneId);
  assert.equal(matchExternalFileToScene('#0-07 animation.mp4',scenes).sceneId,scenes[2].sceneId);
  assert.equal(matchExternalFileToScene('scene-001.png',scenes).sceneId,scenes[0].sceneId);
});

test('External import refuses to guess when a timestamp is outside tolerance',()=>{
  const result=matchExternalFileToScene('0-05.png',scenes);
  assert.equal(result.sceneId,null);
  assert.equal(result.marker?.kind,'timecode');
});

test('External import preview keeps unmatched media visible and skips unknown files',()=>{
  const preview=previewExternalImportFiles([
    {name:'0-03.png',size:100,type:'image/png'},
    {name:'0-05.png',size:100,type:'image/png'},
    {name:'voice.mp3',size:100,type:'audio/mpeg'},
    {name:'transcript.vtt',size:100,type:'text/vtt'},
    {name:'readme.md',size:100,type:'text/markdown'}
  ],scenes);
  assert.equal(preview[0].status,'pending');
  assert.equal(preview[1].status,'unmatched');
  assert.equal(preview[2].status,'pending');
  assert.equal(preview[3].status,'pending');
  assert.equal(preview[4].status,'skipped');
});

test('External import batch status reflects resumable partial work',()=>{
  const items=(statuses:string[])=>statuses.map(status=>({status})) as Pick<ExternalImportItem,'status'>[];
  assert.equal(externalBatchStatus([]),'planned');
  assert.equal(externalBatchStatus(items(['pending','ready'])),'processing');
  assert.equal(externalBatchStatus(items(['ready','skipped'])),'completed');
  assert.equal(externalBatchStatus(items(['failed','failed'])),'failed');
  assert.equal(externalBatchStatus(items(['ready','unmatched'])),'partial');
});


test('Authorized external media URL policy allows only public HTTPS media shapes',()=>{
  assert.equal(externalMediaUrlShapeAllowed('https://cdn.example.com/video.mp4'),true);
  assert.equal(externalMediaUrlShapeAllowed('http://cdn.example.com/video.mp4'),false);
  assert.equal(externalMediaUrlShapeAllowed('https://user:pass@cdn.example.com/video.mp4'),false);
  assert.equal(externalMediaUrlShapeAllowed('https://localhost/video.mp4'),false);
  assert.equal(externalMediaUrlShapeAllowed('https://cdn.example.com:8443/video.mp4'),false);
  assert.equal(externalMediaIpIsPublic('8.8.8.8'),true);
  assert.equal(externalMediaIpIsPublic('127.0.0.1'),false);
  assert.equal(externalMediaIpIsPublic('10.0.0.4'),false);
  assert.equal(externalMediaIpIsPublic('192.168.1.2'),false);
  assert.equal(externalMediaIpIsPublic('::1'),false);
  assert.equal(externalMediaIpIsPublic('fc00::1'),false);
});

test('Authorized external media URL policy limits formats and bytes',()=>{
  assert.equal(externalMediaMimeKind('video/mp4'),'video');
  assert.equal(externalMediaMimeKind('image/jpeg'),'image');
  assert.equal(externalMediaMimeKind('text/html'),null);
  assert.equal(externalMediaMaxBytes('video/mp4'),250*1024*1024);
  assert.equal(externalMediaMaxBytes('image/webp'),25*1024*1024);
  assert.equal(externalMediaMaxBytes('text/html'),0);
});

test('Authorized external media URL import validates network target and runs Visual QA before selection',()=>{
  const source=readFileSync('src/lib/server/external-media-url.ts','utf8');
  const route=readFileSync('src/app/api/external-media-url/route.ts','utf8');
  assert.match(source,/lookup\(url\.hostname,\{all:true,verbatim:true\}\)/);
  assert.match(source,/redirect:'manual'/);
  assert.match(source,/externalMediaIpIsPublic/);
  assert.match(source,/externalMediaMaxBytes/);
  assert.match(source,/await ensureSceneAssetVisualQa\(asset\.id\)/);
  assert.match(source,/await selectSceneAsset\(asset\.id\)/);
  const qa=source.indexOf('await ensureSceneAssetVisualQa(asset.id)');
  const select=source.indexOf('await selectSceneAsset(asset.id)');
  assert.ok(qa>=0&&select>qa);
  assert.match(route,/requireOperator\(request\)/);
  assert.match(route,/licenseType:z\.enum\(\['owned','licensed'\]\)/);
});


test('external media URL route is available to the scoped operator agent',()=>{
  const auth=readFileSync('src/lib/server/auth.ts','utf8');
  const helper=readFileSync('ops/self-hosted/bin/cacadores-agent-api','utf8');
  assert.match(auth,/\/api\/external-media-url/);
  assert.match(helper,/\/api\/external-media-url/);
});

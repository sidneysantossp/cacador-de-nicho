import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExternalImportItem, VisualScenePrompt } from '../src/lib/types';
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

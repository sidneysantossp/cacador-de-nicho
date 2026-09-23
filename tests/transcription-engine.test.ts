import test from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptPayload, VoiceAlignment } from '../src/lib/types';
import {
  formatTranscriptTimestamp, normalizeTranscriptPayload, parseSrtOrVtt,
  parseTimestampedText, parseTranscriptJson, parseTranscriptTimestamp,
  scriptTranscriptMatchScore, transcriptApprovalIssues, transcriptFromAlignment
} from '../src/lib/transcript-policy';

const now='2026-09-23T19:00:00.000Z';

function payload():TranscriptPayload{
  return {
    kind:'transcript',
    id:'11111111-1111-4111-8111-111111111111',
    channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
    episodeId:'22222222-2222-4222-8222-222222222222',
    scriptId:'33333333-3333-4333-8333-333333333333',
    voiceAssetId:'44444444-4444-4444-8444-444444444444',
    sourceType:'imported',
    text:'Grug saves rocks. Grug learns slowly.',
    words:[],
    segments:[
      {id:'55555555-5555-4555-8555-555555555555',startSeconds:0,endSeconds:2,text:'Grug saves rocks.',wordIds:[]},
      {id:'66666666-6666-4666-8666-666666666666',startSeconds:2,endSeconds:4,text:'Grug learns slowly.',wordIds:[]}
    ],
    scriptMatchScore:null,
    scriptVersion:2,
    voiceTake:1,
    provenance:{importedBy:'operator'},
    review:{scriptMismatchOverride:false,notes:''},
    createdAt:now,
    updatedAt:now
  };
}

test('Transcript timestamps parse SRT commas and compact minute format',()=>{
  assert.equal(parseTranscriptTimestamp('00:01:02,500'),62.5);
  assert.equal(parseTranscriptTimestamp('01:02.250'),62.25);
  assert.equal(parseTranscriptTimestamp('bad'),null);
  assert.equal(formatTranscriptTimestamp(62.5),'01:02.500');
});

test('SRT and VTT parser normalize cues into timed segments',()=>{
  const parsed=parseSrtOrVtt(`1
00:00:00,000 --> 00:00:02,000
Grug saves rocks.

2
00:00:02,000 --> 00:00:04,250
Grug learns slowly.`);
  assert.equal(parsed.segments.length,2);
  assert.equal(parsed.segments[1].startSeconds,2);
  assert.equal(parsed.segments[1].endSeconds,4.25);
  assert.equal(parsed.text,'Grug saves rocks. Grug learns slowly.');
});

test('Timestamped TXT uses the next cue as previous segment end',()=>{
  const parsed=parseTimestampedText(`00:00 Grug wakes up
00:03 Grug counts rocks
00:07 Grug has a problem`,10);
  assert.equal(parsed.segments.length,3);
  assert.equal(parsed.segments[0].endSeconds,3);
  assert.equal(parsed.segments[2].endSeconds,10);
});

test('JSON parser accepts Scribe-like word timestamps and builds segments',()=>{
  const parsed=parseTranscriptJson(JSON.stringify({
    language_code:'en',
    text:'Grug saves rocks.',
    words:[
      {text:'Grug',start:0,end:0.4,type:'word'},
      {text:'saves',start:0.5,end:0.9,type:'word'},
      {text:'rocks.',start:1,end:1.5,type:'word'}
    ]
  }),2);
  assert.equal(parsed.languageCode,'en');
  assert.equal(parsed.words.length,3);
  assert.equal(parsed.segments.length,1);
  assert.equal(parsed.segments[0].text,'Grug saves rocks.');
});

test('ElevenLabs alignment is converted into timed words and segments',()=>{
  const text='Grug saves rocks.';
  const alignment:VoiceAlignment={
    characters:[...text],
    characterStartTimesSeconds:[...text].map((_,i)=>i*0.05),
    characterEndTimesSeconds:[...text].map((_,i)=>(i+1)*0.05)
  };
  const parsed=transcriptFromAlignment(alignment);
  assert.equal(parsed.text,text);
  assert.deepEqual(parsed.words.map(word=>word.text),['Grug','saves','rocks.']);
  assert.equal(parsed.segments.length,1);
});

test('Script/transcript match score is high for equivalent narration and low for unrelated audio',()=>{
  const high=scriptTranscriptMatchScore(
    'Grug saves rocks and learns how money works.',
    'Grug saves rocks and learns how money works.'
  );
  const low=scriptTranscriptMatchScore(
    'Grug saves rocks and learns how money works.',
    'Dinosaurs travel through space in a silver rocket.'
  );
  assert.equal(high,1);
  assert.ok((low??1)<0.2);
});

test('Transcript approval blocks stale script, invalid timing and large mismatch',()=>{
  const p=normalizeTranscriptPayload(payload(),'Completely different narration about a rocket ship.');
  const broken:TranscriptPayload={
    ...p,
    scriptVersion:1,
    segments:[...p.segments,{id:'77777777-7777-4777-8777-777777777777',startSeconds:5,endSeconds:null,text:'Missing end.',wordIds:[]}]
  };
  const issues=transcriptApprovalIssues(broken,2);
  assert.ok(issues.includes('stale-script-version'));
  assert.ok(issues.includes('invalid-segment-end'));
  assert.ok(issues.includes('script-mismatch'));
});

test('Transcript mismatch can be explicitly overridden by operator review',()=>{
  const p=normalizeTranscriptPayload(payload(),'Completely different narration about a rocket ship.');
  const issues=transcriptApprovalIssues({...p,review:{scriptMismatchOverride:true,notes:'Intentional adaptation.'}},2);
  assert.equal(issues.includes('script-mismatch'),false);
});

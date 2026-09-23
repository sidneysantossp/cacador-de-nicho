import test from 'node:test';
import assert from 'node:assert/strict';
import type { Timeline, Transcript, VideoEditPayload } from '../src/lib/types';
import {
  buildInitialVideoEdit, motionPresetValues, normalizeVideoEdit,
  videoEditApprovalIssues, videoEditStructuralIssues, videoEditUpstreamIssues
} from '../src/lib/video-editor-policy';

const now='2026-09-23T22:00:00.000Z';

const timeline={
  kind:'timeline',
  id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scenePlanId:'33333333-3333-4333-8333-333333333333',
  scenePlanVersion:2,
  scriptId:'44444444-4444-4444-8444-444444444444',
  voiceAssetId:'55555555-5555-4555-8555-555555555555',
  visualPromptSetId:'66666666-6666-4666-8666-666666666666',
  visualPromptSetVersion:3,
  version:4,
  status:'approved',
  format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
  durationSeconds:6,
  tracks:[
    {
      id:'77777777-7777-4777-8777-777777777777',type:'visual',name:'Visual',locked:false,muted:false,
      clips:[
        {id:'88888888-8888-4888-8888-888888888888',sceneId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',assetId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',clipKind:'image',label:'Scene 001',startSeconds:0,endSeconds:3,durationSeconds:3,sourceStartSeconds:null,sourceEndSeconds:null,fit:'cover',playback:'hold',volume:1,muted:false},
        {id:'99999999-9999-4999-8999-999999999999',sceneId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',assetId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',clipKind:'video',label:'Scene 002',startSeconds:3,endSeconds:6,durationSeconds:3,sourceStartSeconds:0,sourceEndSeconds:3,fit:'cover',playback:'trim',volume:1,muted:false}
      ]
    },
    {
      id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',type:'voice',name:'Narration',locked:true,muted:false,
      clips:[
        {id:'ffffffff-ffff-4fff-8fff-ffffffffffff',assetId:'55555555-5555-4555-8555-555555555555',clipKind:'audio',label:'Narration',startSeconds:0,endSeconds:6,durationSeconds:6,sourceStartSeconds:0,sourceEndSeconds:6,fit:'contain',playback:'trim',volume:1,muted:false}
      ]
    }
  ],
  review:{notes:''},
  createdAt:now,
  updatedAt:now
} as Timeline;

const transcript={
  kind:'transcript',
  id:'12121212-1212-4212-8212-121212121212',
  channelId:timeline.channelId,
  episodeId:timeline.episodeId,
  scriptId:timeline.scriptId,
  voiceAssetId:timeline.voiceAssetId,
  sourceType:'imported',
  text:'First line. Second line.',
  words:[],
  segments:[
    {id:'13131313-1313-4313-8313-131313131313',startSeconds:0,endSeconds:2.8,text:'First line.',wordIds:[]},
    {id:'14141414-1414-4414-8414-141414141414',startSeconds:3,endSeconds:null,text:'Second line.',wordIds:[]}
  ],
  scriptMatchScore:1,
  scriptVersion:1,
  voiceTake:1,
  provenance:{importedBy:'operator'},
  review:{scriptMismatchOverride:false,notes:''},
  version:2,
  status:'approved',
  createdAt:now,
  updatedAt:now
} as Transcript;

function edit():VideoEditPayload{
  return buildInitialVideoEdit(timeline,transcript);
}

test('Video Editor creates one style per visual clip and captions from transcript',()=>{
  const value=edit();
  assert.equal(value.clipStyles.length,2);
  assert.equal(value.captions.cues.length,2);
  assert.equal(value.captions.cues[0].text,'First line.');
  assert.equal(value.captions.cues[1].endSeconds,6);
  assert.equal(value.timelineVersion,timeline.version);
  assert.equal(value.transcriptVersion,transcript.version);
});

test('Video Editor motion presets are deterministic',()=>{
  assert.deepEqual(motionPresetValues('zoom-in'),{
    scaleStart:1,scaleEnd:1.08,xStart:0,xEnd:0,yStart:0,yEnd:0
  });
  assert.deepEqual(motionPresetValues('pan-left'),{
    scaleStart:1.08,scaleEnd:1.08,xStart:.04,xEnd:-.04,yStart:0,yEnd:0
  });
});

test('Fresh default Video Edit has no structural blockers',()=>{
  assert.deepEqual(videoEditStructuralIssues(edit(),timeline,transcript),[]);
});

test('Video Editor blocks excessive transitions',()=>{
  const value=edit();
  value.clipStyles[0]={...value.clipStyles[0],transitionIn:'fade',transitionSeconds:2};
  assert.ok(videoEditStructuralIssues(value,timeline,transcript).includes('transition-too-long'));
});

test('Video Editor blocks duplicate and orphan clip styles',()=>{
  const value=edit();
  value.clipStyles.push({...value.clipStyles[0]});
  const issues=videoEditStructuralIssues(value,timeline,transcript);
  assert.ok(issues.includes('duplicate-clip-style'));

  value.clipStyles=value.clipStyles.filter((_,index)=>index!==0);
  value.clipStyles[0]={...value.clipStyles[0],timelineClipId:'15151515-1515-4515-8515-151515151515'};
  const orphan=videoEditStructuralIssues(value,timeline,transcript);
  assert.ok(orphan.includes('orphan-clip-style'));
  assert.ok(orphan.includes('missing-clip-style'));
});

test('Video Editor detects invalid captions and overlays',()=>{
  const value=edit();
  value.captions.cues[1]={...value.captions.cues[1],startSeconds:2.5};
  value.overlays=[{
    id:'16161616-1616-4616-8616-161616161616',
    type:'text',text:'Overlay',startSeconds:1,endSeconds:7,
    x:.8,y:.9,width:.4,height:.2,opacity:1,fontSize:50
  }];
  const issues=videoEditStructuralIssues(normalizeVideoEdit(value),timeline,transcript);
  assert.ok(issues.includes('caption-overlap'));
  assert.ok(issues.includes('overlay-outside-timeline'));
  assert.ok(issues.includes('overlay-outside-frame'));
});

test('Video Editor upstream gate detects Timeline and Transcript version changes',()=>{
  const value=edit();
  const newerTimeline={...timeline,version:timeline.version+1};
  const newerTranscript={...transcript,version:transcript.version+1};
  const issues=videoEditUpstreamIssues({edit:value,timeline:newerTimeline,transcript:newerTranscript});
  assert.ok(issues.includes('stale-timeline-version'));
  assert.ok(issues.includes('stale-transcript-version'));
});

test('Video Editor approval combines structural and upstream blockers',()=>{
  const value=edit();
  const notApproved={...timeline,status:'review' as const};
  const issues=videoEditApprovalIssues(value,notApproved,transcript);
  assert.deepEqual(issues,['timeline-not-approved']);
});

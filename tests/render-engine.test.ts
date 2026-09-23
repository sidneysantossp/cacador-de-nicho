import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { RenderManifest, Timeline, Transcript, VideoEdit } from '../src/lib/types';
import {
  boundaryTransition, renderManifestIssues, renderOutputPath,
  validRenderAudioBitrate, validRenderCrf
} from '../src/lib/render-policy';

const now='2026-09-23T23:00:00.000Z';

const timeline={
  kind:'timeline',
  id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scenePlanId:'33333333-3333-4333-8333-333333333333',
  scenePlanVersion:1,
  scriptId:'44444444-4444-4444-8444-444444444444',
  voiceAssetId:'55555555-5555-4555-8555-555555555555',
  visualPromptSetId:'66666666-6666-4666-8666-666666666666',
  visualPromptSetVersion:1,
  version:2,
  status:'approved',
  format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
  durationSeconds:6,
  tracks:[],
  review:{notes:''},
  createdAt:now,updatedAt:now
} as Timeline;

const transcript={
  kind:'transcript',
  id:'77777777-7777-4777-8777-777777777777',
  channelId:timeline.channelId,episodeId:timeline.episodeId,
  scriptId:timeline.scriptId,voiceAssetId:timeline.voiceAssetId,
  sourceType:'imported',text:'Test',words:[],segments:[],
  scriptMatchScore:1,scriptVersion:1,voiceTake:1,
  provenance:{importedBy:'operator'},review:{scriptMismatchOverride:false,notes:''},
  version:3,status:'approved',createdAt:now,updatedAt:now
} as Transcript;

const edit={
  kind:'video-edit',
  id:'88888888-8888-4888-8888-888888888888',
  channelId:timeline.channelId,episodeId:timeline.episodeId,
  timelineId:timeline.id,timelineVersion:timeline.version,
  transcriptId:transcript.id,transcriptVersion:transcript.version,
  format:{...timeline.format},durationSeconds:6,
  clipStyles:[],captions:{enabled:false,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,cues:[]},
  overlays:[],audioMix:{voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true},
  review:{notes:''},version:4,status:'approved',createdAt:now,updatedAt:now
} as VideoEdit;

function manifest():RenderManifest{
  const firstStyle={
    timelineClipId:'99999999-9999-4999-8999-999999999999',
    sceneId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    motionPreset:'none' as const,scaleStart:1,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0,
    transitionIn:'none' as const,transitionOut:'cross-dissolve' as const,transitionSeconds:.4
  };
  const secondStyle={
    timelineClipId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sceneId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    motionPreset:'zoom-in' as const,scaleStart:1,scaleEnd:1.08,xStart:0,xEnd:0,yStart:0,yEnd:0,
    transitionIn:'cross-dissolve' as const,transitionOut:'none' as const,transitionSeconds:.4
  };
  return {
    videoEditId:edit.id,videoEditVersion:edit.version,
    timelineId:timeline.id,timelineVersion:timeline.version,
    transcriptId:transcript.id,transcriptVersion:transcript.version,
    format:{...edit.format},durationSeconds:6,
    visualClips:[
      {
        clipId:firstStyle.timelineClipId,sceneId:firstStyle.sceneId,
        assetId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',kind:'image',
        storagePath:'channels/x/a.png',mimeType:'image/png',
        startSeconds:0,endSeconds:3,durationSeconds:3,
        sourceStartSeconds:null,sourceEndSeconds:null,playback:'hold',fit:'cover',style:firstStyle
      },
      {
        clipId:secondStyle.timelineClipId,sceneId:secondStyle.sceneId,
        assetId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',kind:'video',
        storagePath:'channels/x/b.mp4',mimeType:'video/mp4',
        startSeconds:3,endSeconds:6,durationSeconds:3,
        sourceStartSeconds:0,sourceEndSeconds:3,playback:'trim',fit:'cover',style:secondStyle
      }
    ],
    voice:{assetId:timeline.voiceAssetId,storagePath:'channels/x/voice.mp3',mimeType:'audio/mpeg'},
    captions:structuredClone(edit.captions),
    overlays:[],
    audioMix:structuredClone(edit.audioMix)
  };
}

test('Render Engine validates bounded output settings',()=>{
  assert.equal(validRenderCrf(18),true);
  assert.equal(validRenderCrf(30),true);
  assert.equal(validRenderCrf(17),false);
  assert.equal(validRenderCrf(20.5),false);
  assert.equal(validRenderAudioBitrate(96),true);
  assert.equal(validRenderAudioBitrate(320),true);
  assert.equal(validRenderAudioBitrate(321),false);
});

test('Render output path is immutable per edit version and job',()=>{
  assert.equal(
    renderOutputPath({
      channelId:timeline.channelId,episodeId:timeline.episodeId,
      videoEditId:edit.id,videoEditVersion:4,
      jobId:'ffffffff-ffff-4fff-8fff-ffffffffffff'
    }),
    'channels/'+timeline.channelId+'/episodes/'+timeline.episodeId+
      '/renders/'+edit.id+'/v0004/ffffffff-ffff-4fff-8fff-ffffffffffff.mp4'
  );
});

test('Fresh Render manifest has no preflight blockers',()=>{
  assert.deepEqual(renderManifestIssues(manifest(),edit,timeline,transcript),[]);
});

test('Render manifest blocks source gaps and unsafe motion scale',()=>{
  const value=manifest();
  value.visualClips[1]={...value.visualClips[1],startSeconds:3.5};
  value.visualClips[0]={...value.visualClips[0],style:{...value.visualClips[0].style,scaleEnd:.9}};
  const issues=renderManifestIssues(value,edit,timeline,transcript);
  assert.ok(issues.includes('render-visual-gap'));
  assert.ok(issues.includes('render-scale-below-frame'));
});

test('Render cross-dissolve uses bounded scene duration',()=>{
  const value=manifest();
  assert.deepEqual(boundaryTransition(value.visualClips[0],value.visualClips[1]),{
    kind:'cross-dissolve',duration:.4
  });
  value.visualClips[0].style.transitionSeconds=9;
  value.visualClips[1].style.transitionSeconds=9;
  assert.equal(boundaryTransition(value.visualClips[0],value.visualClips[1]).duration,1.5);
});

test('Render worker script is valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/render-worker.mjs'],{stdio:'pipe'});
});

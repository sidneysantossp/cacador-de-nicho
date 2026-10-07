import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { RenderManifest, Timeline, Transcript, VideoEdit } from '../src/lib/types';
import {
  boundaryTransition, buildRenderChapterPlan, MAX_RENDER_CLIPS_PER_UNIT, renderEncoderPreset, renderManifestIssues, renderOutputPath,
  renderPresetDefaultCrf, renderPresetOutput, validRenderAudioBitrate, validRenderCrf
} from '../src/lib/render-policy';

const now='2026-09-23T23:00:00.000Z';

const timeline={
  kind:'timeline',id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scenePlanId:'33333333-3333-4333-8333-333333333333',scenePlanVersion:1,
  scriptId:'44444444-4444-4444-8444-444444444444',
  voiceAssetId:'55555555-5555-4555-8555-555555555555',
  visualPromptSetId:'66666666-6666-4666-8666-666666666666',visualPromptSetVersion:1,
  version:2,status:'approved',format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
  durationSeconds:6,tracks:[],review:{notes:''},createdAt:now,updatedAt:now
} as Timeline;

const transcript={
  kind:'transcript',id:'77777777-7777-4777-8777-777777777777',
  channelId:timeline.channelId,episodeId:timeline.episodeId,
  scriptId:timeline.scriptId,voiceAssetId:timeline.voiceAssetId,
  sourceType:'imported',text:'Test',words:[],segments:[],
  scriptMatchScore:1,scriptVersion:1,voiceTake:1,
  provenance:{importedBy:'operator'},review:{scriptMismatchOverride:false,notes:''},
  version:3,status:'approved',createdAt:now,updatedAt:now
} as Transcript;

const edit={
  kind:'video-edit',id:'88888888-8888-4888-8888-888888888888',
  channelId:timeline.channelId,episodeId:timeline.episodeId,
  timelineId:timeline.id,timelineVersion:timeline.version,
  transcriptId:transcript.id,transcriptVersion:transcript.version,
  format:{...timeline.format},durationSeconds:6,clipStyles:[],
  captions:{
    enabled:false,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,
    styleDescription:'',style:{
      fontFamily:'DejaVu Sans',fontWeight:800,primaryColor:'#FFFFFF',highlightColor:'#F4C95D',
      outlineColor:'#000000',outlineWidth:2,uppercase:false,maxWordsPerLine:6,
      smartBreaks:true,highlightMode:'none',safeMarginPercent:6
    },cues:[]
  },
  overlays:[],audioMix:{voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true},
  musicTrack:null,sfxEvents:[],
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
    music:null,sfxEvents:[],
    captions:structuredClone(edit.captions),overlays:[],audioMix:structuredClone(edit.audioMix)
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

test('Render-v3 presets preserve orientation and explicit fps',()=>{
  assert.deepEqual(
    renderPresetOutput('source',{width:1440,height:1080,fps:24}),
    {width:1440,height:1080,fps:24}
  );
  assert.deepEqual(
    renderPresetOutput('hd-1080p30',{width:1920,height:1080,fps:60}),
    {width:1920,height:1080,fps:30}
  );
  assert.deepEqual(
    renderPresetOutput('hd-1080p30',{width:1080,height:1920,fps:60}),
    {width:1080,height:1920,fps:30}
  );
  assert.deepEqual(
    renderPresetOutput('draft-720p30',{width:1080,height:1920,fps:30}),
    {width:720,height:1280,fps:30}
  );
});

test('Render output path is immutable per edit version and job',()=>{
  assert.equal(
    renderOutputPath({channelId:timeline.channelId,episodeId:timeline.episodeId,videoEditId:edit.id,videoEditVersion:4,jobId:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),
    'channels/'+timeline.channelId+'/episodes/'+timeline.episodeId+'/renders/'+edit.id+'/v0004/ffffffff-ffff-4fff-8fff-ffffffffffff.mp4'
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

test('Render-v2 accepts a consistent music and SFX snapshot',()=>{
  const edited=structuredClone(edit);
  edited.musicTrack={
    assetId:'12111111-1111-4111-8111-111111111111',startSeconds:0,endSeconds:6,sourceStartSeconds:0,
    loop:true,volume:.8,fadeInSeconds:.5,fadeOutSeconds:.5,duckUnderVoice:true,duckingStrength:.7
  };
  edited.sfxEvents=[{
    id:'13111111-1111-4111-8111-111111111111',
    assetId:'14111111-1111-4111-8111-111111111111',eventType:'custom',
    startSeconds:1,sourceStartSeconds:0,durationSeconds:.3,volume:.7
  }];
  const value=manifest();
  value.music={
    assetId:edited.musicTrack.assetId,storagePath:'channels/x/music.mp3',mimeType:'audio/mpeg',
    durationSeconds:2,placement:structuredClone(edited.musicTrack)
  };
  value.sfxEvents=[{
    event:structuredClone(edited.sfxEvents[0]),assetId:edited.sfxEvents[0].assetId,
    storagePath:'channels/x/pop.wav',mimeType:'audio/wav',durationSeconds:.5
  }];
  assert.deepEqual(renderManifestIssues(value,edited,timeline,transcript),[]);
});

test('Render-v2 blocks short non-loop music and short SFX source',()=>{
  const edited=structuredClone(edit);
  edited.musicTrack={
    assetId:'12111111-1111-4111-8111-111111111111',startSeconds:0,endSeconds:6,sourceStartSeconds:0,
    loop:false,volume:1,fadeInSeconds:.5,fadeOutSeconds:.5,duckUnderVoice:true,duckingStrength:.5
  };
  edited.sfxEvents=[{
    id:'13111111-1111-4111-8111-111111111111',
    assetId:'14111111-1111-4111-8111-111111111111',eventType:'custom',
    startSeconds:1,sourceStartSeconds:.3,durationSeconds:.5,volume:.7
  }];
  const value=manifest();
  value.music={
    assetId:edited.musicTrack.assetId,storagePath:'channels/x/music.mp3',mimeType:'audio/mpeg',
    durationSeconds:2,placement:structuredClone(edited.musicTrack)
  };
  value.sfxEvents=[{
    event:structuredClone(edited.sfxEvents[0]),assetId:edited.sfxEvents[0].assetId,
    storagePath:'channels/x/pop.wav',mimeType:'audio/wav',durationSeconds:.6
  }];
  const issues=renderManifestIssues(value,edited,timeline,transcript);
  assert.ok(issues.includes('render-music-source-too-short'));
  assert.ok(issues.includes('render-sfx-source-too-short'));
});

test('Render cross-dissolve uses bounded scene duration',()=>{
  const value=manifest();
  assert.deepEqual(boundaryTransition(value.visualClips[0],value.visualClips[1]),{kind:'cross-dissolve',duration:.4});
  value.visualClips[0].style.transitionSeconds=9;
  value.visualClips[1].style.transitionSeconds=9;
  assert.equal(boundaryTransition(value.visualClips[0],value.visualClips[1]).duration,1.5);
});

test('Render worker script is valid Node ESM syntax',()=>{
  execFileSync(process.execPath,['--check','scripts/render-worker.mjs'],{stdio:'pipe'});
});



test('Render worker prefers self-hosted database and local provider vault',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/process\.env\.DATABASE_API_URL\|\|process\.env\.SUPABASE_URL/);
  assert.match(source,/process\.env\.DATABASE_SERVICE_ROLE_KEY\|\|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source,/fetch\(DATABASE_URL\+pathname/);
  assert.match(source,/radar_provider_secrets\?provider=eq\./);
  assert.match(source,/createDecipheriv\('aes-256-gcm'/);
  assert.match(source,/process\.env\.DATABASE_API_URL[\s\S]*localProviderSecret\('r2'\)/);
  assert.match(source,/SUPABASE_STORAGE_URL\+'\/storage\/v1\/object\/'/);
});

test('Self-hosted render worker joins the infra network',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-render-worker-sync'),'utf8');
  assert.match(source,/--network cacadores-infra/);
});

test('Render manifest validates normalized documentary focus coordinates',()=>{
  const value=manifest();
  value.visualClips[0]={...value.visualClips[0],focusX:.2,focusY:.8};
  assert.deepEqual(renderManifestIssues(value,edit,timeline,transcript),[]);
  value.visualClips[0].focusX=1.2;
  assert.ok(renderManifestIssues(value,edit,timeline,transcript).includes('render-focus-x-invalid'));
});


test('Render-v4 chapter manifest covers every visual scene exactly once',()=>{
  const value=manifest();
  value.chapters=[
    {
      id:'15111111-1111-4111-8111-111111111111',sequence:1,label:'Chapter 01',
      startSeconds:0,endSeconds:3,durationSeconds:3,
      sceneIds:[value.visualClips[0].sceneId]
    },
    {
      id:'16111111-1111-4111-8111-111111111111',sequence:2,label:'Chapter 02',
      startSeconds:3,endSeconds:6,durationSeconds:3,
      sceneIds:[value.visualClips[1].sceneId]
    }
  ];
  assert.deepEqual(renderManifestIssues(value,edit,timeline,transcript),[]);
  value.chapters[1].sceneIds=[];
  assert.ok(renderManifestIssues(value,edit,timeline,transcript).includes('render-chapter-missing-scene'));
});

test('Render-v4 chapter manifest blocks temporal gaps and duplicate scene membership',()=>{
  const value=manifest();
  value.chapters=[
    {
      id:'17111111-1111-4111-8111-111111111111',sequence:1,label:'Chapter 01',
      startSeconds:0,endSeconds:3,durationSeconds:3,
      sceneIds:[value.visualClips[0].sceneId]
    },
    {
      id:'18111111-1111-4111-8111-111111111111',sequence:2,label:'Chapter 02',
      startSeconds:3.5,endSeconds:6,durationSeconds:2.5,
      sceneIds:[value.visualClips[0].sceneId,value.visualClips[1].sceneId]
    }
  ];
  const issues=renderManifestIssues(value,edit,timeline,transcript);
  assert.ok(issues.includes('render-chapter-gap'));
  assert.ok(issues.includes('render-chapter-duplicate-scene'));
});


test('Render-v4 chapter boundaries do not inject artificial fades',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/style\.transitionIn==='cross-dissolve'/);
  assert.match(source,/style\.transitionOut==='cross-dissolve'/);
  assert.doesNotMatch(source,/style\.transitionIn='fade';/);
  assert.doesNotMatch(source,/style\.transitionOut='fade';/);
  assert.match(source,/render-v4-concat-copy-fallback/);
});


function longRenderManifest():{
  manifest:RenderManifest;
  edit:VideoEdit;
  timeline:Timeline;
  transcript:Transcript;
}{
  const duration=3600;
  const sceneSeconds=6;
  const sceneCount=600;
  const wordsPerScene=20;
  const sceneIds=Array.from({length:sceneCount},(_,index)=>
    '2'+String(index+1).padStart(7,'0')+'-1111-4111-8111-'+String(index+1).padStart(12,'0')
  );
  const visualClips=sceneIds.map((sceneId,index)=>{
    const start=index*sceneSeconds;
    const clipId='3'+String(index+1).padStart(7,'0')+'-1111-4111-8111-'+String(index+1).padStart(12,'0');
    return {
      clipId,
      sceneId,
      assetId:'4'+String(index+1).padStart(7,'0')+'-1111-4111-8111-'+String(index+1).padStart(12,'0'),
      kind:'image' as const,
      storagePath:'channels/long/assets/'+String(index+1)+'.jpg',
      mimeType:'image/jpeg',
      startSeconds:start,
      endSeconds:start+sceneSeconds,
      durationSeconds:sceneSeconds,
      sourceStartSeconds:null,
      sourceEndSeconds:null,
      playback:'hold' as const,
      fit:'cover' as const,
      style:{
        timelineClipId:clipId,
        sceneId,
        motionPreset:'none' as const,
        scaleStart:1,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0,
        transitionIn:'none' as const,transitionOut:'none' as const,transitionSeconds:0
      }
    };
  });
  const captions={
    ...structuredClone(edit.captions),
    enabled:true,
    cues:sceneIds.map((_,sceneIndex)=>{
      const start=sceneIndex*sceneSeconds;
      const words=Array.from({length:wordsPerScene},(_,wordIndex)=>{
        const offset=wordIndex*(sceneSeconds/wordsPerScene);
        return {
          id:'5'+String(sceneIndex*wordsPerScene+wordIndex+1).padStart(7,'0')+
            '-1111-4111-8111-'+String(sceneIndex*wordsPerScene+wordIndex+1).padStart(12,'0'),
          text:'word'+String(sceneIndex*wordsPerScene+wordIndex+1),
          startSeconds:start+offset,
          endSeconds:start+offset+.25,
          highlighted:false
        };
      });
      return {
        id:'6'+String(sceneIndex+1).padStart(7,'0')+'-1111-4111-8111-'+String(sceneIndex+1).padStart(12,'0'),
        transcriptSegmentId:'7'+String(sceneIndex+1).padStart(7,'0')+'-1111-4111-8111-'+String(sceneIndex+1).padStart(12,'0'),
        startSeconds:start,
        endSeconds:start+sceneSeconds,
        text:words.map(word=>word.text).join(' '),
        words
      };
    })
  };
  const chapters=Array.from({length:6},(_,index)=>({
    id:'8'+String(index+1).padStart(7,'0')+'-1111-4111-8111-'+String(index+1).padStart(12,'0'),
    sequence:index+1,
    label:'Chapter '+String(index+1).padStart(2,'0'),
    startSeconds:index*600,
    endSeconds:(index+1)*600,
    durationSeconds:600,
    sceneIds:sceneIds.slice(index*100,(index+1)*100)
  }));
  const longEdit={...structuredClone(edit),durationSeconds:duration,captions} as VideoEdit;
  const longTimeline={...structuredClone(timeline),durationSeconds:duration} as Timeline;
  const longTranscript={...structuredClone(transcript)} as Transcript;
  const value:RenderManifest={
    videoEditId:longEdit.id,videoEditVersion:longEdit.version,
    timelineId:longTimeline.id,timelineVersion:longTimeline.version,
    transcriptId:longTranscript.id,transcriptVersion:longTranscript.version,
    format:{...longEdit.format},durationSeconds:duration,chapters,visualClips,
    voice:{assetId:longTimeline.voiceAssetId,storagePath:'channels/long/voice.mp3',mimeType:'audio/mpeg'},
    music:null,sfxEvents:[],captions,overlays:[],audioMix:structuredClone(longEdit.audioMix)
  };
  return {manifest:value,edit:longEdit,timeline:longTimeline,transcript:longTranscript};
}

test('Render-v4 compiles a 60-minute 600-clip plan into memory-bounded stable render units',()=>{
  const started=performance.now();
  const fixture=longRenderManifest();
  assert.deepEqual(
    renderManifestIssues(fixture.manifest,fixture.edit,fixture.timeline,fixture.transcript),
    []
  );
  const first=buildRenderChapterPlan({manifest:fixture.manifest,preset:'source',crf:20});
  assert.equal(first.length,60);
  assert.ok(first.every(chapter=>chapter.sceneIds.length<=MAX_RENDER_CLIPS_PER_UNIT));
  assert.ok(first.every(chapter=>chapter.durationSeconds<=60.001));
  assert.ok(first.every(chapter=>/^[a-f0-9]{64}$/.test(chapter.contentHash)));
  assert.ok(first.every(chapter=>/^[a-f0-9-]{36}$/.test(chapter.id)));

  const changed=structuredClone(fixture.manifest);
  changed.visualClips[350]={
    ...changed.visualClips[350],
    assetId:'99999999-9999-4999-8999-999999999999',
    storagePath:'channels/long/assets/replacement.jpg'
  };
  const second=buildRenderChapterPlan({manifest:changed,preset:'source',crf:20});
  const changedIndexes=first
    .map((chapter,index)=>chapter.contentHash===second[index].contentHash?null:index)
    .filter((index):index is number=>index!==null);
  assert.deepEqual(changedIndexes,[35]);

  const elapsedMs=performance.now()-started;
  assert.ok(elapsedMs<5000,'60-minute render plan exceeded 5s: '+elapsedMs.toFixed(0)+'ms');
});


test('Render-v4 splits an oversized editorial chapter without changing small chapters',()=>{
  const fixture=longRenderManifest();
  const oversized={...fixture.manifest,chapters:[{
    id:'8fffffff-1111-4111-8111-111111111111',
    sequence:1,label:'One editorial chapter',
    startSeconds:0,endSeconds:fixture.manifest.durationSeconds,
    durationSeconds:fixture.manifest.durationSeconds,
    sceneIds:fixture.manifest.visualClips.map(clip=>clip.sceneId)
  }]};
  const units=buildRenderChapterPlan({manifest:oversized,preset:'source',crf:20});
  assert.equal(units.length,60);
  assert.ok(units.every(unit=>unit.sceneIds.length<=10));

  const small={...fixture.manifest,visualClips:fixture.manifest.visualClips.slice(0,5),chapters:[{
    id:'8eeeeeee-1111-4111-8111-111111111111',
    sequence:1,label:'Small chapter',
    startSeconds:0,endSeconds:30,durationSeconds:30,
    sceneIds:fixture.manifest.visualClips.slice(0,5).map(clip=>clip.sceneId)
  }]};
  const smallUnits=buildRenderChapterPlan({manifest:small,preset:'source',crf:20});
  assert.equal(smallUnits.length,1);
  assert.equal(smallUnits[0].id,'8eeeeeee-1111-4111-8111-111111111111');
});

test('Draft render uses an ultrafast encoder profile while final presets stay medium',()=>{
  assert.equal(renderEncoderPreset('draft-720p30'),'ultrafast');
  assert.equal(renderEncoderPreset('source'),'medium');
  assert.equal(renderEncoderPreset('hd-1080p30'),'medium');
});

test('Render-v4 chapter cache hash separates draft and final encoder profiles',()=>{
  const value=manifest();
  value.chapters=[{
    id:'19111111-1111-4111-8111-111111111111',
    sequence:1,label:'Chapter 01',
    startSeconds:0,endSeconds:6,durationSeconds:6,
    sceneIds:value.visualClips.map(clip=>clip.sceneId)
  }];
  const draft=buildRenderChapterPlan({manifest:value,preset:'draft-720p30',crf:24});
  const final=buildRenderChapterPlan({manifest:value,preset:'hd-1080p30',crf:24});
  assert.notEqual(draft[0].contentHash,final[0].contentHash);
});


test('Render presets choose lean draft quality without changing final quality',()=>{
  assert.equal(renderPresetDefaultCrf('draft-720p30'),28);
  assert.equal(renderPresetDefaultCrf('source'),20);
  assert.equal(renderPresetDefaultCrf('hd-1080p30'),20);
  assert.equal(validRenderCrf(renderPresetDefaultCrf('draft-720p30')),true);
});


test('Render worker registers a stable node identity without replacing skip-locked claiming',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/RENDER_WORKER_ID/);
  assert.match(source,/radar_render_workers\?on_conflict=id/);
  assert.match(source,/p_worker_id:WORKER_ID/);
  assert.match(source,/rpc\('claim_render_job'/);
  assert.doesNotMatch(source,/updateOwned\(String\(jobId\),token,\{worker_id:WORKER_ID\}\)/);
  assert.match(source,/touchRenderWorker\('busy'/);
});

test('Self-hosted render sync propagates stable node identity and declared capacity',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-render-worker-sync'),'utf8');
  assert.match(source,/WORKER_ID=.*hostname -s/);
  assert.match(source,/RENDER_WORKER_ID=\$WORKER_ID/);
  assert.match(source,/RENDER_WORKER_MEMORY_BYTES=\$TARGET_MEMORY/);
  assert.match(source,/auditseo\.render\.worker-id=\$WORKER_ID/);
});


test('Render worker streams large media instead of buffering files in memory',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/createReadStream/);
  assert.match(source,/createWriteStream/);
  assert.match(source,/pipeline/);
  assert.match(source,/Readable\.fromWeb/);
  assert.match(source,/ContentLength:info\.size/);
  assert.doesNotMatch(source,/transformToByteArray\(\)/);
  assert.doesNotMatch(source,/response\.arrayBuffer\(\)/);
  assert.doesNotMatch(source,/readFile\(filePath\)/);
});

test('Render worker uses bounded R2 multipart uploads and lease keepalive for long IO',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/CreateMultipartUploadCommand/);
  assert.match(source,/UploadPartCommand/);
  assert.match(source,/CompleteMultipartUploadCommand/);
  assert.match(source,/AbortMultipartUploadCommand/);
  assert.match(source,/R2_MULTIPART_PART_BYTES/);
  assert.match(source,/withLeaseHeartbeat/);
  assert.match(source,/RENDER_IO_HEARTBEAT_MS/);
  assert.match(source,/uploading-cache-chapter-/);
  assert.match(source,/downloading-cache-chapter-/);
  assert.match(source,/uploading-output/);
});


test('Render-v4 frees chapter and visual intermediates before the next heavy copy',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  const concat=source.indexOf('await concatChapterVideos(chapterPaths,visualMaster,root,payload);');
  const removeChapters=source.indexOf("await rm(chapterDir,{recursive:true,force:true});",concat);
  const mux=source.indexOf('await muxAudio(muxManifest,visualMaster,audioPaths,finalPath,payload);',removeChapters);
  const removeVisual=source.indexOf("await rm(visualMaster,{force:true});",mux);
  const upload=source.indexOf("jobId,token,97,'uploading-output'",removeVisual);
  assert.ok(concat>=0&&removeChapters>concat,'chapter scratch must be removed after concat');
  assert.ok(mux>removeChapters,'mux must start after chapter cleanup');
  assert.ok(removeVisual>mux,'visual master must be removed after mux');
  assert.ok(upload>removeVisual,'final upload must begin after visual scratch cleanup');
});

test('Render-v4 reserves free disk for the next intermediate file',()=>{
  const source=readFileSync(resolve(process.cwd(),'scripts/render-worker.mjs'),'utf8');
  assert.match(source,/function renderDiskReady\(requiredAdditionalBytes=0\)/);
  assert.match(source,/const requiredBytes=MIN_FREE_DISK_BYTES\+extra/);
  assert.match(source,/renderDiskReady\(chapterBytes\)/);
  assert.match(source,/renderDiskReady\(visualMasterInfo\.size\)/);
  assert.match(source,/insufficient-render-disk-for-concat/);
  assert.match(source,/insufficient-render-disk-for-mux/);
});


test('Portable render node bootstrap is syntax-valid and render-only',()=>{
  const file=resolve(process.cwd(),'ops/self-hosted/bin/cacadores-render-node-bootstrap');
  execFileSync('bash',['-n',file],{stdio:'pipe'});
  const source=readFileSync(file,'utf8');
  assert.match(source,/SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source,/CACADORES_RENDER_WORKER_ID/);
  assert.match(source,/CACADORES_RENDER_REF/);
  assert.match(source,/CACADORES_RENDER_IMAGE/);
  assert.match(source,/CACADORES_RENDER_SHA is required/);
  assert.match(source,/HOST_MIN_MEMORY_GB/);
  assert.match(source,/HOST_MIN_CPUS/);
  assert.match(source,/HOST_MIN_FREE_DISK_GB/);
  assert.match(source,/RENDER_MIN_FREE_DISK_GB/);
  assert.match(source,/node scripts\/render-worker\.mjs/);
  assert.doesNotMatch(source,/server\.js/);
  assert.doesNotMatch(source,/episode-automation-worker/);
  assert.doesNotMatch(source,/verified-stock-worker/);
});

test('Portable render node documentation never embeds service-role credentials',()=>{
  const source=readFileSync(resolve(process.cwd(),'docs/render-node-bootstrap.md'),'utf8');
  assert.match(source,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source,/R2 credentials are not copied/);
  assert.doesNotMatch(source,/eyJ[a-zA-Z0-9_-]{20,}/);
  assert.match(source,/exact-git-sha/);
});


test('Render asset lookup batches large PostgREST filters',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/render-engine.ts'),'utf8');
  assert.match(source,/for\(let start=0;start<unique\.length;start\+=80\)/);
  assert.match(source,/const batch=unique\.slice\(start,start\+80\)/);
  assert.match(source,/rows\.push\(\.\.\.\(part\?\?\[\]\)\)/);
});

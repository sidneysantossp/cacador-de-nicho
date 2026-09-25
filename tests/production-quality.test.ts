import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ProductionQualityReport, ProductionQualityTechnical, RenderJob
} from '../src/lib/types';
import {
  qualityApprovalIssues, qualityInitialStatus, qualitySummary,
  structuralQualityChecks, technicalQualityChecks
} from '../src/lib/production-quality-policy';

const now='2026-09-23T21:30:00.000Z';

function job():RenderJob{
  return {
    id:'11111111-1111-4111-8111-111111111111',
    channelId:'22222222-2222-4222-8222-222222222222',
    episodeId:'33333333-3333-4333-8333-333333333333',
    videoEditId:'44444444-4444-4444-8444-444444444444',
    videoEditVersion:3,
    status:'completed',
    progress:100,
    stage:'completed',
    attempts:1,
    outputPath:'channels/x/render.mp4',
    outputBytes:100000,
    payload:{
      preset:'source',
      videoCodec:'libx264',
      fallbackVideoCodecs:['mpeg4'],
      crf:20,
      audioCodec:'aac',
      audioBitrateKbps:192,
      outputFormat:{width:1920,height:1080,fps:30},
      compilerVersion:'render-v3',
      requestedBy:'operator',
      manifest:{
        videoEditId:'44444444-4444-4444-8444-444444444444',
        videoEditVersion:3,
        timelineId:'55555555-5555-4555-8555-555555555555',
        timelineVersion:2,
        transcriptId:'66666666-6666-4666-8666-666666666666',
        transcriptVersion:2,
        format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
        durationSeconds:6,
        visualClips:[
          {
            clipId:'71111111-1111-4111-8111-111111111111',
            sceneId:'72111111-1111-4111-8111-111111111111',
            assetId:'73111111-1111-4111-8111-111111111111',
            kind:'image',
            storagePath:'channels/x/a.png',
            mimeType:'image/png',
            startSeconds:0,endSeconds:3,durationSeconds:3,
            sourceStartSeconds:null,sourceEndSeconds:null,
            playback:'hold',fit:'cover',
            style:{
              timelineClipId:'71111111-1111-4111-8111-111111111111',
              sceneId:'72111111-1111-4111-8111-111111111111',
              motionPreset:'none',scaleStart:1,scaleEnd:1,
              xStart:0,xEnd:0,yStart:0,yEnd:0,
              transitionIn:'none',transitionOut:'none',transitionSeconds:0
            }
          },
          {
            clipId:'81111111-1111-4111-8111-111111111111',
            sceneId:'82111111-1111-4111-8111-111111111111',
            assetId:'83111111-1111-4111-8111-111111111111',
            kind:'image',
            storagePath:'channels/x/b.png',
            mimeType:'image/png',
            startSeconds:3,endSeconds:6,durationSeconds:3,
            sourceStartSeconds:null,sourceEndSeconds:null,
            playback:'hold',fit:'cover',
            style:{
              timelineClipId:'81111111-1111-4111-8111-111111111111',
              sceneId:'82111111-1111-4111-8111-111111111111',
              motionPreset:'none',scaleStart:1,scaleEnd:1,
              xStart:0,xEnd:0,yStart:0,yEnd:0,
              transitionIn:'none',transitionOut:'none',transitionSeconds:0
            }
          }
        ],
        voice:{
          assetId:'91111111-1111-4111-8111-111111111111',
          storagePath:'channels/x/voice.wav',
          mimeType:'audio/wav'
        },
        music:null,
        sfxEvents:[],
        captions:{
          enabled:false,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,
          styleDescription:'',
          style:{
            fontFamily:'DejaVu Sans',fontWeight:800,
            primaryColor:'#FFFFFF',highlightColor:'#F4C95D',outlineColor:'#000000',
            outlineWidth:2,uppercase:false,maxWordsPerLine:6,smartBreaks:true,
            highlightMode:'none',safeMarginPercent:6
          },
          cues:[]
        },
        overlays:[],
        audioMix:{
          voiceVolume:1,musicVolume:.2,sfxVolume:.7,
          normalizeVoice:true,duckMusicUnderVoice:true
        }
      }
    },
    createdAt:now,startedAt:now,completedAt:now,updatedAt:now
  };
}

function technical():ProductionQualityTechnical{
  return {
    durationSeconds:6,width:1920,height:1080,fps:30,
    videoCodec:'h264',audioCodec:'aac',sampleRate:48000,audioChannels:2,
    maxVolumeDb:-1.2,silenceSeconds:.5,silenceRatio:.0833,
    blackSeconds:.1,blackRatio:.0167,decodeOk:true
  };
}

function goodAssetFacts(){
  return [
    {
      assetId:'73111111-1111-4111-8111-111111111111',
      sceneId:'72111111-1111-4111-8111-111111111111',
      exists:true,ready:true,storagePathMatches:true,sceneMatches:true,promptAligned:true,sourceType:'uploaded',provider:'operator',licenseType:'owned',licenseLabel:'Owned'
    },
    {
      assetId:'83111111-1111-4111-8111-111111111111',
      sceneId:'82111111-1111-4111-8111-111111111111',
      exists:true,ready:true,storagePathMatches:true,sceneMatches:true,promptAligned:true,sourceType:'uploaded',provider:'operator',licenseType:'owned',licenseLabel:'Owned'
    }
  ];
}

test('Healthy render has no Production QA blockers',()=>{
  const value=job();
  const checks=[
    ...structuralQualityChecks({job:value,assetFacts:goodAssetFacts(),characterFacts:[]}),
    ...technicalQualityChecks(value,technical())
  ];
  assert.equal(checks.some(check=>check.status==='blocker'),false);
  assert.equal(checks.find(check=>check.code==='visual-coverage')?.status,'pass');
  assert.equal(checks.find(check=>check.code==='decode-integrity')?.status,'pass');
  assert.equal(checks.find(check=>check.code==='resolution-match')?.status,'pass');
  assert.equal(qualityInitialStatus(checks),'review');
  assert.equal(qualitySummary(checks).blockers,0);
});

test('Timeline gaps and incomplete visible text become blockers',()=>{
  const value=job();
  value.payload.manifest.visualClips[1]={
    ...value.payload.manifest.visualClips[1],
    startSeconds:3.7,endSeconds:6
  };
  value.payload.manifest.captions.enabled=true;
  value.payload.manifest.captions.cues=[{
    id:'a1111111-1111-4111-8111-111111111111',
    transcriptSegmentId:'a2111111-1111-4111-8111-111111111111',
    startSeconds:0,endSeconds:2,
    text:'TODO replace this',
    words:[]
  }];
  const checks=structuralQualityChecks({
    job:value,assetFacts:goodAssetFacts(),characterFacts:[]
  });
  assert.equal(checks.find(check=>check.code==='visual-coverage')?.status,'blocker');
  assert.equal(checks.find(check=>check.code==='text-placeholders')?.status,'blocker');
});

test('Technical QA blocks wrong render geometry missing audio and excessive black frames',()=>{
  const value=job();
  const bad:ProductionQualityTechnical={
    ...technical(),
    width:1280,height:720,fps:24,durationSeconds:5.4,
    audioCodec:null,sampleRate:null,audioChannels:null,
    maxVolumeDb:null,silenceSeconds:null,silenceRatio:null,
    blackSeconds:2,blackRatio:.37,decodeOk:true
  };
  const checks=technicalQualityChecks(value,bad);
  assert.equal(checks.find(check=>check.code==='resolution-match')?.status,'blocker');
  assert.equal(checks.find(check=>check.code==='fps-match')?.status,'blocker');
  assert.equal(checks.find(check=>check.code==='duration-match')?.status,'blocker');
  assert.equal(checks.find(check=>check.code==='audio-stream')?.status,'blocker');
  assert.equal(checks.find(check=>check.code==='black-frames')?.status,'blocker');
});

test('Production QA warns on excessive asset reuse without inventing a blocker',()=>{
  const value=job();
  const first=value.payload.manifest.visualClips[0];
  value.payload.manifest.visualClips=Array.from({length:5},(_,index)=>({
    ...first,
    clipId:crypto.randomUUID(),
    sceneId:crypto.randomUUID(),
    assetId:'73111111-1111-4111-8111-111111111111',
    startSeconds:index,
    endSeconds:index+1,
    durationSeconds:1,
    style:{...first.style,timelineClipId:crypto.randomUUID(),sceneId:crypto.randomUUID()}
  }));
  value.payload.manifest.durationSeconds=5;
  const facts=value.payload.manifest.visualClips.map(clip=>({
    assetId:clip.assetId,sceneId:clip.sceneId,exists:true,ready:true,
    storagePathMatches:true,sceneMatches:true,promptAligned:true
  }));
  const checks=structuralQualityChecks({job:value,assetFacts:facts,characterFacts:[]});
  assert.equal(checks.find(check=>check.code==='asset-duplication')?.status,'warning');
});

test('Unavailable visual context becomes explicit manual review instead of pass',()=>{
  const value=job();
  const facts=goodAssetFacts().map(item=>({...item,promptAligned:null,promptReason:'version context unavailable'}));
  const checks=structuralQualityChecks({job:value,assetFacts:facts});
  assert.equal(checks.find(check=>check.code==='prompt-asset-alignment')?.status,'manual-review');
  assert.equal(checks.find(check=>check.code==='character-continuity')?.status,'manual-review');
});

test('Release gate requires every manual review and never overrides blockers',()=>{
  const value=job();
  const facts=goodAssetFacts().map(item=>({...item,promptAligned:null,promptReason:'version context unavailable'}));
  const checks=structuralQualityChecks({job:value,assetFacts:facts});
  const report={
    kind:'production-quality-report',
    id:'b1111111-1111-4111-8111-111111111111',
    channelId:value.channelId,episodeId:value.episodeId,renderJobId:value.id,
    videoEditId:value.videoEditId,videoEditVersion:value.videoEditVersion,
    renderCompilerVersion:'render-v3',checkedAt:now,checks,
    summary:qualitySummary(checks),technical:technical(),
    review:{notes:'',overrides:[]},createdAt:now,updatedAt:now,
    version:1,status:'review'
  } as ProductionQualityReport;

  assert.ok(qualityApprovalIssues(report,[]).includes('manual-review-not-confirmed'));

  const manualCodes=checks
    .filter(check=>check.status==='manual-review')
    .map(check=>check.code);
  assert.deepEqual(qualityApprovalIssues(report,manualCodes),[]);

  const blocked={
    ...report,
    checks:report.checks.map((check,index)=>index===0?{...check,status:'blocker' as const}:check)
  };
  assert.ok(qualityApprovalIssues(blocked,manualCodes).includes('quality-blockers-present'));
});


test('Production Authenticity blocks assets with unknown rights',()=>{
  const value=job();
  const facts=goodAssetFacts().map((item,index)=>index===0?{...item,licenseType:'unknown',licenseLabel:'Unknown'}:item);
  const checks=structuralQualityChecks({job:value,assetFacts:facts,characterFacts:[]});
  assert.equal(checks.find(check=>check.code==='asset-rights')?.status,'blocker');
});

test('Production Authenticity blocks extreme single-asset repetition',()=>{
  const value=job();
  const first=value.payload.manifest.visualClips[0];
  value.payload.manifest.visualClips=Array.from({length:8},(_,index)=>({
    ...first,
    clipId:crypto.randomUUID(),
    sceneId:crypto.randomUUID(),
    assetId:'73111111-1111-4111-8111-111111111111',
    startSeconds:index,
    endSeconds:index+1,
    durationSeconds:1,
    style:{...first.style,timelineClipId:crypto.randomUUID(),sceneId:crypto.randomUUID()}
  }));
  value.payload.manifest.durationSeconds=8;
  const facts=value.payload.manifest.visualClips.map(clip=>({
    assetId:clip.assetId,sceneId:clip.sceneId,exists:true,ready:true,
    storagePathMatches:true,sceneMatches:true,promptAligned:true,
    sourceType:'uploaded',provider:'operator',licenseType:'owned',licenseLabel:'Owned'
  }));
  const checks=structuralQualityChecks({job:value,assetFacts:facts,characterFacts:[]});
  assert.equal(checks.find(check=>check.code==='asset-duplication')?.status,'blocker');
});

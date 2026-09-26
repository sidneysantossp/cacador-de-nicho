import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ManagedChannel, ProductionQualityReport, PublicationPackagePayload, RenderJob
} from '../src/lib/types';
import {
  inferYoutubeCategory, initialPublicationPackage, normalizePublicationTags,
  publicationPackageCanApprove, publicationPackageIssues, publicationTagCharacters
} from '../src/lib/publication-package-policy';

const now='2026-09-23T22:00:00.000Z';

const channel={
  id:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  name:'Dino Knows',niche:'AI technology future',format:'Animated explainer',
  stage:'production',priority:'high',description:'Future of humanity',
  createdAt:now,updatedAt:now
} as ManagedChannel;

const render={
  id:'11111111-1111-4111-8111-111111111111',
  channelId:channel.id,
  episodeId:'22222222-2222-4222-8222-222222222222',
  videoEditId:'33333333-3333-4333-8333-333333333333',
  videoEditVersion:3,
  status:'completed',
  progress:100,stage:'completed',attempts:1,
  outputPath:'channels/x/final.mp4',outputBytes:123456,
  payload:{
    preset:'hd-1080p30',videoCodec:'libx264',fallbackVideoCodecs:['mpeg4'],
    crf:20,audioCodec:'aac',audioBitrateKbps:192,
    outputFormat:{width:1920,height:1080,fps:30},
    compilerVersion:'render-v3',requestedBy:'operator',
    manifest:{
      videoEditId:'33333333-3333-4333-8333-333333333333',videoEditVersion:3,
      timelineId:'44444444-4444-4444-8444-444444444444',timelineVersion:2,
      transcriptId:'55555555-5555-4555-8555-555555555555',transcriptVersion:2,
      format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},durationSeconds:60,
      visualClips:[],
      voice:{assetId:'66666666-6666-4666-8666-666666666666',storagePath:'voice.mp3',mimeType:'audio/mpeg'},
      music:null,sfxEvents:[],
      captions:{
        enabled:false,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,
        styleDescription:'',style:{
          fontFamily:'DejaVu Sans',fontWeight:800,primaryColor:'#FFFFFF',
          highlightColor:'#F4C95D',outlineColor:'#000000',outlineWidth:2,
          uppercase:false,maxWordsPerLine:6,smartBreaks:true,highlightMode:'none',safeMarginPercent:6
        },cues:[]
      },
      overlays:[],audioMix:{voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true}
    }
  },
  createdAt:now,updatedAt:now,completedAt:now
} as RenderJob;

const quality={
  kind:'production-quality-report',
  id:'77777777-7777-4777-8777-777777777777',
  channelId:channel.id,episodeId:render.episodeId,renderJobId:render.id,
  videoEditId:render.videoEditId,videoEditVersion:render.videoEditVersion,
  renderCompilerVersion:'render-v3',checkedAt:now,
  checks:[],summary:{pass:18,warnings:0,blockers:0,manualReview:0},
  technical:{
    durationSeconds:60,width:1920,height:1080,fps:30,videoCodec:'h264',
    audioCodec:'aac',sampleRate:48000,audioChannels:2,maxVolumeDb:-1,
    silenceSeconds:0,silenceRatio:0,blackSeconds:0,blackRatio:0,decodeOk:true
  },
  review:{notes:'',overrides:[],approvedAt:now,approvedBy:'operator'},
  createdAt:now,updatedAt:now,version:4,status:'approved'
} as ProductionQualityReport;

function pkg():PublicationPackagePayload{
  const value=initialPublicationPackage({
    id:'88888888-8888-4888-8888-888888888888',
    channel,qualityReport:quality,renderJob:render,
    title:'Will AI Change What It Means to Be Human?',
    description:'A structured long-form episode about AI and humanity.',
    tags:['AI','Future','Humanity'],
    language:'en',
    thumbnailConcept:'Dino looking at a humanoid robot.'
  });
  value.metadata.audience='not-made-for-kids';
  value.metadata.syntheticMediaDisclosure='yes';
  value.thumbnail={
    ...value.thumbnail,source:'uploaded',
    storagePath:'channels/x/thumb.jpg',mimeType:'image/jpeg',
    originalName:'thumb.jpg',bytes:500000,width:1280,height:720
  };
  return value;
}

test('Publication category inference maps common channel niches',()=>{
  assert.equal(inferYoutubeCategory(channel),'28');
  assert.equal(inferYoutubeCategory({...channel,niche:'Pets and animals',format:'Documentary'}),'15');
  assert.equal(inferYoutubeCategory({...channel,niche:'DIY craft',format:'How to'}),'26');
  assert.equal(inferYoutubeCategory({...channel,niche:'History',format:'Explainer'}),'27');
});

test('Initial Publication Package uses safe publication defaults',()=>{
  const value=initialPublicationPackage({
    id:'88888888-8888-4888-8888-888888888888',
    channel,qualityReport:quality,renderJob:render,title:'Test'
  });
  assert.equal(value.metadata.visibility,'private');
  assert.equal(value.metadata.audience,'unset');
  assert.equal(value.metadata.syntheticMediaDisclosure,'review');
  assert.equal(value.qualityReportVersion,quality.version);
  assert.equal(value.renderOutputPath,render.outputPath);
  assert.equal(value.thumbnail.source,'none');
});

test('Publication tags are deduplicated and bounded',()=>{
  assert.deepEqual(normalizePublicationTags([' AI ','#ai','Future','future','Humanity']),['AI','Future','Humanity']);
  assert.equal(publicationTagCharacters(['AI','Future']),9);
});

test('Complete Publication Package has no blockers',()=>{
  const value=pkg();
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.deepEqual(issues,[]);
  assert.equal(publicationPackageCanApprove(value,{qualityReport:quality,renderJob:render}),true);
});

test('Publication Package blocks stale QA and changed render output',()=>{
  const value=pkg();
  const stale={...quality,version:quality.version+1};
  const changed={...render,outputPath:'channels/x/changed.mp4'};
  const issues=publicationPackageIssues(value,{qualityReport:stale,renderJob:changed});
  assert.ok(issues.some(issue=>issue.code==='quality-version-stale'&&issue.level==='blocker'));
  assert.ok(issues.some(issue=>issue.code==='render-output-mismatch'&&issue.level==='blocker'));
});

test('Publication Package requires explicit compliance selections',()=>{
  const value=pkg();
  value.metadata.audience='unset';
  value.metadata.syntheticMediaDisclosure='review';
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.ok(issues.some(issue=>issue.code==='audience-unconfirmed'));
  assert.ok(issues.some(issue=>issue.code==='synthetic-disclosure-unconfirmed'));
});

test('Publication Package enforces thumbnail constraints',()=>{
  const value=pkg();
  value.thumbnail={...value.thumbnail,width:500,height:500,bytes:51*1024*1024,mimeType:'image/webp'};
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.ok(issues.some(issue=>issue.code==='thumbnail-too-small'));
  assert.ok(issues.some(issue=>issue.code==='thumbnail-aspect-ratio'));
  assert.ok(issues.some(issue=>issue.code==='thumbnail-too-large'));
  assert.ok(issues.some(issue=>issue.code==='thumbnail-format'));
});

test('Nonstandard 16:9 thumbnail is warning but not blocker',()=>{
  const value=pkg();
  value.thumbnail={...value.thumbnail,width:1920,height:1080};
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.deepEqual(issues.map(issue=>issue.code),['thumbnail-nonstandard-size']);
  assert.equal(publicationPackageCanApprove(value,{qualityReport:quality,renderJob:render}),true);
});

test('Metadata limits become blockers',()=>{
  const value=pkg();
  value.metadata.title='x'.repeat(101);
  value.metadata.description='x'.repeat(5001);
  value.metadata.tags=Array.from({length:10},(_,i)=>('tag'+i+'x'.repeat(60)));
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.ok(issues.some(issue=>issue.code==='title-too-long'));
  assert.ok(issues.some(issue=>issue.code==='description-too-long'));
  assert.ok(issues.some(issue=>issue.code==='tags-too-long'));
});


test('Publication Package snapshots render output bytes for large-file safety',()=>{
  const value=pkg();
  assert.equal(value.renderOutputBytes,render.outputBytes);
});

test('Publication Package blocks a render byte-size mismatch when both snapshots are known',()=>{
  const value=pkg();
  value.renderOutputBytes=(render.outputBytes??0)+1;
  const issues=publicationPackageIssues(value,{qualityReport:quality,renderJob:render});
  assert.ok(issues.some(issue=>issue.code==='render-output-mismatch'));
});

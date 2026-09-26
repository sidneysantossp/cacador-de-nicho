import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AudioLibraryAsset, ProductionDNA, Timeline, Transcript, VideoEditPayload
} from '../src/lib/types';
import {
  buildCaptionCues, buildInitialVideoEdit, defaultCaptionStyle, documentaryClipStyle, motionPresetValues,
  normalizeVideoEdit, suggestSfxEvents, upgradeVideoEditPayload,
  videoEditApprovalIssues, videoEditAudioAssetIssues, videoEditStructuralIssues,
  videoEditUpstreamIssues
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

const dna={
  kind:'production-dna',channelId:timeline.channelId,version:7,
  format:{aspectRatio:'16:9',width:1920,height:1080,fps:30,targetDurationMinutes:{min:null,max:null},sceneDurationSeconds:{min:null,preferred:null,max:null}},
  visual:{styleName:'',styleDescription:'',palette:[],compositionRules:[],cameraRules:[],motionRules:[],basePrompt:'',scenePromptTemplate:'',negativePrompt:'',forbidden:[]},
  characters:[],
  voice:{language:'English',providerPreference:[],voiceId:'',voiceName:'',narrationStyle:[],paceWpm:null,pronunciationRules:[]},
  captions:{enabled:true,styleDescription:'Bold yellow keywords',position:'bottom-center',maxWordsPerCaption:4,highlightKeywords:true},
  editing:{transitions:[],defaultTransition:'cut',kenBurns:false,musicStyle:['subtle'],sfxRules:['whoosh on transitions'],pacingRules:[]},
  thumbnail:{styleRules:[],forbidden:[]},providers:{image:[],video:[],voice:[],stock:[]},
  createdAt:now,updatedAt:now
} as ProductionDNA;

function edit():VideoEditPayload{
  return buildInitialVideoEdit(timeline,transcript,dna);
}

function audioAsset(input:Partial<AudioLibraryAsset> & Pick<AudioLibraryAsset,'id'|'kind'>):AudioLibraryAsset{
  return {
    channelId:timeline.channelId,sourceType:'uploaded',provider:'external',
    status:'ready',storagePath:'channels/x/'+input.id+'.mp3',mimeType:'audio/mpeg',
    originalName:input.kind+'.mp3',bytes:1000,durationSeconds:2,bpm:null,
    favorite:false,tags:[],notes:'',license:{type:'owned',label:'Owned'},
    signedUrl:null,createdAt:now,updatedAt:now,...input,
    id:input.id,kind:input.kind
  };
}

test('Video Editor creates one style per visual clip and DNA-driven captions',()=>{
  const value=edit();
  assert.equal(value.clipStyles.length,2);
  assert.equal(value.captions.cues.length,2);
  assert.equal(value.captions.cues[0].text,'First line.');
  assert.equal(value.captions.cues[1].endSeconds,6);
  assert.equal(value.captions.styleDescription,'Bold yellow keywords');
  assert.equal(value.captions.style.highlightMode,'keywords');
  assert.equal(value.timelineVersion,timeline.version);
  assert.equal(value.transcriptVersion,transcript.version);
});

test('Caption builder preserves word timestamps, chunks and highlights keywords',()=>{
  const timed={
    ...transcript,
    text:'The future changes humanity quickly.',
    words:[
      {id:'21111111-1111-4111-8111-111111111111',text:'The',startSeconds:0,endSeconds:.25,type:'word'},
      {id:'21111111-1111-4111-8111-111111111112',text:'future',startSeconds:.25,endSeconds:.7,type:'word'},
      {id:'21111111-1111-4111-8111-111111111113',text:'changes',startSeconds:.7,endSeconds:1.1,type:'word'},
      {id:'21111111-1111-4111-8111-111111111114',text:'humanity',startSeconds:1.1,endSeconds:1.6,type:'word'},
      {id:'21111111-1111-4111-8111-111111111115',text:'quickly.',startSeconds:1.6,endSeconds:2,type:'word'}
    ],
    segments:[{
      id:'22111111-1111-4111-8111-111111111111',startSeconds:0,endSeconds:2,
      text:'The future changes humanity quickly.',
      wordIds:[
        '21111111-1111-4111-8111-111111111111','21111111-1111-4111-8111-111111111112',
        '21111111-1111-4111-8111-111111111113','21111111-1111-4111-8111-111111111114',
        '21111111-1111-4111-8111-111111111115'
      ]
    }]
  } as Transcript;
  const cues=buildCaptionCues(timed,2,{maxWordsPerCaption:3,highlightKeywords:true});
  assert.equal(cues.length,2);
  assert.equal(cues[0].words[0].startSeconds,0);
  assert.equal(cues[0].words[1].highlighted,true);
  assert.equal(cues[0].words[0].highlighted,false);
  assert.ok(cues.flatMap(cue=>cue.words).some(word=>word.text==='humanity'&&word.highlighted));
});

test('Legacy Video Edit is upgraded without changing its editorial choices',()=>{
  const fresh=edit();
  const legacy=structuredClone(fresh) as unknown as Record<string,unknown>;
  const captions=legacy.captions as Record<string,unknown>;
  delete captions.style;
  delete captions.styleDescription;
  captions.cues=(captions.cues as Array<Record<string,unknown>>).map(cue=>{
    const copy={...cue}; delete copy.words; return copy;
  });
  delete legacy.musicTrack;
  delete legacy.sfxEvents;
  const upgraded=upgradeVideoEditPayload(legacy,dna);
  assert.equal(upgraded.musicTrack,null);
  assert.deepEqual(upgraded.sfxEvents,[]);
  assert.equal(upgraded.captions.style.highlightMode,'keywords');
  assert.ok(upgraded.captions.cues.every(cue=>Array.isArray(cue.words)));
});

test('Video Editor motion presets are deterministic',()=>{
  assert.deepEqual(motionPresetValues('zoom-in'),{
    scaleStart:1,scaleEnd:1.08,xStart:0,xEnd:0,yStart:0,yEnd:0
  });
  assert.deepEqual(motionPresetValues('pan-left'),{
    scaleStart:1.08,scaleEnd:1.08,xStart:.04,xEnd:-.04,yStart:0,yEnd:0
  });
  assert.equal(defaultCaptionStyle(dna).highlightMode,'keywords');
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

test('Video Editor detects invalid captions overlays music and SFX timings',()=>{
  const value=edit();
  value.captions.cues[1]={...value.captions.cues[1],startSeconds:2.5};
  value.overlays=[{
    id:'16161616-1616-4616-8616-161616161616',
    type:'text',text:'Overlay',startSeconds:1,endSeconds:7,
    x:.8,y:.9,width:.4,height:.2,opacity:1,fontSize:50
  }];
  value.musicTrack={
    assetId:'31111111-1111-4111-8111-111111111111',startSeconds:0,endSeconds:7,
    sourceStartSeconds:0,loop:true,volume:1,fadeInSeconds:.5,fadeOutSeconds:.5,
    duckUnderVoice:true,duckingStrength:.7
  };
  value.sfxEvents=[{
    id:'32111111-1111-4111-8111-111111111111',
    assetId:'33111111-1111-4111-8111-111111111111',eventType:'custom',
    startSeconds:5.9,sourceStartSeconds:0,durationSeconds:.5,volume:.7
  }];
  const issues=videoEditStructuralIssues(normalizeVideoEdit(value),timeline,transcript);
  assert.ok(issues.includes('caption-overlap'));
  assert.ok(issues.includes('overlay-outside-timeline'));
  assert.ok(issues.includes('overlay-outside-frame'));
  assert.ok(issues.includes('music-outside-timeline'));
  assert.ok(issues.includes('sfx-outside-timeline'));
});

test('Audio asset gate distinguishes music and SFX resources',()=>{
  const value=edit();
  const music=audioAsset({id:'41111111-1111-4111-8111-111111111111',kind:'music'});
  const sfx=audioAsset({id:'42111111-1111-4111-8111-111111111111',kind:'sfx'});
  value.musicTrack={
    assetId:music.id,startSeconds:0,endSeconds:6,sourceStartSeconds:0,loop:true,
    volume:1,fadeInSeconds:.5,fadeOutSeconds:.5,duckUnderVoice:true,duckingStrength:.7
  };
  value.sfxEvents=[{
    id:'43111111-1111-4111-8111-111111111111',assetId:sfx.id,eventType:'custom',
    startSeconds:1,sourceStartSeconds:0,durationSeconds:.4,volume:.7
  }];
  assert.deepEqual(videoEditAudioAssetIssues(value,[music,sfx]),[]);
  assert.ok(videoEditAudioAssetIssues(value,[sfx]).includes('music-asset-missing'));
});

test('Auto SFX suggests transition and emphasis events from tagged library',()=>{
  const value=edit();
  value.clipStyles[0]={...value.clipStyles[0],transitionOut:'cross-dissolve',transitionSeconds:.3};
  value.captions.cues[0].words=value.captions.cues[0].words.map((word,index)=>({...word,highlighted:index===0}));
  const transition=audioAsset({
    id:'51111111-1111-4111-8111-111111111111',kind:'sfx',tags:['whoosh','transition'],durationSeconds:.5
  });
  const emphasis=audioAsset({
    id:'52111111-1111-4111-8111-111111111111',kind:'sfx',tags:['pop','emphasis'],durationSeconds:.2
  });
  const suggestions=suggestSfxEvents(value,timeline,[transition,emphasis]);
  assert.ok(suggestions.some(event=>event.eventType==='scene-transition'&&event.assetId===transition.id));
  assert.ok(suggestions.some(event=>event.eventType==='emphasis'&&event.assetId===emphasis.id));
});

test('Video Editor upstream gate detects Timeline and Transcript version changes',()=>{
  const value=edit();
  const newerTimeline={...timeline,version:timeline.version+1};
  const newerTranscript={...transcript,version:transcript.version+1};
  const issues=videoEditUpstreamIssues({edit:value,timeline:newerTimeline,transcript:newerTranscript});
  assert.ok(issues.includes('stale-timeline-version'));
  assert.ok(issues.includes('stale-transcript-version'));
});

test('Video Editor approval combines structural upstream and audio blockers',()=>{
  const value=edit();
  const notApproved={...timeline,status:'review' as const};
  const issues=videoEditApprovalIssues(value,notApproved,transcript,[]);
  assert.deepEqual(issues,['timeline-not-approved']);
});


test('Documentary image motion uses composition focus and leaves video natural',()=>{
  const focused=structuredClone(timeline);
  const image=focused.tracks.find(track=>track.type==='visual')!.clips[0];
  image.focusX=.2;
  image.focusY=.35;
  image.sourceWidth=2400;
  image.sourceHeight=1600;
  const documentaryDna={
    ...dna,
    editing:{...dna.editing,kenBurns:true}
  } as ProductionDNA;
  const value=buildInitialVideoEdit(focused,transcript,documentaryDna);
  const still=value.clipStyles[0];
  const video=value.clipStyles[1];
  assert.equal(still.motionPreset,'custom');
  assert.ok(still.scaleEnd>still.scaleStart);
  assert.ok(still.xEnd<0);
  assert.ok(still.yEnd<0);
  assert.equal(still.transitionOut,'cross-dissolve');
  assert.equal(video.motionPreset,'none');
});

test('Documentary image motion is opt-in through Production DNA',()=>{
  const clip=timeline.tracks.find(track=>track.type==='visual')!.clips[0];
  const off=documentaryClipStyle(clip,0,2,false);
  const on=documentaryClipStyle({...clip,sourceWidth:2400,sourceHeight:1200},0,2,true);
  assert.equal(off.motionPreset,'none');
  assert.equal(off.transitionOut,'none');
  assert.equal(on.motionPreset,'pan-right');
  assert.equal(on.transitionOut,'cross-dissolve');
  assert.ok(on.transitionSeconds<=.35);
});

test('Documentary transition duration is bounded for short beats',()=>{
  const clip={
    ...timeline.tracks.find(track=>track.type==='visual')!.clips[0],
    durationSeconds:.3,
    endSeconds:.3
  };
  const style=documentaryClipStyle(clip,0,2,true,.35);
  assert.ok(style.transitionSeconds<=.1+1e-9);
});

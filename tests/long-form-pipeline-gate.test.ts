import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ProductionDNA, ScenePlan, Timeline, Transcript, TranscriptPayload,
  VisualPromptSet, VoiceAsset
} from '../src/lib/types';
import {
  transcriptPayloadSchema, scenePlanPayloadSchema, visualPromptSetPayloadSchema,
  timelinePayloadSchema, videoEditPayloadSchema
} from '../src/lib/server/validation';
import {
  createInitialScenes, scenePlanApprovalIssues
} from '../src/lib/scene-timecode-policy';
import {
  buildInitialVisualPromptSet, visualPromptIssues
} from '../src/lib/visual-prompt-policy';
import {
  buildInitialTimeline, timelineChapters, timelineStructuralIssues
} from '../src/lib/timeline-policy';
import {
  buildInitialVideoEdit, videoEditStructuralIssues
} from '../src/lib/video-editor-policy';

const NOW='2026-09-27T00:00:00.000Z';
const DURATION=3600;
const WORD_COUNT=12000;
const SCENE_COUNT=600;
const WORDS_PER_SCENE=WORD_COUNT/SCENE_COUNT;
const SCENE_SECONDS=DURATION/SCENE_COUNT;

function id(n:number){
  const a=n.toString(16).padStart(8,'0').slice(-8);
  const b=n.toString(16).padStart(12,'0').slice(-12);
  return a+'-1111-4111-8111-'+b;
}

function transcriptFixture(){
  const words=Array.from({length:WORD_COUNT},(_,index)=>{
    const start=index*(DURATION/WORD_COUNT);
    return {
      id:id(index+1),
      text:'word'+String(index+1),
      startSeconds:Number(start.toFixed(3)),
      endSeconds:Number((start+.24).toFixed(3)),
      type:'word' as const,
      confidence:.98
    };
  });
  const segments=Array.from({length:SCENE_COUNT},(_,index)=>{
    const slice=words.slice(index*WORDS_PER_SCENE,(index+1)*WORDS_PER_SCENE);
    return {
      id:id(20000+index),
      startSeconds:index*SCENE_SECONDS,
      endSeconds:(index+1)*SCENE_SECONDS,
      text:slice.map(word=>word.text).join(' '),
      wordIds:slice.map(word=>word.id)
    };
  });
  const payload:TranscriptPayload={
    kind:'transcript',
    id:id(30001),
    channelId:id(30002),
    episodeId:id(30003),
    scriptId:id(30004),
    voiceAssetId:id(30005),
    sourceType:'scribe',
    languageCode:'en',
    text:words.map(word=>word.text).join(' '),
    words,
    segments,
    scriptMatchScore:1,
    scriptVersion:1,
    voiceTake:1,
    provenance:{provider:'elevenlabs',model:'scribe_v2'},
    review:{scriptMismatchOverride:false,notes:''},
    createdAt:NOW,
    updatedAt:NOW
  };
  return {
    payload,
    transcript:{...payload,version:1,status:'approved' as const} as Transcript
  };
}

const dna={
  kind:'production-dna',
  channelId:id(30002),
  version:1,
  format:{
    aspectRatio:'16:9',width:1920,height:1080,fps:30,
    targetDurationMinutes:{min:60,max:60},
    sceneDurationSeconds:{min:null,preferred:6,max:null}
  },
  visual:{
    styleName:'Documentary',styleDescription:'Editorial documentary.',
    palette:[],compositionRules:[],cameraRules:[],motionRules:[],
    basePrompt:'documentary editorial framing',scenePromptTemplate:'',
    negativePrompt:'no fabricated evidence',forbidden:[]
  },
  characters:[],
  voice:{
    language:'English',providerPreference:['elevenlabs'],voiceId:'voice',
    voiceName:'Narrator',narrationStyle:['documentary'],paceWpm:200,pronunciationRules:[]
  },
  captions:{
    enabled:true,styleDescription:'Readable documentary captions',
    position:'bottom-center',maxWordsPerCaption:12,maxLines:2,
    highlightKeywords:false,emphasizeFacts:false,longFormMode:true
  },
  editing:{
    transitions:[],defaultTransition:'cut',kenBurns:false,
    musicStyle:[],sfxRules:[],pacingRules:[]
  },
  thumbnail:{styleRules:[],forbidden:[]},
  providers:{image:[],video:[],voice:[],stock:[]},
  research:{documentaryMode:true,requireClaimLedger:true},
  createdAt:NOW,updatedAt:NOW
} as ProductionDNA;

test('Synthetic 60-minute pipeline compiles Transcript through Video Edit without structural blockers',()=>{
  const started=performance.now();
  const {payload:transcriptPayload,transcript}=transcriptFixture();

  assert.doesNotThrow(()=>transcriptPayloadSchema.parse(transcriptPayload));
  assert.equal(transcript.words.length,WORD_COUNT);
  assert.equal(transcript.segments.length,SCENE_COUNT);

  const scenePayload={
    kind:'scene-plan' as const,
    id:id(31001),
    channelId:transcript.channelId,
    episodeId:transcript.episodeId,
    scriptId:transcript.scriptId,
    voiceAssetId:transcript.voiceAssetId,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    voiceTake:transcript.voiceTake,
    audioDurationSeconds:DURATION,
    scenes:createInitialScenes(transcript,DURATION),
    review:{notes:'',durationWarningsAccepted:true},
    createdAt:NOW,updatedAt:NOW
  };
  assert.equal(scenePayload.scenes.length,SCENE_COUNT);
  assert.doesNotThrow(()=>scenePlanPayloadSchema.parse(scenePayload));
  const scenePlan={
    ...scenePayload,version:1,status:'approved' as const
  } as ScenePlan;
  assert.deepEqual(scenePlanApprovalIssues(scenePayload,transcript,dna),[]);

  const visualPayload=buildInitialVisualPromptSet(scenePlan,dna);
  visualPayload.workflowStage='complete';
  visualPayload.aiPlanning={
    completedScenes:SCENE_COUNT,totalScenes:SCENE_COUNT,batchSize:40,updatedAt:NOW
  };
  assert.equal(visualPayload.scenePrompts.length,SCENE_COUNT);
  assert.doesNotThrow(()=>visualPromptSetPayloadSchema.parse(visualPayload));
  assert.deepEqual(visualPromptIssues(visualPayload,scenePlan,dna,true),[]);
  const promptSet={
    ...visualPayload,version:1,status:'approved' as const
  } as VisualPromptSet;

  const assets=scenePlan.scenes.map((scene,index)=>({
    id:id(40000+index),
    sceneId:scene.id,
    assetKind:'image' as const,
    durationSeconds:null
  }));
  const voice={
    id:scenePlan.voiceAssetId,
    take:1,
    durationSeconds:DURATION
  } as VoiceAsset;
  const timelinePayload=buildInitialTimeline({
    scenePlan,productionDna:dna,visualPromptSet:promptSet,
    visualAssets:assets,voiceAsset:voice
  });
  assert.equal(timelinePayload.tracks.find(track=>track.type==='visual')?.clips.length,SCENE_COUNT*2);
  assert.equal(timelineChapters(timelinePayload).length,6);
  assert.doesNotThrow(()=>timelinePayloadSchema.parse(timelinePayload));
  assert.deepEqual(timelineStructuralIssues(timelinePayload,scenePlan),[]);
  const timeline={
    ...timelinePayload,version:1,status:'approved' as const
  } as Timeline;

  const edit=buildInitialVideoEdit(timeline,transcript,dna);
  assert.equal(edit.clipStyles.length,SCENE_COUNT*2);
  assert.ok(edit.captions.cues.length>=SCENE_COUNT);
  assert.equal(
    edit.captions.cues.flatMap(cue=>cue.words).length,
    WORD_COUNT
  );
  assert.doesNotThrow(()=>videoEditPayloadSchema.parse(edit));
  assert.deepEqual(videoEditStructuralIssues(edit,timeline,transcript),[]);

  const elapsedMs=performance.now()-started;
  assert.ok(
    elapsedMs<10000,
    'synthetic 60-minute compiler exceeded 10s: '+elapsedMs.toFixed(0)+'ms'
  );
});

test('Long-form Caption compiler builds one global word index, not one per segment',()=>{
  const source=readFileSync(
    resolve(process.cwd(),'src/lib/video-editor-policy.ts'),
    'utf8'
  );
  const start=source.indexOf('export function buildCaptionCues');
  const end=source.indexOf('export function upgradeVideoEditPayload',start);
  const block=source.slice(start,end);
  assert.match(block,/const wordById=new Map/);
  assert.match(block,/segmentWords\(wordById,segment,end,options\)/);
});

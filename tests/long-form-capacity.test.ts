import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_FORM_JSON_LIMITS } from '../src/lib/long-form-capacity';

const MINUTE=60;
const DURATION_SECONDS=60*MINUTE;
const WORDS_PER_MINUTE=200;
const WORD_COUNT=60*WORDS_PER_MINUTE;
const SCENE_SECONDS=6;
const SCENE_COUNT=DURATION_SECONDS/SCENE_SECONDS;
const WORDS_PER_SCENE=WORD_COUNT/SCENE_COUNT;
const NOW='2026-09-26T00:00:00.000Z';

function id(value:number){
  return String(value).padStart(8,'0')+'-1111-4111-8111-'+String(value).padStart(12,'0');
}

function bytes(value:unknown){
  return Buffer.byteLength(JSON.stringify(value),'utf8');
}

function word(index:number){
  const start=index*DURATION_SECONDS/WORD_COUNT;
  return {
    id:id(index+1),
    text:'documentary',
    startSeconds:Number(start.toFixed(3)),
    endSeconds:Number((start+.24).toFixed(3)),
    type:'word',
    confidence:.98
  };
}

const words=Array.from({length:WORD_COUNT},(_,index)=>word(index));
const segments=Array.from({length:SCENE_COUNT},(_,index)=>{
  const start=index*WORDS_PER_SCENE;
  const slice=words.slice(start,start+WORDS_PER_SCENE);
  return {
    id:id(20000+index),
    startSeconds:index*SCENE_SECONDS,
    endSeconds:(index+1)*SCENE_SECONDS,
    text:slice.map(item=>item.text).join(' '),
    wordIds:slice.map(item=>item.id)
  };
});

function transcript(){
  return {
    kind:'transcript',
    id:id(30001),channelId:id(30002),episodeId:id(30003),scriptId:id(30004),voiceAssetId:id(30005),
    sourceType:'scribe',languageCode:'en',
    text:words.map(item=>item.text).join(' '),
    words,segments,
    scriptMatchScore:.99,scriptVersion:1,voiceTake:1,
    provenance:{provider:'elevenlabs',model:'scribe_v2'},
    review:{scriptMismatchOverride:false,notes:''},
    createdAt:NOW,updatedAt:NOW
  };
}

function scenePlan(){
  return {
    kind:'scene-plan',
    id:id(31001),channelId:id(30002),episodeId:id(30003),scriptId:id(30004),
    voiceAssetId:id(30005),transcriptId:id(31002),transcriptVersion:1,voiceTake:1,
    audioDurationSeconds:DURATION_SECONDS,
    scenes:segments.map((segment,index)=>{
      const sceneId=id(40000+index);
      return {
        id:sceneId,sequence:index+1,
        startSeconds:index*SCENE_SECONDS,endSeconds:(index+1)*SCENE_SECONDS,durationSeconds:SCENE_SECONDS,
        narration:segment.text,
        transcriptSegmentIds:[segment.id],
        transcriptWordIds:[...segment.wordIds],
        visualIntent:'Documentary visual evidence supporting this narration.',
        shotType:'medium-wide documentary',
        characterIds:[],assetMode:'mixed',
        promptDirection:'Prefer authentic footage or archival imagery with accurate context.',
        notes:'',
        visualBeats:[{
          id:id(50000+index),sequence:1,
          startSeconds:index*SCENE_SECONDS,endSeconds:(index+1)*SCENE_SECONDS,durationSeconds:SCENE_SECONDS,
          narration:segment.text,
          transcriptSegmentIds:[segment.id],
          transcriptWordIds:[...segment.wordIds],
          type:'contextual',sourcePreference:'owned',
          entities:[{kind:'concept',value:'documentary evidence'}],
          queries:['authentic documentary evidence contextual footage'],
          confidence:'heuristic'
        }]
      };
    }),
    review:{notes:'',durationWarningsAccepted:true},
    createdAt:NOW,updatedAt:NOW
  };
}

function visualPromptSet(plan:ReturnType<typeof scenePlan>){
  const richDirection='Authentic documentary framing with historically accurate context, restrained camera language, clean composition, and clear visual evidence. ';
  const richPrompt='Documentary scene with accurate place, time, subject, lighting, camera perspective, provenance-safe details, no invented evidence, and visual continuity. ';
  return {
    kind:'visual-prompt-set',
    id:id(60001),channelId:id(30002),episodeId:id(30003),scenePlanId:plan.id,
    scenePlanVersion:1,productionDnaVersion:1,
    styleLock:'Documentary realism, provenance-aware sourcing, no synthetic factual evidence.',
    workflowStage:'complete',
    characterReferences:[],
    scenePrompts:plan.scenes.map((scene,index)=>({
      sceneId:scene.id,sequence:index+1,
      timecodeLabel:'#'+Math.floor(scene.startSeconds/60)+'-'+String(scene.startSeconds%60).padStart(2,'0'),
      startSeconds:scene.startSeconds,endSeconds:scene.endSeconds,
      characterIds:[],referenceNames:[],
      direction:richDirection.repeat(5),
      prompt:richPrompt.repeat(10)
    })),
    review:{notes:''},createdAt:NOW,updatedAt:NOW
  };
}

function videoEdit(plan:ReturnType<typeof scenePlan>){
  const clipStyles=plan.scenes.map((scene,index)=>({
    timelineClipId:id(70000+index),sceneId:scene.id,
    motionPreset:'none',scaleStart:1,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0,
    transitionIn:'none',transitionOut:'none',transitionSeconds:0
  }));
  const cues=segments.map((segment,index)=>{
    const slice=words.slice(index*WORDS_PER_SCENE,(index+1)*WORDS_PER_SCENE);
    return {
      id:id(80000+index),transcriptSegmentId:segment.id,
      startSeconds:index*SCENE_SECONDS,endSeconds:(index+1)*SCENE_SECONDS,
      text:slice.map(item=>item.text).join(' '),
      words:slice.map(item=>({
        id:item.id,text:item.text,startSeconds:item.startSeconds,endSeconds:item.endSeconds,highlighted:false
      }))
    };
  });
  return {
    kind:'video-edit',
    id:id(90001),channelId:id(30002),episodeId:id(30003),timelineId:id(90002),timelineVersion:1,
    transcriptId:id(31002),transcriptVersion:1,
    format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
    durationSeconds:DURATION_SECONDS,
    clipStyles,
    captions:{
      enabled:true,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,styleDescription:'',
      style:{
        fontFamily:'DejaVu Sans',fontWeight:800,primaryColor:'#FFFFFF',highlightColor:'#F4C95D',
        outlineColor:'#000000',outlineWidth:2,uppercase:false,maxWordsPerLine:6,
        smartBreaks:true,highlightMode:'active-word',safeMarginPercent:6
      },
      cues
    },
    overlays:[],
    audioMix:{voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true},
    musicTrack:null,sfxEvents:[],review:{notes:''},createdAt:NOW,updatedAt:NOW
  };
}

test('60-minute transcript exceeds the former 450 KB cap but fits the bounded long-form limit',()=>{
  const size=bytes(transcript());
  assert.ok(size>450_000,'fixture should prove the former transcript cap was too small');
  assert.ok(size<LONG_FORM_JSON_LIMITS.transcript,{size,limit:LONG_FORM_JSON_LIMITS.transcript});
});

test('60-minute Scene Plan exceeds the former 600 KB cap but fits the bounded long-form limit',()=>{
  const size=bytes(scenePlan());
  assert.ok(size>600_000,'fixture should prove the former Scene Plan cap was too small');
  assert.ok(size<LONG_FORM_JSON_LIMITS.scenePlan,{size,limit:LONG_FORM_JSON_LIMITS.scenePlan});
});

test('rich 60-minute Visual Prompt Set fits the dedicated long-form envelope',()=>{
  const plan=scenePlan();
  const size=bytes(visualPromptSet(plan));
  assert.ok(size>1_000_000,'fixture should exercise payloads beyond the former 1 MB cap');
  assert.ok(size<LONG_FORM_JSON_LIMITS.visualPromptSet,{size,limit:LONG_FORM_JSON_LIMITS.visualPromptSet});
});

test('60-minute word-level Video Edit fits the dedicated long-form envelope',()=>{
  const plan=scenePlan();
  const size=bytes(videoEdit(plan));
  assert.ok(size>1_800_000,'fixture should exercise payloads beyond the former 1.8 MB cap');
  assert.ok(size<LONG_FORM_JSON_LIMITS.videoEdit,{size,limit:LONG_FORM_JSON_LIMITS.videoEdit});
});

test('long-form JSON limits stay bounded',()=>{
  for(const limit of Object.values(LONG_FORM_JSON_LIMITS)){
    assert.ok(limit>=4*1024*1024);
    assert.ok(limit<=8*1024*1024);
  }
});

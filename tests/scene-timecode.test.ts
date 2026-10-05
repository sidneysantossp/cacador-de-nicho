import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProductionDNA, ScenePlanPayload, Transcript } from '../src/lib/types';
import {
  createInitialScenes, normalizeScenePlan, sceneDurationWarnings,
  scenePlanApprovalIssues, scenePlanStructuralIssues
} from '../src/lib/scene-timecode-policy';

const now='2026-09-23T20:00:00.000Z';

const transcript:Transcript={
  kind:'transcript',
  id:'11111111-1111-4111-8111-111111111111',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'22222222-2222-4222-8222-222222222222',
  scriptId:'33333333-3333-4333-8333-333333333333',
  voiceAssetId:'44444444-4444-4444-8444-444444444444',
  sourceType:'imported',
  languageCode:'en',
  text:'First line. Second line.',
  words:[],
  segments:[
    {id:'55555555-5555-4555-8555-555555555555',startSeconds:.5,endSeconds:2,text:'First line.',wordIds:[]},
    {id:'66666666-6666-4666-8666-666666666666',startSeconds:3,endSeconds:5,text:'Second line.',wordIds:[]}
  ],
  scriptMatchScore:1,
  scriptVersion:2,
  voiceTake:1,
  originalFormat:'srt',
  provenance:{importedBy:'operator'},
  review:{scriptMismatchOverride:false,notes:''},
  createdAt:now,
  updatedAt:now,
  version:3,
  status:'approved'
};

function plan():ScenePlanPayload{
  const scenes=createInitialScenes(transcript,6);
  return {
    kind:'scene-plan',
    id:'77777777-7777-4777-8777-777777777777',
    channelId:transcript.channelId,
    episodeId:transcript.episodeId,
    scriptId:transcript.scriptId,
    voiceAssetId:transcript.voiceAssetId,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    voiceTake:transcript.voiceTake,
    audioDurationSeconds:6,
    scenes,
    review:{notes:'',durationWarningsAccepted:false},
    createdAt:now,
    updatedAt:now
  };
}

const dna={
  format:{sceneDurationSeconds:{min:2,preferred:3,max:4}}
} as unknown as ProductionDNA;

test('Scene Timecode creates a contiguous initial timeline from transcript segments',()=>{
  const scenes=createInitialScenes(transcript,6);
  assert.equal(scenes.length,2);
  assert.equal(scenes[0].startSeconds,0);
  assert.equal(scenes[0].endSeconds,3);
  assert.equal(scenes[1].startSeconds,3);
  assert.equal(scenes[1].endSeconds,6);
  assert.deepEqual(scenes[0].transcriptSegmentIds,[transcript.segments[0].id]);
  assert.deepEqual(scenes[1].transcriptSegmentIds,[transcript.segments[1].id]);
  assert.equal(scenes[0].visualBeats?.length,1);
  assert.equal(scenes[0].visualBeats?.[0].narration,'First line.');
});

test('Scene Timecode normalization resequences scenes and recalculates duration',()=>{
  const input=plan();
  input.scenes=[{...input.scenes[1],sequence:9},{...input.scenes[0],sequence:4}];
  const normalized=normalizeScenePlan(input);
  assert.deepEqual(normalized.scenes.map(scene=>scene.sequence),[1,2]);
  assert.deepEqual(normalized.scenes.map(scene=>scene.durationSeconds),[3,3]);
});

test('Scene Timecode detects overlap and timeline gaps',()=>{
  const overlap=plan();
  overlap.scenes[1]={...overlap.scenes[1],startSeconds:2.5};
  assert.ok(scenePlanStructuralIssues(normalizeScenePlan(overlap),transcript).includes('scene-overlap'));

  const gap=plan();
  gap.scenes[1]={...gap.scenes[1],startSeconds:3.5};
  assert.ok(scenePlanStructuralIssues(normalizeScenePlan(gap),transcript).includes('scene-gap'));
});

test('Scene Timecode blocks stale transcript versions and missing segment coverage',()=>{
  const input=plan();
  input.transcriptVersion=2;
  input.scenes[1]={...input.scenes[1],transcriptSegmentIds:[]};
  const issues=scenePlanStructuralIssues(input,transcript);
  assert.ok(issues.includes('stale-transcript-version'));
  assert.ok(issues.includes('missing-transcript-segment'));
});

test('Scene Timecode reports Production DNA duration exceptions separately',()=>{
  const input=plan();
  input.scenes[0]={
    ...input.scenes[0],
    endSeconds:5,
    durationSeconds:5,
    visualBeats:[{
      ...input.scenes[0].visualBeats![0],
      endSeconds:5,
      durationSeconds:5
    }]
  };
  input.scenes[1]={...input.scenes[1],startSeconds:5,endSeconds:6,durationSeconds:1};
  const warnings=sceneDurationWarnings(input,dna);
  assert.ok(warnings.includes('scene-1-beat-1-above-max-duration'));
  assert.ok(warnings.includes('scene-2-below-min-duration'));
});

test('Duration warnings require explicit operator acceptance before approval',()=>{
  const input=plan();
  input.scenes[0]={...input.scenes[0],endSeconds:5,durationSeconds:5};
  input.scenes[1]={...input.scenes[1],startSeconds:5,endSeconds:6,durationSeconds:1};
  assert.ok(scenePlanApprovalIssues(input,transcript,dna).includes('duration-warnings-not-accepted'));
  input.review.durationWarningsAccepted=true;
  assert.equal(scenePlanApprovalIssues(input,transcript,dna).includes('duration-warnings-not-accepted'),false);
});


test('Scene Timecode splits long transcript segments into visual beats under the DNA ceiling',()=>{
  const longTranscript:Transcript={
    ...transcript,
    words:Array.from({length:18},(_,index)=>({
      id:`8${String(index).padStart(2,'0')}11111-1111-4111-8111-111111111111`,
      text:`word${index+1}`,
      startSeconds:index*.45,
      endSeconds:(index+1)*.45,
      type:'word' as const
    })),
    segments:[{
      id:'89999999-9999-4999-8999-999999999999',
      startSeconds:0,
      endSeconds:8.1,
      text:Array.from({length:18},(_,index)=>`word${index+1}`).join(' '),
      wordIds:Array.from({length:18},(_,index)=>
        `8${String(index).padStart(2,'0')}11111-1111-4111-8111-111111111111`
      )
    }]
  };
  const scenes=createInitialScenes(longTranscript,8.1,{
    min:2.5,preferred:3.5,max:6
  });
  assert.equal(scenes.length,2);
  assert.ok(scenes.every(scene=>scene.visualBeats?.length===1));
  assert.ok(scenes.every(scene=>scene.durationSeconds<=6));
  assert.ok(scenes.every(scene=>scene.durationSeconds>=2.5));
  assert.deepEqual(scenes[0].transcriptSegmentIds,scenes[1].transcriptSegmentIds);
  assert.equal(
    new Set(scenes.flatMap(scene=>scene.transcriptWordIds)).size,
    longTranscript.words.length
  );
  assert.equal(
    sceneDurationWarnings({
      ...plan(),
      audioDurationSeconds:8.1,
      scenes
    },{
      format:{sceneDurationSeconds:{min:2.5,preferred:3.5,max:6}}
    } as unknown as ProductionDNA).some(item=>item.includes('above-max-duration')),
    false
  );
});

test('Scene Timecode treats visual beats as the hard max-duration boundary',()=>{
  const input=plan();
  input.scenes[0]={
    ...input.scenes[0],
    endSeconds:6,
    durationSeconds:6,
    visualBeats:[
      {...input.scenes[0].visualBeats![0],sequence:1,startSeconds:0,endSeconds:3,durationSeconds:3},
      {...input.scenes[0].visualBeats![0],id:'88888888-8888-4888-8888-888888888888',sequence:2,startSeconds:3,endSeconds:6,durationSeconds:3}
    ]
  };
  input.scenes[1]={...input.scenes[1],startSeconds:6,endSeconds:7,durationSeconds:1};
  input.audioDurationSeconds=7;
  const warnings=sceneDurationWarnings(input,dna);
  assert.equal(warnings.some(item=>item.includes('scene-1')&&item.includes('above-max-duration')),false);
});

test('Scene Timecode API exposes a versioned rebuild using current Production DNA',()=>{
  const route=readFileSync('src/app/api/scene-timecode/route.ts','utf8');
  const server=readFileSync('src/lib/server/scene-timecode.ts','utf8');
  assert.match(route,/action:z\.literal\('rebuild'\)/);
  assert.match(route,/rebuildScenePlan\(body\.planId\)/);
  assert.match(server,/export async function rebuildScenePlan/);
  assert.match(server,/context\.dna\?\.format\.sceneDurationSeconds/);
  assert.match(server,/durationWarningsAccepted:false/);
});

test('Scene Timecode API can approve the current version without resending the full plan',()=>{
  const route=readFileSync('src/app/api/scene-timecode/route.ts','utf8');
  assert.match(route,/action:z\.literal\('approveCurrent'\)/);
  assert.match(route,/current\.version!==body\.expectedVersion/);
  assert.match(route,/durationWarningsAccepted:body\.acceptDurationWarnings/);
  assert.match(route,/saveScenePlan\(\{/);
});


test('Scene Timecode allows one transcript segment to span multiple visual scenes when words partition cleanly',()=>{
  const longTranscript:Transcript={
    ...transcript,
    words:[
      {id:'91111111-1111-4111-8111-111111111111',text:'first',startSeconds:0,endSeconds:1,type:'word'},
      {id:'92222222-2222-4222-8222-222222222222',text:'second',startSeconds:1,endSeconds:2,type:'word'},
      {id:'93333333-3333-4333-8333-333333333333',text:'third',startSeconds:2,endSeconds:3,type:'word'},
      {id:'94444444-4444-4444-8444-444444444444',text:'fourth',startSeconds:3,endSeconds:4,type:'word'},
      {id:'95555555-5555-4555-8555-555555555555',text:'fifth',startSeconds:4,endSeconds:5,type:'word'},
      {id:'96666666-6666-4666-8666-666666666666',text:'sixth',startSeconds:5,endSeconds:6,type:'word'},
      {id:'97777777-7777-4777-8777-777777777777',text:'seventh',startSeconds:6,endSeconds:7,type:'word'},
      {id:'98888888-8888-4888-8888-888888888888',text:'eighth',startSeconds:7,endSeconds:8,type:'word'}
    ],
    segments:[{
      id:'99999999-9999-4999-8999-999999999999',
      startSeconds:0,endSeconds:8,
      text:'first second third fourth fifth sixth seventh eighth',
      wordIds:[
        '91111111-1111-4111-8111-111111111111','92222222-2222-4222-8222-222222222222',
        '93333333-3333-4333-8333-333333333333','94444444-4444-4444-8444-444444444444',
        '95555555-5555-4555-8555-555555555555','96666666-6666-4666-8666-666666666666',
        '97777777-7777-4777-8777-777777777777','98888888-8888-4888-8888-888888888888'
      ]
    }],
    text:'first second third fourth fifth sixth seventh eighth'
  };
  const scenes=createInitialScenes(longTranscript,8,{min:2.5,preferred:3.5,max:6});
  const payload:ScenePlanPayload={
    ...plan(),
    transcriptVersion:longTranscript.version,
    audioDurationSeconds:8,
    scenes
  };
  assert.equal(scenes.length,2);
  assert.deepEqual(scenePlanStructuralIssues(payload,longTranscript),[]);
});
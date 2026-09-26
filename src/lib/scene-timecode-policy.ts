import type {
  ProductionDNA, ScenePlanPayload, SceneTimecode, Transcript, TranscriptSegment
} from '@/lib/types';
import { buildVisualBeat } from '@/lib/visual-beat-policy';

const EPSILON=0.02;

export function scenePlanAudioDuration(transcript:Transcript,audioDuration:number|null){
  const transcriptEnd=Math.max(0,...transcript.segments.map(segment=>segment.endSeconds??segment.startSeconds));
  return Math.max(audioDuration??0,transcriptEnd);
}

export function createInitialScenes(
  transcript:Transcript,
  audioDuration:number|null
):SceneTimecode[]{
  const segments=[...transcript.segments]
    .filter(segment=>segment.endSeconds!==null&&segment.endSeconds>segment.startSeconds)
    .sort((a,b)=>a.startSeconds-b.startSeconds);

  const total=scenePlanAudioDuration(transcript,audioDuration);
  if(!segments.length||total<=0)return [];

  return segments.map((segment,index)=>{
    const next=segments[index+1];
    const start=index===0?0:segment.startSeconds;
    const rawEnd=next?next.startSeconds:total;
    const end=Math.max(segment.endSeconds!,rawEnd);
    const sceneEnd=Math.min(total,end);
    const beat=buildVisualBeat({segment,sequence:1});
    return {
      id:crypto.randomUUID(),
      sequence:index+1,
      startSeconds:start,
      endSeconds:sceneEnd,
      durationSeconds:Math.max(0,sceneEnd-start),
      narration:segment.text,
      transcriptSegmentIds:[segment.id],
      transcriptWordIds:[...segment.wordIds],
      visualIntent:'',
      shotType:'',
      characterIds:[],
      assetMode:'image',
      promptDirection:'',
      notes:'',
      visualBeats:[{
        ...beat,
        startSeconds:start,
        endSeconds:sceneEnd,
        durationSeconds:Math.max(0,sceneEnd-start)
      }]
    };
  });
}

export function normalizeScenePlan(payload:ScenePlanPayload):ScenePlanPayload{
  const scenes=[...payload.scenes]
    .sort((a,b)=>a.startSeconds-b.startSeconds||a.sequence-b.sequence)
    .map((scene,index)=>({
      ...scene,
      sequence:index+1,
      startSeconds:Math.max(0,scene.startSeconds),
      endSeconds:Math.max(0,scene.endSeconds),
      durationSeconds:Math.max(0,scene.endSeconds-scene.startSeconds),
      narration:scene.narration.trim()
    }));

  return {...payload,scenes,updatedAt:new Date().toISOString()};
}

export function scenePlanStructuralIssues(
  payload:ScenePlanPayload,
  transcript:Transcript
){
  const issues:string[]=[];
  const scenes=[...payload.scenes].sort((a,b)=>a.startSeconds-b.startSeconds);
  const expectedSegments=new Set(transcript.segments.map(segment=>segment.id));
  const coverage=new Map<string,number>();

  if(!scenes.length)issues.push('no-scenes');
  if(payload.transcriptVersion!==transcript.version)issues.push('stale-transcript-version');

  scenes.forEach((scene,index)=>{
    if(scene.endSeconds<=scene.startSeconds)issues.push('invalid-scene-duration');
    if(scene.startSeconds<0||scene.endSeconds>payload.audioDurationSeconds+EPSILON)issues.push('scene-outside-audio');
    if(!scene.narration.trim())issues.push('empty-scene-narration');

    const previous=scenes[index-1];
    if(previous){
      if(scene.startSeconds<previous.endSeconds-EPSILON)issues.push('scene-overlap');
      if(scene.startSeconds>previous.endSeconds+EPSILON)issues.push('scene-gap');
    }else if(scene.startSeconds>EPSILON){
      issues.push('scene-gap-at-start');
    }

    scene.transcriptSegmentIds.forEach(id=>{
      coverage.set(id,(coverage.get(id)??0)+1);
      if(!expectedSegments.has(id))issues.push('unknown-transcript-segment');
    });

    for(const beat of scene.visualBeats??[]){
      if(beat.endSeconds<=beat.startSeconds)issues.push('invalid-visual-beat-duration');
      if(beat.startSeconds<scene.startSeconds-EPSILON||beat.endSeconds>scene.endSeconds+EPSILON){
        issues.push('visual-beat-outside-scene');
      }
      if(!beat.narration.trim())issues.push('empty-visual-beat-narration');
      if(!beat.queries.length)issues.push('visual-beat-without-query');
    }
  });

  if(scenes.length&&scenes.at(-1)!.endSeconds<payload.audioDurationSeconds-EPSILON){
    issues.push('scene-gap-at-end');
  }

  for(const id of expectedSegments){
    const count=coverage.get(id)??0;
    if(count===0)issues.push('missing-transcript-segment');
    if(count>1)issues.push('duplicate-transcript-segment');
  }

  return [...new Set(issues)];
}

export function sceneDurationWarnings(
  payload:ScenePlanPayload,
  dna:ProductionDNA|null
){
  if(!dna)return [] as string[];
  const min=dna.format.sceneDurationSeconds.min;
  const max=dna.format.sceneDurationSeconds.max;
  const warnings:string[]=[];

  payload.scenes.forEach(scene=>{
    if(min!==null&&scene.durationSeconds+EPSILON<min)warnings.push('scene-'+scene.sequence+'-below-min-duration');
    if(max!==null&&scene.durationSeconds-EPSILON>max)warnings.push('scene-'+scene.sequence+'-above-max-duration');
  });

  return warnings;
}

export function scenePlanApprovalIssues(
  payload:ScenePlanPayload,
  transcript:Transcript,
  dna:ProductionDNA|null
){
  const structural=scenePlanStructuralIssues(payload,transcript);
  const durationWarnings=sceneDurationWarnings(payload,dna);
  return [
    ...structural,
    ...(durationWarnings.length&&!payload.review.durationWarningsAccepted?['duration-warnings-not-accepted']:[])
  ];
}

export function sceneContainsTranscriptSegment(
  scene:SceneTimecode,
  segment:TranscriptSegment
){
  return scene.startSeconds<=segment.startSeconds+EPSILON
    && scene.endSeconds>=Number(segment.endSeconds??segment.startSeconds)-EPSILON;
}

import type {
  ProductionDNA, ScenePlanPayload, SceneTimecode, Transcript, TranscriptSegment
} from '@/lib/types';
import { buildVisualBeat } from '@/lib/visual-beat-policy';
import {
  productionPrefersMotion, scenePlanVisualStrategyIssues
} from '@/lib/pre-render-visual-policy';

const EPSILON=0.02;

type VisualBeatTiming={
  min:number|null;
  preferred:number|null;
  max:number|null;
};

function transcriptWordsForSegment(
  transcript:Transcript,
  segment:TranscriptSegment
){
  const wordById=new Map(transcript.words.map(word=>[word.id,word]));
  const explicit=segment.wordIds
    .map(id=>wordById.get(id))
    .filter((word):word is NonNullable<typeof word>=>Boolean(word)&&word!.type==='word')
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  if(explicit.length)return explicit;

  const end=segment.endSeconds??segment.startSeconds;
  return transcript.words
    .filter(word=>{
      if(word.type!=='word')return false;
      const midpoint=(word.startSeconds+word.endSeconds)/2;
      return midpoint>=segment.startSeconds-EPSILON&&midpoint<=end+EPSILON;
    })
    .sort((a,b)=>a.startSeconds-b.startSeconds);
}

function visualBeatCount(duration:number,timing?:VisualBeatTiming){
  if(duration<=0)return 1;
  const preferred=timing?.preferred??null;
  const min=timing?.min??null;
  const max=timing?.max??null;
  let count=preferred!==null&&preferred>0
    ?Math.max(1,Math.round(duration/preferred))
    :1;
  if(max!==null&&max>0&&duration/count>max+EPSILON){
    count=Math.max(count,Math.ceil(duration/max));
  }
  if(min!==null&&min>0&&count>1&&duration/count<min-EPSILON){
    count=Math.max(1,Math.floor(duration/min));
  }
  if(max!==null&&max>0&&duration/count>max+EPSILON){
    count=Math.max(count,Math.ceil(duration/max));
  }
  return Math.max(1,count);
}

function sceneVisualBeats(
  transcript:Transcript,
  segment:TranscriptSegment,
  startSeconds:number,
  endSeconds:number,
  timing?:VisualBeatTiming,
  preferMotion=false
){
  const duration=Math.max(0,endSeconds-startSeconds);
  const count=visualBeatCount(duration,timing);
  if(count<=1){
    const beat=buildVisualBeat({segment,sequence:1,preferMotion});
    return [{
      ...beat,
      startSeconds,
      endSeconds,
      durationSeconds:duration
    }];
  }

  const words=transcriptWordsForSegment(transcript,segment);

  return Array.from({length:count},(_,index)=>{
    const beatStart=startSeconds+(duration*index/count);
    const beatEnd=index===count-1
      ?endSeconds
      :startSeconds+(duration*(index+1)/count);
    const subset=words.filter(word=>{
      const midpoint=(word.startSeconds+word.endSeconds)/2;
      return midpoint>=beatStart-EPSILON
        &&(index===count-1?midpoint<=beatEnd+EPSILON:midpoint<beatEnd-EPSILON);
    });
    const narration=subset.map(word=>word.text).join(' ').replace(/\s+/g,' ').trim()
      ||segment.text;
    const beat=buildVisualBeat({
      segment:{
        ...segment,
        startSeconds:beatStart,
        endSeconds:beatEnd,
        text:narration,
        wordIds:subset.map(word=>word.id)
      },
      sequence:index+1,
      preferMotion
    });
    return {
      ...beat,
      startSeconds:beatStart,
      endSeconds:beatEnd,
      durationSeconds:Math.max(0,beatEnd-beatStart),
      transcriptSegmentIds:[segment.id]
    };
  });
}

export function scenePlanAudioDuration(transcript:Transcript,audioDuration:number|null){
  const transcriptEnd=Math.max(0,...transcript.segments.map(segment=>segment.endSeconds??segment.startSeconds));
  return Math.max(audioDuration??0,transcriptEnd);
}

export function createInitialScenes(
  transcript:Transcript,
  audioDuration:number|null,
  visualBeatTiming?:VisualBeatTiming,
  dna?:ProductionDNA|null
):SceneTimecode[]{
  const segments=[...transcript.segments]
    .filter(segment=>segment.endSeconds!==null&&segment.endSeconds>segment.startSeconds)
    .sort((a,b)=>a.startSeconds-b.startSeconds);

  const total=scenePlanAudioDuration(transcript,audioDuration);
  if(!segments.length||total<=0)return [];
  const preferMotion=productionPrefersMotion(dna);

  const scenes=segments.flatMap((segment,index)=>{
    const next=segments[index+1];
    const start=index===0?0:segment.startSeconds;
    const rawEnd=next?next.startSeconds:total;
    const end=Math.max(segment.endSeconds!,rawEnd);
    const sceneEnd=Math.min(total,end);
    const beats=sceneVisualBeats(
      transcript,segment,start,sceneEnd,visualBeatTiming,preferMotion
    );
    return beats.map(beat=>({
      id:crypto.randomUUID(),
      sequence:0,
      startSeconds:beat.startSeconds,
      endSeconds:beat.endSeconds,
      durationSeconds:beat.durationSeconds,
      narration:beat.narration,
      transcriptSegmentIds:[segment.id],
      transcriptWordIds:[...beat.transcriptWordIds],
      visualIntent:'',
      shotType:'',
      characterIds:[],
      assetMode:(beat.sourcePreference==='stock-video'
        ?'video'
        :beat.sourcePreference==='mixed'
          ?'mixed'
          :beat.sourcePreference==='stock-image'||beat.sourcePreference==='archive-image'
            ?'stock'
            :'image') as SceneTimecode['assetMode'],
      promptDirection:'',
      notes:'',
      visualBeats:[{...beat,sequence:1}]
    }));
  });

  return scenes.map((scene,index)=>({...scene,sequence:index+1}));
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
      narration:scene.narration.trim(),
      visualBeats:scene.visualBeats
        ?[...scene.visualBeats]
          .sort((a,b)=>a.startSeconds-b.startSeconds||a.sequence-b.sequence)
          .map((beat,beatIndex)=>({
            ...beat,
            sequence:beatIndex+1,
            startSeconds:Math.max(scene.startSeconds,beat.startSeconds),
            endSeconds:Math.min(scene.endSeconds,beat.endSeconds),
            durationSeconds:Math.max(0,
              Math.min(scene.endSeconds,beat.endSeconds)
              -Math.max(scene.startSeconds,beat.startSeconds)
            ),
            narration:beat.narration.trim()
          }))
        :scene.visualBeats
    }));

  return {...payload,scenes,updatedAt:new Date().toISOString()};
}

export function scenePlanStructuralIssues(
  payload:ScenePlanPayload,
  transcript:Transcript
){
  const issues:string[]=[];
  const scenes=[...payload.scenes].sort((a,b)=>a.startSeconds-b.startSeconds);
  const expectedSegments=new Map(
    transcript.segments.map(segment=>[segment.id,segment])
  );
  const segmentScenes=new Map<string,SceneTimecode[]>();
  const expectedWords=new Set(transcript.words.map(word=>word.id));
  const wordCoverage=new Map<string,number>();

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
      if(!expectedSegments.has(id))issues.push('unknown-transcript-segment');
      const rows=segmentScenes.get(id)??[];
      rows.push(scene);
      segmentScenes.set(id,rows);
    });
    scene.transcriptWordIds.forEach(id=>{
      if(!expectedWords.has(id))issues.push('unknown-transcript-word');
      wordCoverage.set(id,(wordCoverage.get(id)??0)+1);
    });

    const beats=[...(scene.visualBeats??[])]
      .sort((a,b)=>a.startSeconds-b.startSeconds||a.sequence-b.sequence);
    beats.forEach((beat,beatIndex)=>{
      if(beat.endSeconds<=beat.startSeconds)issues.push('invalid-visual-beat-duration');
      if(beat.startSeconds<scene.startSeconds-EPSILON||beat.endSeconds>scene.endSeconds+EPSILON){
        issues.push('visual-beat-outside-scene');
      }
      if(!beat.narration.trim())issues.push('empty-visual-beat-narration');
      if(!beat.queries.length)issues.push('visual-beat-without-query');
      const previousBeat=beats[beatIndex-1];
      if(previousBeat){
        if(beat.startSeconds<previousBeat.endSeconds-EPSILON)issues.push('visual-beat-overlap');
        if(beat.startSeconds>previousBeat.endSeconds+EPSILON)issues.push('visual-beat-gap');
      }else if(beat.startSeconds>scene.startSeconds+EPSILON){
        issues.push('visual-beat-gap-at-start');
      }
    });
    if(beats.length&&beats.at(-1)!.endSeconds<scene.endSeconds-EPSILON){
      issues.push('visual-beat-gap-at-end');
    }
  });

  if(scenes.length&&scenes.at(-1)!.endSeconds<payload.audioDurationSeconds-EPSILON){
    issues.push('scene-gap-at-end');
  }

  for(const [id,segment] of expectedSegments){
    const rows=segmentScenes.get(id)??[];
    if(!rows.length){
      issues.push('missing-transcript-segment');
      continue;
    }
    const segmentWords=transcriptWordsForSegment(transcript,segment);
    const wordsToValidate=rows.length>1
      ?segmentWords
      :segment.wordIds
        .map(wordId=>transcript.words.find(word=>word.id===wordId))
        .filter((word):word is NonNullable<typeof word>=>Boolean(word));
    if(rows.length>1&&!segmentWords.length){
      issues.push('duplicate-transcript-segment-without-word-partition');
    }
    for(const word of wordsToValidate){
      const count=wordCoverage.get(word.id)??0;
      if(count===0)issues.push('missing-transcript-word');
      if(count>1)issues.push('duplicate-transcript-word');
    }
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
    if(min!==null&&scene.durationSeconds+EPSILON<min){
      warnings.push('scene-'+scene.sequence+'-below-min-duration');
    }
    if(max!==null){
      const beats=scene.visualBeats??[];
      if(beats.length){
        beats.forEach(beat=>{
          if(beat.durationSeconds-EPSILON>max){
            warnings.push(
              'scene-'+scene.sequence+'-beat-'+beat.sequence+'-above-max-duration'
            );
          }
        });
      }else if(scene.durationSeconds-EPSILON>max){
        warnings.push('scene-'+scene.sequence+'-above-max-duration');
      }
    }
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
  const visualStrategy=scenePlanVisualStrategyIssues(payload,dna);
  return [
    ...structural,
    ...visualStrategy,
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
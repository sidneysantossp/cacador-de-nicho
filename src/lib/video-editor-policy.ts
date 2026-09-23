import type {
  Timeline, TimelineClip, Transcript, VideoEditClipStyle, VideoEditMotionPreset,
  VideoEditPayload
} from '@/lib/types';

const EPSILON=.03;

function captionEnd(
  segment:Transcript['segments'][number],
  next:Transcript['segments'][number]|undefined,
  duration:number
){
  const raw=segment.endSeconds??next?.startSeconds??duration;
  return Math.max(segment.startSeconds,Math.min(duration,raw));
}

export function motionPresetValues(preset:VideoEditMotionPreset){
  if(preset==='zoom-in')return {scaleStart:1,scaleEnd:1.08,xStart:0,xEnd:0,yStart:0,yEnd:0};
  if(preset==='zoom-out')return {scaleStart:1.08,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0};
  if(preset==='pan-left')return {scaleStart:1.08,scaleEnd:1.08,xStart:.04,xEnd:-.04,yStart:0,yEnd:0};
  if(preset==='pan-right')return {scaleStart:1.08,scaleEnd:1.08,xStart:-.04,xEnd:.04,yStart:0,yEnd:0};
  return {scaleStart:1,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0};
}

function clipStyle(clip:TimelineClip):VideoEditClipStyle{
  return {
    timelineClipId:clip.id,
    sceneId:clip.sceneId!,
    motionPreset:'none',
    ...motionPresetValues('none'),
    transitionIn:'none',
    transitionOut:'none',
    transitionSeconds:0
  };
}

export function buildInitialVideoEdit(timeline:Timeline,transcript:Transcript):VideoEditPayload{
  const now=new Date().toISOString();
  const visual=timeline.tracks.find(track=>track.type==='visual');
  const segments=[...transcript.segments].sort((a,b)=>a.startSeconds-b.startSeconds);
  const cues=segments.flatMap((segment,index)=>{
    const start=Math.max(0,Math.min(timeline.durationSeconds,segment.startSeconds));
    const end=captionEnd(segment,segments[index+1],timeline.durationSeconds);
    if(!segment.text.trim()||end<=start)return [];
    return [{
      id:crypto.randomUUID(),
      transcriptSegmentId:segment.id,
      startSeconds:start,
      endSeconds:end,
      text:segment.text.trim()
    }];
  });

  return {
    kind:'video-edit',
    id:crypto.randomUUID(),
    channelId:timeline.channelId,
    episodeId:timeline.episodeId,
    timelineId:timeline.id,
    timelineVersion:timeline.version,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    format:{...timeline.format},
    durationSeconds:timeline.durationSeconds,
    clipStyles:(visual?.clips??[]).filter(clip=>clip.sceneId).map(clipStyle),
    captions:{
      enabled:cues.length>0,
      position:'bottom',
      fontSize:52,
      maxLines:2,
      backgroundOpacity:.35,
      cues
    },
    overlays:[],
    audioMix:{
      voiceVolume:1,
      musicVolume:.2,
      sfxVolume:.7,
      normalizeVoice:true,
      duckMusicUnderVoice:true
    },
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export function normalizeVideoEdit(payload:VideoEditPayload):VideoEditPayload{
  return {
    ...payload,
    clipStyles:[...payload.clipStyles],
    captions:{
      ...payload.captions,
      cues:[...payload.captions.cues]
        .map(cue=>({...cue,text:cue.text.trim()}))
        .sort((a,b)=>a.startSeconds-b.startSeconds)
    },
    overlays:[...payload.overlays]
      .map(overlay=>({...overlay,text:overlay.text.trim()}))
      .sort((a,b)=>a.startSeconds-b.startSeconds),
    updatedAt:new Date().toISOString()
  };
}

export function videoEditStructuralIssues(
  edit:VideoEditPayload,
  timeline:Timeline,
  transcript:Transcript
){
  const issues:string[]=[];
  if(edit.timelineVersion!==timeline.version)issues.push('stale-timeline-version');
  if(edit.transcriptVersion!==transcript.version)issues.push('stale-transcript-version');
  if(Math.abs(edit.durationSeconds-timeline.durationSeconds)>EPSILON)issues.push('duration-mismatch');
  if(
    edit.format.width!==timeline.format.width||
    edit.format.height!==timeline.format.height||
    edit.format.fps!==timeline.format.fps||
    edit.format.aspectRatio!==timeline.format.aspectRatio
  )issues.push('format-mismatch');

  const visual=timeline.tracks.find(track=>track.type==='visual');
  const visualClips=(visual?.clips??[]).filter(clip=>clip.sceneId);
  const styles=new Map<string,VideoEditClipStyle>();
  for(const style of edit.clipStyles){
    if(styles.has(style.timelineClipId))issues.push('duplicate-clip-style');
    styles.set(style.timelineClipId,style);
    if(style.scaleStart<.1||style.scaleStart>5||style.scaleEnd<.1||style.scaleEnd>5)issues.push('invalid-scale');
    if([style.xStart,style.xEnd,style.yStart,style.yEnd].some(value=>value<-2||value>2))issues.push('invalid-pan');
  }

  for(const clip of visualClips){
    const style=styles.get(clip.id);
    if(!style)issues.push('missing-clip-style');
    else{
      if(style.sceneId!==clip.sceneId)issues.push('clip-style-scene-mismatch');
      const hasTransition=style.transitionIn!=='none'||style.transitionOut!=='none';
      if(hasTransition&&style.transitionSeconds<=0)issues.push('transition-duration-missing');
      if(style.transitionSeconds>clip.durationSeconds/2+EPSILON)issues.push('transition-too-long');
    }
  }
  for(const id of styles.keys()){
    if(!visualClips.some(clip=>clip.id===id))issues.push('orphan-clip-style');
  }

  const transcriptSegments=new Map(transcript.segments.map(segment=>[segment.id,segment]));
  if(edit.captions.enabled&&!edit.captions.cues.length)issues.push('captions-enabled-without-cues');
  let previousEnd=0;
  for(const cue of edit.captions.cues){
    if(!transcriptSegments.has(cue.transcriptSegmentId))issues.push('caption-segment-missing');
    if(!cue.text.trim())issues.push('empty-caption');
    if(cue.endSeconds<=cue.startSeconds)issues.push('invalid-caption-duration');
    if(cue.startSeconds<0||cue.endSeconds>edit.durationSeconds+EPSILON)issues.push('caption-outside-timeline');
    if(cue.startSeconds<previousEnd-EPSILON)issues.push('caption-overlap');
    previousEnd=Math.max(previousEnd,cue.endSeconds);
  }

  for(const overlay of edit.overlays){
    if(!overlay.text.trim())issues.push('empty-overlay');
    if(overlay.endSeconds<=overlay.startSeconds)issues.push('invalid-overlay-duration');
    if(overlay.startSeconds<0||overlay.endSeconds>edit.durationSeconds+EPSILON)issues.push('overlay-outside-timeline');
    if(overlay.x<0||overlay.y<0||overlay.x+overlay.width>1+EPSILON||overlay.y+overlay.height>1+EPSILON){
      issues.push('overlay-outside-frame');
    }
  }

  if(edit.audioMix.voiceVolume<0||edit.audioMix.voiceVolume>2)issues.push('invalid-voice-volume');
  if(edit.audioMix.musicVolume<0||edit.audioMix.musicVolume>2)issues.push('invalid-music-volume');
  if(edit.audioMix.sfxVolume<0||edit.audioMix.sfxVolume>2)issues.push('invalid-sfx-volume');

  return [...new Set(issues)];
}

export function videoEditUpstreamIssues(input:{
  edit:VideoEditPayload;
  timeline:Timeline;
  transcript:Transcript;
}){
  const issues:string[]=[];
  if(input.timeline.status!=='approved')issues.push('timeline-not-approved');
  if(input.transcript.status!=='approved')issues.push('transcript-not-approved');
  if(input.edit.timelineVersion!==input.timeline.version)issues.push('stale-timeline-version');
  if(input.edit.transcriptVersion!==input.transcript.version)issues.push('stale-transcript-version');
  if(input.timeline.scenePlanId&&input.transcript.id!==input.edit.transcriptId)issues.push('transcript-mismatch');
  return [...new Set(issues)];
}

export function videoEditApprovalIssues(
  edit:VideoEditPayload,
  timeline:Timeline,
  transcript:Transcript
){
  return [...new Set([
    ...videoEditStructuralIssues(edit,timeline,transcript),
    ...videoEditUpstreamIssues({edit,timeline,transcript})
  ])];
}

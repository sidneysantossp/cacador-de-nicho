import type { RenderManifest, VideoEdit, Timeline, Transcript } from '@/lib/types';

export const DEFAULT_RENDER_CRF=20;
export const DEFAULT_RENDER_AUDIO_KBPS=192;

export function validRenderCrf(value:number){
  return Number.isInteger(value)&&value>=18&&value<=30;
}

export function validRenderAudioBitrate(value:number){
  return Number.isInteger(value)&&value>=96&&value<=320;
}

export function renderOutputPath(input:{
  channelId:string;
  episodeId:string;
  videoEditId:string;
  videoEditVersion:number;
  jobId:string;
}){
  return [
    'channels',input.channelId,'episodes',input.episodeId,'renders',
    input.videoEditId,'v'+String(input.videoEditVersion).padStart(4,'0'),
    input.jobId+'.mp4'
  ].join('/');
}

export function renderManifestIssues(
  manifest:RenderManifest,
  edit:VideoEdit,
  timeline:Timeline,
  transcript:Transcript
){
  const issues:string[]=[];

  if(edit.status!=='approved')issues.push('video-edit-not-approved');
  if(timeline.status!=='approved')issues.push('timeline-not-approved');
  if(transcript.status!=='approved')issues.push('transcript-not-approved');

  if(manifest.videoEditId!==edit.id||manifest.videoEditVersion!==edit.version){
    issues.push('video-edit-version-mismatch');
  }
  if(manifest.timelineId!==timeline.id||manifest.timelineVersion!==timeline.version){
    issues.push('timeline-version-mismatch');
  }
  if(manifest.transcriptId!==transcript.id||manifest.transcriptVersion!==transcript.version){
    issues.push('transcript-version-mismatch');
  }

  if(Math.abs(manifest.durationSeconds-edit.durationSeconds)>.03)issues.push('render-duration-mismatch');
  if(
    manifest.format.width!==edit.format.width||
    manifest.format.height!==edit.format.height||
    manifest.format.fps!==edit.format.fps||
    manifest.format.aspectRatio!==edit.format.aspectRatio
  )issues.push('render-format-mismatch');

  const visual=[...manifest.visualClips].sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!visual.length)issues.push('render-no-visual-clips');
  visual.forEach((clip,index)=>{
    if(!clip.assetId||!clip.storagePath)issues.push('render-source-missing');
    if(clip.kind!=='image'&&clip.kind!=='video')issues.push('render-source-kind-invalid');
    if(clip.endSeconds<=clip.startSeconds||clip.durationSeconds<=0)issues.push('render-clip-duration-invalid');
    if(Math.abs((clip.endSeconds-clip.startSeconds)-clip.durationSeconds)>.03)issues.push('render-clip-duration-mismatch');
    if(clip.style.timelineClipId!==clip.clipId||clip.style.sceneId!==clip.sceneId)issues.push('render-style-mismatch');
    if(clip.style.scaleStart<1||clip.style.scaleEnd<1)issues.push('render-scale-below-frame');
    if(clip.style.transitionSeconds>clip.durationSeconds/2+.03)issues.push('render-transition-too-long');
    const previous=visual[index-1];
    if(previous){
      if(clip.startSeconds>previous.endSeconds+.03)issues.push('render-visual-gap');
      if(clip.startSeconds<previous.endSeconds-.03)issues.push('render-visual-overlap');
    }else if(clip.startSeconds>.03)issues.push('render-visual-gap-at-start');
  });
  if(visual.length&&visual.at(-1)!.endSeconds<manifest.durationSeconds-.03)issues.push('render-visual-gap-at-end');

  if(!manifest.voice.assetId||!manifest.voice.storagePath)issues.push('render-voice-source-missing');

  const music=manifest.music??null;
  if(Boolean(edit.musicTrack)!==Boolean(music))issues.push('render-music-selection-mismatch');
  if(music){
    const placement=music.placement;
    if(!music.assetId||!music.storagePath)issues.push('render-music-source-missing');
    if(edit.musicTrack&&(
      edit.musicTrack.assetId!==music.assetId||
      edit.musicTrack.startSeconds!==placement.startSeconds||
      edit.musicTrack.endSeconds!==placement.endSeconds
    ))issues.push('render-music-selection-mismatch');
    if(placement.endSeconds<=placement.startSeconds)issues.push('render-music-duration-invalid');
    if(placement.startSeconds<0||placement.endSeconds>manifest.durationSeconds+.03)issues.push('render-music-outside-timeline');
    if(placement.sourceStartSeconds<0)issues.push('render-music-source-start-invalid');
    if(placement.volume<0||placement.volume>2)issues.push('render-music-volume-invalid');
    if(placement.duckingStrength<0||placement.duckingStrength>1)issues.push('render-music-ducking-invalid');
    const span=placement.endSeconds-placement.startSeconds;
    if(placement.fadeInSeconds<0||placement.fadeOutSeconds<0||placement.fadeInSeconds+placement.fadeOutSeconds>span+.03){
      issues.push('render-music-fade-invalid');
    }
    if(!placement.loop&&music.durationSeconds!==null&&placement.sourceStartSeconds+span>music.durationSeconds+.03){
      issues.push('render-music-source-too-short');
    }
  }

  const sfxEvents=manifest.sfxEvents??[];
  if(sfxEvents.length!==edit.sfxEvents.length)issues.push('render-sfx-selection-mismatch');
  const editSfx=new Map(edit.sfxEvents.map(event=>[event.id,event]));
  for(const item of sfxEvents){
    const event=item.event;
    const current=editSfx.get(event.id);
    if(!item.assetId||!item.storagePath)issues.push('render-sfx-source-missing');
    if(!current||current.assetId!==item.assetId||current.startSeconds!==event.startSeconds){
      issues.push('render-sfx-selection-mismatch');
    }
    if(event.durationSeconds<=0||event.startSeconds<0||event.startSeconds+event.durationSeconds>manifest.durationSeconds+.03){
      issues.push('render-sfx-outside-timeline');
    }
    if(event.sourceStartSeconds<0)issues.push('render-sfx-source-start-invalid');
    if(event.volume<0||event.volume>2)issues.push('render-sfx-volume-invalid');
    if(item.durationSeconds!==null&&event.sourceStartSeconds+event.durationSeconds>item.durationSeconds+.03){
      issues.push('render-sfx-source-too-short');
    }
  }

  for(const cue of manifest.captions.cues){
    if(cue.endSeconds<=cue.startSeconds)issues.push('render-caption-duration-invalid');
    if(cue.startSeconds<0||cue.endSeconds>manifest.durationSeconds+.03)issues.push('render-caption-outside-timeline');
  }
  for(const overlay of manifest.overlays){
    if(overlay.endSeconds<=overlay.startSeconds)issues.push('render-overlay-duration-invalid');
    if(overlay.startSeconds<0||overlay.endSeconds>manifest.durationSeconds+.03)issues.push('render-overlay-outside-timeline');
  }

  return [...new Set(issues)];
}

export function boundaryTransition(
  left:RenderManifest['visualClips'][number],
  right:RenderManifest['visualClips'][number]
){
  const kinds=[left.style.transitionOut,right.style.transitionIn];
  const wantsCross=kinds.includes('cross-dissolve');
  if(!wantsCross)return {kind:'none' as const,duration:0};
  const duration=Math.min(
    Math.max(left.style.transitionSeconds,right.style.transitionSeconds),
    left.durationSeconds/2,
    right.durationSeconds/2
  );
  return duration>0?{kind:'cross-dissolve' as const,duration}:{kind:'none' as const,duration:0};
}

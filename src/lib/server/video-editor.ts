import 'server-only';

import type {
  Timeline, Transcript, VideoEdit, VideoEditListItem, VideoEditPayload, VideoEditVersion, VideoEditVersionSummary
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  listTimelines, loadTimeline, loadTimelineSources
} from './timeline-engine';
import { loadScenePlan } from './scene-timecode';
import { loadTranscript } from './transcription-engine';
import {
  buildInitialVideoEdit, normalizeVideoEdit, resolveVideoEditorChapter,
  upgradeVideoEditPayload, videoEditApprovalIssues
} from '@/lib/video-editor-policy';
import { loadProductionDna } from './production-dna';
import { listAudioAssets } from './audio-library';

type Row={
  id:string;channel_id:string;episode_id:string;timeline_id:string;transcript_id:string;
  version:number;status:VideoEdit['status'];payload:unknown;created_at:string;updated_at:string;
};

function normalizeRow(row:Row):VideoEdit{
  const payload=upgradeVideoEditPayload(row.payload as Record<string,unknown>);
  return {
    ...payload,
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    timelineId:row.timeline_id,
    transcriptId:row.transcript_id,
    version:Number(row.version),
    status:row.status,
    createdAt:payload.createdAt??String(row.created_at),
    updatedAt:payload.updatedAt??String(row.updated_at)
  };
}

function normalizeListRow(row:{
  id:string;channel_id:string;episode_id:string;timeline_id:string;transcript_id:string;
  version:number;status:VideoEdit['status'];duration_seconds:number|string;width:number|string;height:number|string;
  clip_style_count:number|string;caption_count:number|string;overlay_count:number|string;
  created_at:string;updated_at:string;
}):VideoEditListItem{
  return {
    id:row.id,channelId:row.channel_id,episodeId:row.episode_id,timelineId:row.timeline_id,
    transcriptId:row.transcript_id,version:Number(row.version),status:row.status,
    durationSeconds:Number(row.duration_seconds),width:Number(row.width),height:Number(row.height),
    clipStyleCount:Number(row.clip_style_count),
    captionCount:Number(row.caption_count),overlayCount:Number(row.overlay_count),
    createdAt:String(row.created_at),updatedAt:String(row.updated_at)
  };
}

export async function listVideoEdits(channelId:string):Promise<VideoEditListItem[]>{
  const rows=checked(await db().from('radar_video_edit_list')
    .select('id,channel_id,episode_id,timeline_id,transcript_id,version,status,duration_seconds,width,height,clip_style_count,caption_count,overlay_count,created_at,updated_at')
    .eq('channel_id',channelId)
    .order('updated_at',{ascending:false})
    .limit(200));
  return (rows??[]).map(row=>normalizeListRow(row as never));
}

export async function loadVideoEdit(videoEditId:string):Promise<VideoEdit|null>{
  const row=checked(await db().from('radar_video_edits')
    .select('id,channel_id,episode_id,timeline_id,transcript_id,version,status,payload,created_at,updated_at')
    .eq('id',videoEditId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

export async function loadVideoEditByTimeline(timelineId:string):Promise<VideoEdit|null>{
  const row=checked(await db().from('radar_video_edits')
    .select('id,channel_id,episode_id,timeline_id,transcript_id,version,status,payload,created_at,updated_at')
    .eq('timeline_id',timelineId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

export async function loadVideoEditHistory(videoEditId:string,limit=20):Promise<VideoEditVersionSummary[]>{
  const rows=checked(await db().from('radar_video_edit_versions')
    .select('version,status,created_at')
    .eq('video_edit_id',videoEditId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as VideoEdit['status'],
    createdAt:String(row.created_at)
  }));
}

export async function loadVideoEditHistoryVersion(
  videoEditId:string,
  version:number
):Promise<VideoEditVersion|null>{
  const row=checked(await db().from('radar_video_edit_versions')
    .select('version,status,payload,created_at')
    .eq('video_edit_id',videoEditId)
    .eq('version',version)
    .maybeSingle());
  if(!row)return null;
  return {
    version:Number(row.version),
    status:row.status as VideoEdit['status'],
    payload:upgradeVideoEditPayload(row.payload as Record<string,unknown>),
    createdAt:String(row.created_at)
  };
}

async function eligibleContext(timelineId:string){
  const timeline=await loadTimeline(timelineId);
  if(!timeline)throw new HttpError('Timeline não encontrada.',404);
  if(timeline.status!=='approved')throw new HttpError('Aprove a Timeline antes de abrir o Video Editor.',409);

  const scenePlan=await loadScenePlan(timeline.scenePlanId);
  if(!scenePlan)throw new HttpError('Scene Plan da Timeline não encontrado.',404);
  const transcript=await loadTranscript(scenePlan.transcriptId);
  if(!transcript)throw new HttpError('Transcript da Timeline não encontrado.',404);
  if(transcript.status!=='approved')throw new HttpError('O Transcript precisa permanecer aprovado.',409);

  if(
    transcript.channelId!==timeline.channelId||
    transcript.episodeId!==timeline.episodeId||
    transcript.scriptId!==timeline.scriptId||
    transcript.voiceAssetId!==timeline.voiceAssetId
  )throw new HttpError('Transcript incompatível com a Timeline.',409);

  return {timeline,scenePlan,transcript};
}

export async function createVideoEditFromTimeline(timelineId:string):Promise<VideoEdit>{
  const existing=await loadVideoEditByTimeline(timelineId);
  if(existing)return existing;
  const {timeline,transcript}=await eligibleContext(timelineId);
  const dna=await loadProductionDna(timeline.channelId);
  return saveVideoEdit(buildInitialVideoEdit(timeline,transcript,dna),'draft',0);
}

export async function refreshVideoEditFromTimeline(timelineId:string):Promise<VideoEdit>{
  const existing=await loadVideoEditByTimeline(timelineId);
  if(!existing)return createVideoEditFromTimeline(timelineId);
  const {timeline,transcript}=await eligibleContext(timelineId);
  const dna=await loadProductionDna(timeline.channelId);
  const fresh=buildInitialVideoEdit(timeline,transcript,dna);

  const existingStyles=new Map(existing.clipStyles.map(style=>[style.sceneId,style]));
  fresh.clipStyles=fresh.clipStyles.map(style=>{
    const prior=existingStyles.get(style.sceneId);
    return prior
      ?{...prior,timelineClipId:style.timelineClipId,sceneId:style.sceneId}
      :style;
  });

  fresh.captions={
    ...fresh.captions,
    enabled:existing.captions.enabled,
    position:existing.captions.position,
    fontSize:existing.captions.fontSize,
    maxLines:existing.captions.maxLines,
    backgroundOpacity:existing.captions.backgroundOpacity,
    styleDescription:existing.captions.styleDescription,
    style:{...existing.captions.style},
    cues:existing.transcriptVersion===transcript.version
      ?structuredClone(existing.captions.cues)
      :fresh.captions.cues
  };
  fresh.audioMix={...existing.audioMix};
  if(Math.abs(existing.durationSeconds-timeline.durationSeconds)<=.03){
    fresh.musicTrack=existing.musicTrack?structuredClone(existing.musicTrack):null;
    fresh.sfxEvents=structuredClone(existing.sfxEvents);
    fresh.overlays=structuredClone(existing.overlays);
  }
  fresh.review={...existing.review};

  return saveVideoEdit({
    ...fresh,
    id:existing.id,
    createdAt:existing.createdAt
  },'draft',existing.version);
}

export async function saveVideoEdit(
  payload:VideoEditPayload,
  status:VideoEdit['status'],
  expectedVersion:number|null
):Promise<VideoEdit>{
  const {timeline,transcript}=await eligibleContext(payload.timelineId);
  if(
    payload.channelId!==timeline.channelId||
    payload.episodeId!==timeline.episodeId||
    payload.transcriptId!==transcript.id
  )throw new HttpError('Projeto do Video Editor incompatível com a Timeline.',409);

  const existing=await loadVideoEdit(payload.id);
  const normalized=normalizeVideoEdit({
    ...payload,
    createdAt:existing?.createdAt??payload.createdAt??new Date().toISOString(),
    updatedAt:new Date().toISOString()
  });

  if(status==='approved'){
    const audioAssets=await listAudioAssets(normalized.channelId);
    const issues=videoEditApprovalIssues(normalized,timeline,transcript,audioAssets);
    if(issues.length)throw new HttpError('Video Edit ainda não pode ser aprovado: '+issues.join(' · ')+'.',409);
  }

  const result=await db().rpc('save_video_edit',{
    p_video_edit_id:normalized.id,
    p_channel_id:normalized.channelId,
    p_episode_id:normalized.episodeId,
    p_timeline_id:normalized.timelineId,
    p_transcript_id:normalized.transcriptId,
    p_status:status,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('video edit version conflict'))throw new HttpError('Video Edit desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('timeline already has video edit'))throw new HttpError('Esta Timeline já possui um Video Edit.',409);
    if(message.includes('video edit upstream not eligible'))throw new HttpError('Timeline ou Transcript não estão mais elegíveis para edição.',409);
    throw new HttpError('Falha ao salvar o Video Edit no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Video Edit.',502);
  return {...normalized,version,status};
}

export async function videoEditorChannelState(channelId:string){
  const [edits,timelines]=await Promise.all([
    listVideoEdits(channelId),
    listTimelines(channelId)
  ]);
  return {
    edits,
    timelines:timelines.filter(timeline=>timeline.status==='approved')
  };
}

export async function loadVideoEditWorkspace(edit:VideoEdit,chapterId?:string){
  const context=await eligibleContext(edit.timelineId);
  const activeChapter=resolveVideoEditorChapter(context.timeline,chapterId);
  const [sources,audioAssets,productionDna]=await Promise.all([
    loadTimelineSources(context.timeline,activeChapter?.id),
    listAudioAssets(edit.channelId),
    loadProductionDna(edit.channelId)
  ]);
  return {
    timeline:context.timeline,
    transcript:context.transcript,
    scenePlan:context.scenePlan,
    activeChapterId:activeChapter?.id??null,
    sources,
    audioAssets,
    productionDna
  };
}

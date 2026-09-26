import 'server-only';

import { createHash } from 'node:crypto';
import type {
  RenderJob, RenderJobPayload, RenderManifest, RenderManifestVisualClip, RenderPreset,
  SceneAsset, VideoEdit
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { signedMediaUrl } from './media-storage';
import { loadVideoEdit, listVideoEdits, loadVideoEditWorkspace } from './video-editor';
import { loadVoiceAsset } from './voice-engine';
import { loadEpisodeScript } from './episode-script';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { assetIsStale } from '@/lib/asset-factory-policy';
import { voiceLibraryItemIsStale } from '@/lib/media-library-policy';
import { videoEditApprovalIssues } from '@/lib/video-editor-policy';
import { loadAudioAssetsByIds } from './audio-library';
import {
  DEFAULT_RENDER_AUDIO_KBPS, DEFAULT_RENDER_CRF, renderManifestIssues,
  renderOutputPath, renderPresetOutput, validRenderAudioBitrate, validRenderCrf
} from '@/lib/render-policy';


type Row={
  id:string;channel_id:string;episode_id:string;video_edit_id:string;video_edit_version:number;
  status:RenderJob['status'];progress:number;stage:string;attempts:number;
  output_path:string|null;output_bytes:number|string|null;error:string|null;payload:unknown;
  created_at:string;started_at:string|null;completed_at:string|null;updated_at:string;
};

type AssetRow={
  id:string;scene_id:string;asset_kind:SceneAsset['assetKind'];status:SceneAsset['status'];
  selected:boolean;storage_path:string;mime_type:string;duration_seconds:number|string|null;payload:unknown;
};

function hash(value:string){
  return createHash('sha256').update(value,'utf8').digest('hex');
}

async function signedOutput(path:string|null){
  if(!path)return null;
  return signedMediaUrl(path,3600);
}

async function normalizeRow(row:Row):Promise<RenderJob>{
  return {
    id:row.id,
    channelId:row.channel_id,
    episodeId:row.episode_id,
    videoEditId:row.video_edit_id,
    videoEditVersion:Number(row.video_edit_version),
    status:row.status,
    progress:Number(row.progress),
    stage:row.stage,
    attempts:Number(row.attempts),
    outputPath:row.output_path??undefined,
    outputBytes:row.output_bytes===null?undefined:Number(row.output_bytes),
    outputSignedUrl:await signedOutput(row.output_path),
    error:row.error??undefined,
    payload:row.payload as RenderJobPayload,
    createdAt:String(row.created_at),
    startedAt:row.started_at??undefined,
    completedAt:row.completed_at??undefined,
    updatedAt:String(row.updated_at)
  };
}

const selection='id,channel_id,episode_id,video_edit_id,video_edit_version,status,progress,stage,attempts,output_path,output_bytes,error,payload,created_at,started_at,completed_at,updated_at';

export async function listRenderJobs(channelId:string):Promise<RenderJob[]>{
  const rows=checked(await db().from('radar_render_jobs')
    .select(selection)
    .eq('channel_id',channelId)
    .order('created_at',{ascending:false})
    .limit(200));
  return Promise.all((rows??[]).map(row=>normalizeRow(row as Row)));
}

export async function loadRenderJob(jobId:string):Promise<RenderJob|null>{
  const row=checked(await db().from('radar_render_jobs')
    .select(selection)
    .eq('id',jobId)
    .maybeSingle());
  return row?normalizeRow(row as Row):null;
}

async function rawAssets(assetIds:string[]){
  if(!assetIds.length)return [] as AssetRow[];
  const rows=checked(await db().from('radar_scene_assets')
    .select('id,scene_id,asset_kind,status,selected,storage_path,mime_type,duration_seconds,payload')
    .in('id',assetIds));
  return (rows??[]) as AssetRow[];
}

export async function buildRenderManifest(videoEditId:string):Promise<RenderManifest>{
  const edit=await loadVideoEdit(videoEditId);
  if(!edit)throw new HttpError('Video Edit não encontrado.',404);
  if(edit.status!=='approved')throw new HttpError('Aprove o Video Edit antes de renderizar.',409);

  const workspace=await loadVideoEditWorkspace(edit);
  const {timeline,transcript,audioAssets}=workspace;
  const approvalIssues=videoEditApprovalIssues(edit,timeline,transcript,audioAssets);
  if(approvalIssues.length)throw new HttpError('Video Edit não está mais elegível para render: '+approvalIssues.join(' · ')+'.',409);

  const visual=timeline.tracks.find(track=>track.type==='visual');
  const clips=(visual?.clips??[]).filter(clip=>clip.sceneId&&clip.assetId);
  if(!clips.length)throw new HttpError('A Timeline aprovada não possui clips visuais renderizáveis.',409);

  const assetIds=clips.map(clip=>clip.assetId!);
  const [assetRows,voice,script,promptSet]=await Promise.all([
    rawAssets(assetIds),
    loadVoiceAsset(timeline.voiceAssetId),
    loadEpisodeScript(timeline.scriptId),
    loadVisualPromptSet(timeline.visualPromptSetId)
  ]);

  if(!voice||voice.status!=='ready'||!voice.storagePath)throw new HttpError('A narração da Timeline não está pronta para render.',409);
  if(!voice.selected)throw new HttpError('A Timeline usa um take de voz que não está mais ativo. Reconstrua Transcript, Scene Plan, Timeline e Video Edit a partir do take selecionado.',409);
  if(!script||script.status!=='approved')throw new HttpError('O roteiro deixou de estar aprovado.',409);
  if(!promptSet||promptSet.status!=='approved')throw new HttpError('O Visual Prompt Set deixou de estar aprovado.',409);
  if(promptSet.version!==timeline.visualPromptSetVersion)throw new HttpError('A Timeline usa uma versão antiga dos prompts visuais. Revise a Timeline antes de renderizar.',409);

  if(voiceLibraryItemIsStale({
    assetScriptVersion:voice.scriptVersion,
    assetTextHash:voice.textHash,
    currentScriptVersion:script.version,
    currentTextHash:hash(script.content)
  }))throw new HttpError('A narração ficou desatualizada em relação ao roteiro aprovado.',409);

  if(transcript.scriptVersion!==script.version)throw new HttpError('O Transcript ficou desatualizado em relação ao roteiro aprovado.',409);

  const assetMap=new Map(assetRows.map(row=>[row.id,row]));
  const promptMap=new Map(promptSet.scenePrompts.map(scene=>[scene.sceneId,scene]));
  const styleMap=new Map(edit.clipStyles.map(style=>[style.timelineClipId,style]));
  const manifestClips:RenderManifestVisualClip[]=[];

  for(const clip of clips){
    const row=assetMap.get(clip.assetId!);
    const style=styleMap.get(clip.id);
    if(!row)throw new HttpError('Um asset usado pela Timeline não existe mais.',409);
    if(row.status!=='ready'||!row.storage_path)throw new HttpError('Um asset usado pela Timeline não está pronto.',409);
    if(!row.selected)throw new HttpError('A seleção de mídia de uma cena mudou depois da aprovação da Timeline.',409);
    if(row.scene_id!==clip.sceneId)throw new HttpError('Um asset não pertence mais à cena esperada.',409);
    if(!style)throw new HttpError('Um clip da Timeline não possui estilo no Video Editor.',409);

    const currentPrompt=promptMap.get(row.scene_id);
    const payload=(row.payload??{}) as Record<string,unknown>;
    if(!currentPrompt||assetIsStale({
      promptSetVersion:Number(payload.promptSetVersion??0),
      prompt:String(payload.prompt??'')
    },promptSet.version,currentPrompt)){
      throw new HttpError('Um asset visual ficou desatualizado em relação ao prompt aprovado.',409);
    }

    const kind=row.asset_kind==='video'?'video':'image';
    manifestClips.push({
      clipId:clip.id,
      sceneId:clip.sceneId!,
      assetId:row.id,
      kind,
      storagePath:row.storage_path,
      mimeType:row.mime_type,
      startSeconds:clip.startSeconds,
      endSeconds:clip.endSeconds,
      durationSeconds:clip.durationSeconds,
      sourceStartSeconds:clip.sourceStartSeconds,
      sourceEndSeconds:clip.sourceEndSeconds,
      sourceWidth:clip.sourceWidth??null,
      sourceHeight:clip.sourceHeight??null,
      focusX:clip.focusX??null,
      focusY:clip.focusY??null,
      playback:clip.playback,
      fit:clip.fit,
      style
    });
  }

  const audioIds=[
    ...(edit.musicTrack?[edit.musicTrack.assetId]:[]),
    ...edit.sfxEvents.map(event=>event.assetId)
  ];
  const referencedAudio=audioIds.length?await loadAudioAssetsByIds(audioIds):[];
  const audioMap=new Map(referencedAudio.map(asset=>[asset.id,asset]));

  const music=edit.musicTrack?(()=>{
    const asset=audioMap.get(edit.musicTrack!.assetId);
    if(!asset||asset.channelId!==edit.channelId||asset.kind!=='music'||asset.status!=='ready'){
      throw new HttpError('A música selecionada não está pronta ou não pertence a este canal.',409);
    }
    return {
      assetId:asset.id,
      storagePath:asset.storagePath,
      mimeType:asset.mimeType,
      durationSeconds:asset.durationSeconds,
      placement:structuredClone(edit.musicTrack!)
    };
  })():null;

  const sfxEvents=edit.sfxEvents.map(event=>{
    const asset=audioMap.get(event.assetId);
    if(!asset||asset.channelId!==edit.channelId||asset.kind!=='sfx'||asset.status!=='ready'){
      throw new HttpError('Um SFX selecionado não está pronto ou não pertence a este canal.',409);
    }
    return {
      event:structuredClone(event),
      assetId:asset.id,
      storagePath:asset.storagePath,
      mimeType:asset.mimeType,
      durationSeconds:asset.durationSeconds
    };
  });

  const manifest:RenderManifest={
    videoEditId:edit.id,
    videoEditVersion:edit.version,
    timelineId:timeline.id,
    timelineVersion:timeline.version,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    format:{...edit.format},
    durationSeconds:edit.durationSeconds,
    visualClips:manifestClips,
    voice:{
      assetId:voice.id,
      storagePath:voice.storagePath,
      mimeType:voice.mimeType
    },
    music,
    sfxEvents,
    captions:structuredClone(edit.captions),
    overlays:structuredClone(edit.overlays),
    audioMix:structuredClone(edit.audioMix)
  };

  const manifestIssues=renderManifestIssues(manifest,edit,timeline,transcript);
  if(manifestIssues.length)throw new HttpError('Manifest de render inválido: '+manifestIssues.join(' · ')+'.',409);
  return manifest;
}

export async function createRenderJob(input:{
  videoEditId:string;
  preset?:RenderPreset;
  crf?:number;
  audioBitrateKbps?:number;
}):Promise<RenderJob>{
  const preset=input.preset??'source';
  const crf=input.crf??DEFAULT_RENDER_CRF;
  const audioBitrateKbps=input.audioBitrateKbps??DEFAULT_RENDER_AUDIO_KBPS;
  if(!validRenderCrf(crf))throw new HttpError('CRF deve ser um inteiro entre 18 e 30.',400);
  if(!validRenderAudioBitrate(audioBitrateKbps))throw new HttpError('Bitrate de áudio deve estar entre 96 e 320 kbps.',400);

  const edit=await loadVideoEdit(input.videoEditId);
  if(!edit)throw new HttpError('Video Edit não encontrado.',404);
  const manifest=await buildRenderManifest(input.videoEditId);
  const existing=checked(await db().from('radar_render_jobs')
    .select(selection)
    .eq('video_edit_id',manifest.videoEditId)
    .eq('video_edit_version',manifest.videoEditVersion)
    .in('status',['queued','processing'])
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle());
  if(existing)return normalizeRow(existing as Row);

  const id=crypto.randomUUID();
  const payload:RenderJobPayload={
    preset,
    videoCodec:'libx264',
    fallbackVideoCodecs:['mpeg4'],
    crf,
    audioCodec:'aac',
    audioBitrateKbps,
    outputFormat:renderPresetOutput(preset,manifest.format),
    compilerVersion:'render-v3',
    requestedBy:'operator',
    manifest
  };
  const inserted=await db().from('radar_render_jobs').insert({
    id,
    channel_id:edit.channelId,
    episode_id:edit.episodeId,
    video_edit_id:manifest.videoEditId,
    video_edit_version:manifest.videoEditVersion,
    status:'queued',
    progress:0,
    stage:'queued',
    attempts:0,
    payload
  });
  if(inserted.error){
    if(String(inserted.error.message??'').includes('radar_render_jobs_one_active_version')){
      const raced=checked(await db().from('radar_render_jobs')
        .select(selection)
        .eq('video_edit_id',manifest.videoEditId)
        .eq('video_edit_version',manifest.videoEditVersion)
        .in('status',['queued','processing'])
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle());
      if(raced)return normalizeRow(raced as Row);
    }
    throw new HttpError('Falha ao enfileirar o render.',502);
  }
  const job=await loadRenderJob(id);
  if(!job)throw new HttpError('Render foi enfileirado, mas não pôde ser recarregado.',502);
  return job;
}

export async function cancelRenderJob(jobId:string){
  const job=await loadRenderJob(jobId);
  if(!job)throw new HttpError('Render job não encontrado.',404);
  if(job.status==='completed'||job.status==='failed'||job.status==='cancelled')return job;
  checked(await db().from('radar_render_jobs').update({
    status:'cancelled',
    stage:'cancelled',
    worker_token:null,
    lease_until:null,
    completed_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  }).eq('id',jobId).in('status',['queued','processing']));
  return loadRenderJob(jobId);
}

export async function retryRenderJob(jobId:string){
  const job=await loadRenderJob(jobId);
  if(!job)throw new HttpError('Render job não encontrado.',404);
  if(job.status!=='failed'&&job.status!=='cancelled')throw new HttpError('Somente renders failed/cancelled podem ser reenfileirados.',409);
  const current=await loadVideoEdit(job.videoEditId);
  if(!current||current.version!==job.videoEditVersion||current.status!=='approved'){
    throw new HttpError('O Video Edit mudou desde este render. Crie um novo render da versão atual.',409);
  }
  return createRenderJob({
    videoEditId:job.videoEditId,
    preset:job.payload.preset??'source',
    crf:job.payload.crf,
    audioBitrateKbps:job.payload.audioBitrateKbps
  });
}

export async function renderEngineChannelState(channelId:string){
  const [jobs,edits]=await Promise.all([
    listRenderJobs(channelId),
    listVideoEdits(channelId)
  ]);
  return {
    jobs,
    videoEdits:edits.filter(edit=>edit.status==='approved')
  };
}

export async function expectedRenderOutputPath(jobId:string){
  const job=await loadRenderJob(jobId);
  if(!job)throw new HttpError('Render job não encontrado.',404);
  return renderOutputPath({
    channelId:job.channelId,
    episodeId:job.episodeId,
    videoEditId:job.videoEditId,
    videoEditVersion:job.videoEditVersion,
    jobId:job.id
  });
}

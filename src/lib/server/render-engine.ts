import 'server-only';

import { createHash } from 'node:crypto';
import type {
  RenderChapter, RenderChapterPlan, RenderJob, RenderJobPayload, RenderManifest,
  RenderManifestVisualClip, RenderPreset, SceneAsset, VideoEdit
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
import { timelineChapters } from '@/lib/timeline-policy';
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

type ChapterRow={
  id:string;render_job_id:string;chapter_id:string;sequence:number;label:string;
  start_seconds:number|string;end_seconds:number|string;duration_seconds:number|string;
  scene_ids:string[]|null;content_hash:string;status:RenderChapter['status'];progress:number;cache_hit:boolean;
  output_path:string|null;output_bytes:number|string|null;render_seconds:number|string|null;
  error:string|null;created_at:string;started_at:string|null;completed_at:string|null;updated_at:string;
};

function normalizeChapter(row:ChapterRow):RenderChapter{
  return {
    id:row.chapter_id,
    sequence:Number(row.sequence),
    label:String(row.label??''),
    startSeconds:Number(row.start_seconds),
    endSeconds:Number(row.end_seconds),
    durationSeconds:Number(row.duration_seconds),
    sceneIds:(row.scene_ids??[]).map(String),
    contentHash:String(row.content_hash),
    renderJobId:row.render_job_id,
    status:row.status,
    progress:Number(row.progress),
    cacheHit:Boolean(row.cache_hit),
    outputPath:row.output_path??undefined,
    outputBytes:row.output_bytes===null?undefined:Number(row.output_bytes),
    renderSeconds:row.render_seconds===null?undefined:Number(row.render_seconds),
    error:row.error??undefined,
    createdAt:String(row.created_at),
    startedAt:row.started_at??undefined,
    completedAt:row.completed_at??undefined,
    updatedAt:String(row.updated_at)
  };
}

const chapterSelection='id,render_job_id,chapter_id,sequence,label,start_seconds,end_seconds,duration_seconds,scene_ids,content_hash,status,progress,cache_hit,output_path,output_bytes,render_seconds,error,created_at,started_at,completed_at,updated_at';

async function renderChapters(jobId:string){
  const rows=checked(await db().from('radar_render_chapters')
    .select(chapterSelection)
    .eq('render_job_id',jobId)
    .order('sequence',{ascending:true})) as ChapterRow[];
  return (rows??[]).map(normalizeChapter);
}

function hash(value:string){
  return createHash('sha256').update(value,'utf8').digest('hex');
}

async function signedOutput(path:string|null){
  if(!path)return null;
  return signedMediaUrl(path,3600);
}

async function normalizeRow(row:Row,chapters?:RenderChapter[]):Promise<RenderJob>{
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
    chapters:chapters??await renderChapters(row.id),
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
    .limit(200)) as Row[];
  const ids=(rows??[]).map(row=>row.id);
  const chapterRows=ids.length
    ?checked(await db().from('radar_render_chapters')
      .select(chapterSelection)
      .in('render_job_id',ids)
      .order('sequence',{ascending:true})) as ChapterRow[]
    :[];
  const grouped=new Map<string,RenderChapter[]>();
  for(const row of chapterRows??[]){
    const items=grouped.get(row.render_job_id)??[];
    items.push(normalizeChapter(row));
    grouped.set(row.render_job_id,items);
  }
  return Promise.all((rows??[]).map(row=>normalizeRow(row,grouped.get(row.id)??[])));
}

export async function loadRenderJob(jobId:string):Promise<RenderJob|null>{
  const row=checked(await db().from('radar_render_jobs')
    .select(selection)
    .eq('id',jobId)
    .maybeSingle());
  return row?normalizeRow(row as Row,await renderChapters(jobId)):null;
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
    chapters:timelineChapters(timeline).map(chapter=>({
      id:chapter.id,
      sequence:chapter.sequence,
      label:chapter.label,
      startSeconds:chapter.startSeconds,
      endSeconds:chapter.endSeconds,
      durationSeconds:chapter.durationSeconds,
      sceneIds:[...chapter.sceneIds]
    })),
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

function relativeSeconds(value:number,start:number){
  return Math.max(0,Math.round((value-start)*1000)/1000);
}

function chapterPlanFor(input:{
  manifest:RenderManifest;
  preset:RenderPreset;
  crf:number;
}):RenderChapterPlan[]{
  const outputFormat=renderPresetOutput(input.preset,input.manifest.format);
  const chapters=input.manifest.chapters?.length
    ?[...input.manifest.chapters].sort((a,b)=>a.sequence-b.sequence)
    :[{
      id:input.manifest.timelineId,
      sequence:1,
      label:'Chapter 01',
      startSeconds:0,
      endSeconds:input.manifest.durationSeconds,
      durationSeconds:input.manifest.durationSeconds,
      sceneIds:input.manifest.visualClips.map(clip=>clip.sceneId)
    }];
  return chapters.map(chapter=>{
    const sceneIds=new Set(chapter.sceneIds);
    const clips=input.manifest.visualClips
      .filter(clip=>sceneIds.has(clip.sceneId))
      .map(clip=>({
        ...clip,
        startSeconds:relativeSeconds(clip.startSeconds,chapter.startSeconds),
        endSeconds:relativeSeconds(clip.endSeconds,chapter.startSeconds)
      }));
    const captions=input.manifest.captions.cues
      .filter(cue=>cue.endSeconds>chapter.startSeconds&&cue.startSeconds<chapter.endSeconds)
      .map(cue=>({
        ...cue,
        startSeconds:relativeSeconds(Math.max(chapter.startSeconds,cue.startSeconds),chapter.startSeconds),
        endSeconds:relativeSeconds(Math.min(chapter.endSeconds,cue.endSeconds),chapter.startSeconds),
        words:cue.words.map(word=>({
          ...word,
          startSeconds:relativeSeconds(Math.max(chapter.startSeconds,word.startSeconds),chapter.startSeconds),
          endSeconds:relativeSeconds(Math.min(chapter.endSeconds,word.endSeconds),chapter.startSeconds)
        }))
      }));
    const overlays=input.manifest.overlays
      .filter(item=>item.endSeconds>chapter.startSeconds&&item.startSeconds<chapter.endSeconds)
      .map(item=>({
        ...item,
        startSeconds:relativeSeconds(Math.max(chapter.startSeconds,item.startSeconds),chapter.startSeconds),
        endSeconds:relativeSeconds(Math.min(chapter.endSeconds,item.endSeconds),chapter.startSeconds)
      }));
    const contentHash=hash(JSON.stringify({
      compilerVersion:'render-v4',
      outputFormat,
      crf:input.crf,
      durationSeconds:chapter.durationSeconds,
      clips,
      captions:{
        enabled:input.manifest.captions.enabled,
        position:input.manifest.captions.position,
        fontSize:input.manifest.captions.fontSize,
        maxLines:input.manifest.captions.maxLines,
        backgroundOpacity:input.manifest.captions.backgroundOpacity,
        style:input.manifest.captions.style,
        cues:captions
      },
      overlays
    }));
    return {...chapter,contentHash};
  });
}

async function reusableChapterCache(hashes:string[]){
  if(!hashes.length)return new Map<string,ChapterRow>();
  const rows=checked(await db().from('radar_render_chapters')
    .select(chapterSelection)
    .in('content_hash',hashes)
    .eq('status','completed')
    .not('output_path','is',null)
    .order('completed_at',{ascending:false})
    .limit(1000)) as ChapterRow[];
  const result=new Map<string,ChapterRow>();
  for(const row of rows??[])if(!result.has(row.content_hash))result.set(row.content_hash,row);
  return result;
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
  const chapterPlan=chapterPlanFor({manifest,preset,crf});
  const cache=await reusableChapterCache(chapterPlan.map(chapter=>chapter.contentHash));
  const payload:RenderJobPayload={
    preset,
    videoCodec:'libx264',
    fallbackVideoCodecs:['mpeg4'],
    crf,
    audioCodec:'aac',
    audioBitrateKbps,
    outputFormat:renderPresetOutput(preset,manifest.format),
    compilerVersion:'render-v4',
    requestedBy:'operator',
    chapterPlan,
    resourceBudget:{maxConcurrentChapters:1,minFreeDiskGb:10},
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

  const chapterRows=chapterPlan.map(chapter=>{
    const reused=cache.get(chapter.contentHash);
    return {
      id:crypto.randomUUID(),
      render_job_id:id,
      chapter_id:chapter.id,
      sequence:chapter.sequence,
      label:chapter.label,
      start_seconds:chapter.startSeconds,
      end_seconds:chapter.endSeconds,
      duration_seconds:chapter.durationSeconds,
      scene_ids:chapter.sceneIds,
      content_hash:chapter.contentHash,
      status:reused?'completed':'queued',
      progress:reused?100:0,
      cache_hit:Boolean(reused),
      output_path:reused?.output_path??null,
      output_bytes:reused?.output_bytes??null,
      render_seconds:reused?.render_seconds??null,
      completed_at:reused?new Date().toISOString():null,
      error:null
    };
  });
  const chapterInsert=await db().from('radar_render_chapters').insert(chapterRows);
  if(chapterInsert.error){
    await db().from('radar_render_jobs').delete().eq('id',id);
    throw new HttpError('Falha ao preparar capítulos do render.',502);
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
  checked(await db().from('radar_render_chapters').update({
    status:'cancelled',
    updated_at:new Date().toISOString()
  }).eq('render_job_id',jobId).in('status',['queued','processing']));
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

export async function retryRenderChapter(jobId:string,chapterId:string){
  const job=await loadRenderJob(jobId);
  if(!job)throw new HttpError('Render job não encontrado.',404);
  const chapter=job.chapters?.find(item=>item.id===chapterId);
  if(!chapter)throw new HttpError('Capítulo do render não encontrado.',404);
  if(chapter.status!=='failed'&&chapter.status!=='cancelled'){
    throw new HttpError('Somente capítulos failed/cancelled podem ser reenfileirados.',409);
  }
  if(job.status!=='failed'&&job.status!=='cancelled'){
    throw new HttpError('O job master ainda está ativo. Aguarde ou cancele antes de refazer o capítulo.',409);
  }
  return retryRenderJob(jobId);
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

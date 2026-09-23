import 'server-only';

import { createHash } from 'node:crypto';
import type {
  EpisodeScriptPayload, MediaLibraryItem, SceneAssetLicense,
  VisualPromptSetPayload
} from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  normalizeMediaTags, sceneLibraryItemIsStale, voiceLibraryItemIsStale
} from '@/lib/media-library-policy';

const BUCKET='cacadores-media';

type MetaRow={
  media_key:string;channel_id:string;resource_type:'scene_asset'|'voice_asset';resource_id:string;
  favorite:boolean;tags:string[]|null;notes:string;created_at:string;updated_at:string;
};

type SceneRow={
  id:string;channel_id:string;episode_id:string;scene_plan_id:string;visual_prompt_set_id:string;
  scene_id:string;variant:number;asset_kind:'image'|'video'|'graphic';source_type:string;
  provider:string|null;selected:boolean;storage_path:string;mime_type:string;original_name:string|null;
  bytes:number|string;width:number|null;height:number|null;duration_seconds:number|string|null;
  payload:unknown;created_at:string;updated_at:string;
};

type VoiceRow={
  id:string;channel_id:string;episode_id:string;script_id:string;take:number;source_type:string;
  provider:string|null;selected:boolean;storage_path:string;mime_type:string;original_name:string|null;
  bytes:number|string;payload:unknown;created_at:string;updated_at:string;
};

function hash(value:string){
  return createHash('sha256').update(value,'utf8').digest('hex');
}

function mediaKey(type:'scene_asset'|'voice_asset',id:string){
  return type+':'+id;
}

function metadataMap(rows:MetaRow[]){
  return new Map(rows.map(row=>[row.media_key,row]));
}

async function signedUrl(path:string){
  if(!path)return null;
  const result=await db().storage.from(BUCKET).createSignedUrl(path,3600);
  return result.error?null:result.data.signedUrl;
}

export async function listMediaLibrary(
  channelId:string,
  options:{page?:number;limit?:number}={}
){
  const page=Math.max(1,Math.min(Number(options.page??1)||1,100));
  const limit=Math.max(12,Math.min(Number(options.limit??60)||60,120));
  const fetchLimit=Math.min(page*limit,5000);

  const [sceneRows,voiceRows,metaRows]=await Promise.all([
    db().from('radar_scene_assets')
      .select('id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,selected,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload,created_at,updated_at')
      .eq('channel_id',channelId).eq('status','ready')
      .order('created_at',{ascending:false}).range(0,fetchLimit-1),
    db().from('radar_voice_assets')
      .select('id,channel_id,episode_id,script_id,take,source_type,provider,selected,storage_path,mime_type,original_name,bytes,payload,created_at,updated_at')
      .eq('channel_id',channelId).eq('status','ready')
      .order('created_at',{ascending:false}).range(0,fetchLimit-1),
    db().from('radar_media_library_metadata')
      .select('media_key,channel_id,resource_type,resource_id,favorite,tags,notes,created_at,updated_at')
      .eq('channel_id',channelId)
  ]);

  if(sceneRows.error||voiceRows.error||metaRows.error)throw new HttpError('Falha ao carregar a Media Library.',502);

  const combined=[
    ...(sceneRows.data??[]).map(row=>({kind:'scene' as const,row:row as SceneRow,createdAt:String(row.created_at)})),
    ...(voiceRows.data??[]).map(row=>({kind:'voice' as const,row:row as VoiceRow,createdAt:String(row.created_at)}))
  ].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));

  const total=combined.length;
  const start=(page-1)*limit;
  const selected=combined.slice(start,start+limit);
  const metas=metadataMap((metaRows.data??[]) as MetaRow[]);

  const scriptIds=[...new Set(selected.filter(item=>item.kind==='voice').map(item=>(item.row as VoiceRow).script_id))];
  const promptSetIds=[...new Set(selected.filter(item=>item.kind==='scene').map(item=>(item.row as SceneRow).visual_prompt_set_id))];

  const [scripts,promptSets]=await Promise.all([
    scriptIds.length
      ?db().from('radar_episode_scripts').select('id,version,payload').in('id',scriptIds)
      :Promise.resolve({data:[],error:null}),
    promptSetIds.length
      ?db().from('radar_visual_prompt_sets').select('id,version,payload').in('id',promptSetIds)
      :Promise.resolve({data:[],error:null})
  ]);

  if(scripts.error||promptSets.error)throw new HttpError('Falha ao verificar a atualidade dos assets.',502);

  const scriptMap=new Map((scripts.data??[]).map(row=>[String(row.id),row]));
  const promptSetMap=new Map((promptSets.data??[]).map(row=>[String(row.id),row]));

  const items=await Promise.all(selected.map(async entry=>{
    if(entry.kind==='voice'){
      const row=entry.row as VoiceRow;
      const payload=(row.payload??{}) as Record<string,unknown>;
      const meta=metas.get(mediaKey('voice_asset',row.id));
      const scriptRow=scriptMap.get(row.script_id);
      const scriptPayload=(scriptRow?.payload??{}) as Partial<EpisodeScriptPayload>;
      const scriptVersion=Number(payload.scriptVersion??0);
      const textHash=String(payload.textHash??'');
      const stale=!scriptRow||!scriptPayload.content||voiceLibraryItemIsStale({
        assetScriptVersion:scriptVersion,
        assetTextHash:textHash,
        currentScriptVersion:Number(scriptRow.version),
        currentTextHash:hash(String(scriptPayload.content))
      });

      return {
        mediaKey:mediaKey('voice_asset',row.id),
        resourceType:'voice_asset',
        resourceId:row.id,
        channelId:row.channel_id,
        episodeId:row.episode_id,
        mediaKind:'audio',
        sourceType:row.source_type,
        provider:row.provider??undefined,
        title:row.original_name||('Voice Take '+String(row.take).padStart(2,'0')),
        originalName:row.original_name??undefined,
        mimeType:row.mime_type,
        bytes:Number(row.bytes??0),
        width:null,
        height:null,
        durationSeconds:typeof payload.durationSeconds==='number'?payload.durationSeconds:null,
        storagePath:row.storage_path,
        signedUrl:await signedUrl(row.storage_path),
        selected:!!row.selected,
        stale,
        favorite:!!meta?.favorite,
        tags:meta?.tags??[],
        notes:meta?.notes??'',
        scriptId:row.script_id,
        voiceTake:Number(row.take),
        createdAt:String(row.created_at),
        updatedAt:String(row.updated_at)
      } satisfies MediaLibraryItem;
    }

    const row=entry.row as SceneRow;
    const payload=(row.payload??{}) as Record<string,unknown>;
    const meta=metas.get(mediaKey('scene_asset',row.id));
    const currentRow=promptSetMap.get(row.visual_prompt_set_id);
    const currentPayload=(currentRow?.payload??{}) as Partial<VisualPromptSetPayload>;
    const scenePrompts=Array.isArray(currentPayload.scenePrompts)?currentPayload.scenePrompts:[];
    const currentScene=scenePrompts.find(scene=>scene.sceneId===row.scene_id);
    const stale=!currentRow||sceneLibraryItemIsStale({
      assetPromptSetVersion:Number(payload.promptSetVersion??0),
      assetPrompt:String(payload.prompt??''),
      currentPromptSetVersion:Number(currentRow.version),
      currentPrompt:currentScene?String(currentScene.prompt??''):null
    });

    const stock=payload.stock&&typeof payload.stock==='object'
      ?payload.stock as MediaLibraryItem['stock']
      :undefined;
    const license=payload.license&&typeof payload.license==='object'
      ?payload.license as SceneAssetLicense
      :undefined;

    return {
      mediaKey:mediaKey('scene_asset',row.id),
      resourceType:'scene_asset',
      resourceId:row.id,
      channelId:row.channel_id,
      episodeId:row.episode_id,
      mediaKind:row.asset_kind==='video'?'video':'image',
      sourceType:row.source_type,
      provider:row.provider??undefined,
      title:row.original_name||[
        'Scene',
        String(payload.timecodeLabel??row.scene_id),
        'v'+String(row.variant).padStart(2,'0')
      ].join(' '),
      originalName:row.original_name??undefined,
      mimeType:row.mime_type,
      bytes:Number(row.bytes??0),
      width:row.width===null?null:Number(row.width),
      height:row.height===null?null:Number(row.height),
      durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),
      storagePath:row.storage_path,
      signedUrl:await signedUrl(row.storage_path),
      selected:!!row.selected,
      stale,
      favorite:!!meta?.favorite,
      tags:meta?.tags??[],
      notes:meta?.notes??'',
      scenePlanId:row.scene_plan_id,
      visualPromptSetId:row.visual_prompt_set_id,
      sceneId:row.scene_id,
      variant:Number(row.variant),
      timecodeLabel:String(payload.timecodeLabel??''),
      prompt:String(payload.prompt??''),
      license,
      stock,
      createdAt:String(row.created_at),
      updatedAt:String(row.updated_at)
    } satisfies MediaLibraryItem;
  }));

  return {
    items,
    page,
    limit,
    total,
    hasMore:start+items.length<total
  };
}

export async function saveMediaLibraryMetadata(input:{
  channelId:string;
  resourceType:'scene_asset'|'voice_asset';
  resourceId:string;
  favorite:boolean;
  tags:string[];
  notes:string;
}){
  const table=input.resourceType==='scene_asset'?'radar_scene_assets':'radar_voice_assets';
  const exists=checked(await db().from(table)
    .select('id,channel_id')
    .eq('id',input.resourceId)
    .eq('channel_id',input.channelId)
    .maybeSingle());
  if(!exists)throw new HttpError('Mídia não encontrada neste canal.',404);

  const tags=normalizeMediaTags(input.tags);
  const notes=input.notes.trim().slice(0,5000);
  const key=mediaKey(input.resourceType,input.resourceId);
  const result=await db().from('radar_media_library_metadata').upsert({
    media_key:key,
    channel_id:input.channelId,
    resource_type:input.resourceType,
    resource_id:input.resourceId,
    favorite:input.favorite,
    tags,
    notes,
    updated_at:new Date().toISOString()
  },{onConflict:'media_key'});
  if(result.error)throw new HttpError('Falha ao salvar os metadados da mídia.',502);

  return {mediaKey:key,favorite:input.favorite,tags,notes};
}

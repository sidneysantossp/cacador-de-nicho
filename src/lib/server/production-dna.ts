import 'server-only';

import type { ManagedChannel, ProductionDNA, ProductionDnaPayload, ProductionDnaVersion } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { ownedReferenceAssetIds } from '@/lib/asset-factory-policy';

export function createDefaultProductionDna(channel:ManagedChannel):ProductionDnaPayload{
  const now=new Date().toISOString();
  return {
    kind:'production-dna',
    channelId:channel.id,
    format:{
      aspectRatio:'16:9',
      width:1920,
      height:1080,
      fps:30,
      targetDurationMinutes:{min:null,max:null},
      sceneDurationSeconds:{min:null,preferred:null,max:null}
    },
    visual:{
      styleName:'',
      styleDescription:'',
      palette:[],
      compositionRules:[],
      cameraRules:[],
      motionRules:[],
      basePrompt:'',
      scenePromptTemplate:'{{scene_direction}} + {{character_bible}} + {{visual_bible}} + {{negative_rules}} + {{aspect_ratio}}',
      negativePrompt:'',
      forbidden:[]
    },
    characters:[],
    voice:{
      language:'English',
      providerPreference:[],
      voiceId:'',
      voiceName:'',
      narrationStyle:[],
      paceWpm:null,
      pronunciationRules:[]
    },
    captions:{
      enabled:true,
      styleDescription:'',
      position:'bottom-center',
      maxWordsPerCaption:null,
      highlightKeywords:false
    },
    editing:{
      transitions:[],
      defaultTransition:'cut',
      kenBurns:false,
      musicStyle:[],
      sfxRules:[],
      pacingRules:[]
    },
    thumbnail:{
      styleRules:[],
      forbidden:[]
    },
    providers:{
      image:[],
      video:[],
      voice:[],
      stock:[]
    },
    createdAt:now,
    updatedAt:now
  };
}

export function normalizeProductionDnaPayload(
  payload:unknown,
  channelId:string
):ProductionDnaPayload{
  const defaults=createDefaultProductionDna({id:channelId} as ManagedChannel);
  const raw=(payload&&typeof payload==='object'?payload:{}) as Partial<ProductionDnaPayload>&Record<string,unknown>;
  const format=raw.format??defaults.format;
  const visual=raw.visual??defaults.visual;
  const voice=raw.voice??defaults.voice;
  const captions=raw.captions??defaults.captions;
  const editing=raw.editing??defaults.editing;
  const thumbnail=raw.thumbnail??defaults.thumbnail;
  const providers=raw.providers??defaults.providers;
  return {
    ...defaults,
    ...raw,
    kind:'production-dna',
    channelId,
    format:{
      ...defaults.format,
      ...format,
      targetDurationMinutes:{...defaults.format.targetDurationMinutes,...format.targetDurationMinutes},
      sceneDurationSeconds:{...defaults.format.sceneDurationSeconds,...format.sceneDurationSeconds}
    },
    visual:{
      ...defaults.visual,
      ...visual,
      palette:Array.isArray(visual.palette)?visual.palette:[],
      compositionRules:Array.isArray(visual.compositionRules)?visual.compositionRules:[],
      cameraRules:Array.isArray(visual.cameraRules)?visual.cameraRules:[],
      motionRules:Array.isArray(visual.motionRules)?visual.motionRules:[],
      forbidden:Array.isArray(visual.forbidden)?visual.forbidden:[]
    },
    characters:Array.isArray(raw.characters)?raw.characters:[],
    voice:{
      ...defaults.voice,
      ...voice,
      providerPreference:Array.isArray(voice.providerPreference)?voice.providerPreference:[],
      narrationStyle:Array.isArray(voice.narrationStyle)?voice.narrationStyle:[],
      pronunciationRules:Array.isArray(voice.pronunciationRules)?voice.pronunciationRules:[]
    },
    captions:{...defaults.captions,...captions},
    editing:{
      ...defaults.editing,
      ...editing,
      transitions:Array.isArray(editing.transitions)?editing.transitions:[],
      musicStyle:Array.isArray(editing.musicStyle)?editing.musicStyle:[],
      sfxRules:Array.isArray(editing.sfxRules)?editing.sfxRules:[],
      pacingRules:Array.isArray(editing.pacingRules)?editing.pacingRules:[]
    },
    thumbnail:{
      ...defaults.thumbnail,
      ...thumbnail,
      styleRules:Array.isArray(thumbnail.styleRules)?thumbnail.styleRules:[],
      forbidden:Array.isArray(thumbnail.forbidden)?thumbnail.forbidden:[]
    },
    providers:{
      ...defaults.providers,
      ...providers,
      image:Array.isArray(providers.image)?providers.image:[],
      video:Array.isArray(providers.video)?providers.video:[],
      voice:Array.isArray(providers.voice)?providers.voice:[],
      stock:Array.isArray(providers.stock)?providers.stock:[]
    },
    createdAt:typeof raw.createdAt==='string'?raw.createdAt:defaults.createdAt,
    updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:defaults.updatedAt
  };
}

export async function loadProductionDna(channelId:string):Promise<ProductionDNA|null>{
  const row=checked(await db().from('radar_production_dna')
    .select('id,version,payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)return null;
  return {...normalizeProductionDnaPayload(row.payload,String(row.id)),version:Number(row.version)};
}

export async function loadProductionDnaHistory(channelId:string,limit=20):Promise<ProductionDnaVersion[]>{
  const rows=checked(await db().from('radar_production_dna_versions')
    .select('version,payload,created_at')
    .eq('channel_id',channelId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    payload:row.payload as ProductionDnaPayload,
    createdAt:String(row.created_at)
  }));
}

export async function patchProductionDnaVoice(input:{
  channelId:string;
  expectedVersion:number;
  voice:ProductionDnaPayload['voice'];
}):Promise<ProductionDNA>{
  const current=await loadProductionDna(input.channelId);
  if(!current)throw new HttpError('Production DNA não encontrado para este canal.',404);
  if(current.version!==input.expectedVersion){
    throw new HttpError('Production DNA desatualizado. Recarregue antes de salvar novamente.',409);
  }
  const now=new Date().toISOString();
  const raw={...(current as unknown as Record<string,unknown>)};
  delete raw.version;
  const normalized={
    ...raw,
    voice:input.voice,
    channelId:input.channelId,
    updatedAt:now
  };
  const result=await db().rpc('save_production_dna',{
    p_channel_id:input.channelId,
    p_payload:normalized,
    p_expected_version:input.expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('production dna version conflict'))throw new HttpError('Production DNA desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('managed channel not found'))throw new HttpError('Canal não encontrado na Gestão de Canais.',404);
    throw new HttpError('Falha ao atualizar a voz do Production DNA no Supabase.',502);
  }
  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Production DNA.',502);
  return {...normalized,version} as ProductionDNA;
}

export async function patchProductionDnaCharacterReferences(input:{
  channelId:string;
  expectedVersion:number;
  references:Array<{characterId:string;referenceAssets:string[]}>;
}):Promise<ProductionDNA>{
  const current=await loadProductionDna(input.channelId);
  if(!current)throw new HttpError('Production DNA não encontrado para este canal.',404);
  if(current.version!==input.expectedVersion){
    throw new HttpError('Production DNA desatualizado. Recarregue antes de salvar novamente.',409);
  }
  const uniqueCharacters=new Set(input.references.map(item=>item.characterId));
  if(uniqueCharacters.size!==input.references.length){
    throw new HttpError('A atualização contém personagens duplicados.',400);
  }

  const requestedAssetIds=[...new Set(input.references.flatMap(item=>ownedReferenceAssetIds(item.referenceAssets)))];
  if(requestedAssetIds.length){
    const rows=checked(await db().from('radar_owned_media_assets')
      .select('id,asset_kind,status')
      .in('id',requestedAssetIds));
    const readyImages=new Set((rows??[])
      .filter(row=>row.status==='ready'&&row.asset_kind==='image')
      .map(row=>String(row.id)));
    const missing=requestedAssetIds.filter(id=>!readyImages.has(id));
    if(missing.length){
      throw new HttpError('Finalize as imagens de referência na Biblioteca antes de travar o Production DNA.',409);
    }
  }

  const raw={...(current as unknown as Record<string,unknown>)};
  delete raw.version;
  const sourceCharacters=Array.isArray(raw.characters)?raw.characters:[];
  const updates=new Map(input.references.map(item=>[item.characterId,item.referenceAssets]));
  for(const characterId of updates.keys()){
    const exists=sourceCharacters.some(character=>
      !!character&&typeof character==='object'&&String((character as Record<string,unknown>).id??'')===characterId
    );
    if(!exists)throw new HttpError('Personagem não encontrado no Production DNA: '+characterId+'.',404);
  }
  const characters=sourceCharacters.map(character=>{
    if(!character||typeof character!=='object')return character;
    const item=character as Record<string,unknown>;
    const characterId=String(item.id??'');
    const referenceAssets=updates.get(characterId);
    if(referenceAssets===undefined)return character;
    return {
      ...item,
      referenceAssets:[...referenceAssets],
      referenceStatus:referenceAssets.length?'locked':'needs-reference'
    };
  });
  const now=new Date().toISOString();
  const normalized={...raw,characters,channelId:input.channelId,updatedAt:now};
  const result=await db().rpc('save_production_dna',{
    p_channel_id:input.channelId,
    p_payload:normalized,
    p_expected_version:input.expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('production dna version conflict'))throw new HttpError('Production DNA desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('managed channel not found'))throw new HttpError('Canal não encontrado na Gestão de Canais.',404);
    throw new HttpError('Falha ao atualizar referências do Production DNA no Supabase.',502);
  }
  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Production DNA.',502);
  return {...normalized,version} as ProductionDNA;
}

export async function saveProductionDna(
  payload:ProductionDnaPayload,
  expectedVersion:number|null
):Promise<ProductionDNA>{
  const now=new Date().toISOString();
  const current=await loadProductionDna(payload.channelId);
  const normalized:ProductionDnaPayload={
    ...payload,
    createdAt:current?.createdAt??payload.createdAt??now,
    updatedAt:now
  };

  const result=await db().rpc('save_production_dna',{
    p_channel_id:payload.channelId,
    p_payload:normalized,
    p_expected_version:expectedVersion
  });

  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('production dna version conflict'))throw new HttpError('Production DNA desatualizado. Recarregue antes de salvar novamente.',409);
    if(message.includes('managed channel not found'))throw new HttpError('Canal não encontrado na Gestão de Canais.',404);
    throw new HttpError('Falha ao salvar o Production DNA no Supabase.',502);
  }

  const version=Number(result.data);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Production DNA.',502);
  return {...normalized,version};
}

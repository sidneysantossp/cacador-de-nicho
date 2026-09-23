import 'server-only';

import type { ManagedChannel, ProductionDNA, ProductionDnaPayload, ProductionDnaVersion } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';

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

export async function loadProductionDna(channelId:string):Promise<ProductionDNA|null>{
  const row=checked(await db().from('radar_production_dna')
    .select('id,version,payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)return null;
  return {...row.payload as ProductionDnaPayload,channelId:String(row.id),version:Number(row.version)};
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

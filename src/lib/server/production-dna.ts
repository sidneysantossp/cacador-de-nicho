import 'server-only';

import type { ManagedChannel, ProductionDNA, ProductionDnaPayload, ProductionDnaVersion } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';

function list(value:unknown){
  return Array.isArray(value)?value.map(item=>String(item)).filter(Boolean):[];
}

export function normalizeProductionDnaPayload(
  raw:unknown,
  channelId:string
):ProductionDnaPayload{
  const value=(raw??{}) as Record<string,any>;
  const visual=(value.visual??{}) as Record<string,any>;
  const legacyEditing=(visual.editing??{}) as Record<string,any>;
  const editing=(value.editing??legacyEditing??{}) as Record<string,any>;
  const now=new Date().toISOString();

  return {
    kind:'production-dna',
    channelId,
    format:{
      aspectRatio:String(value.format?.aspectRatio??'16:9'),
      width:Number(value.format?.width??1920),
      height:Number(value.format?.height??1080),
      fps:Number(value.format?.fps??30),
      targetDurationMinutes:{
        min:value.format?.targetDurationMinutes?.min??null,
        max:value.format?.targetDurationMinutes?.max??null
      },
      sceneDurationSeconds:{
        min:value.format?.sceneDurationSeconds?.min??null,
        preferred:value.format?.sceneDurationSeconds?.preferred??null,
        max:value.format?.sceneDurationSeconds?.max??null
      }
    },
    visual:{
      styleName:String(visual.styleName??''),
      styleDescription:String(visual.styleDescription??''),
      palette:list(visual.palette),
      compositionRules:list(visual.compositionRules),
      cameraRules:list(visual.cameraRules),
      motionRules:list(visual.motionRules),
      basePrompt:String(visual.basePrompt??''),
      scenePromptTemplate:String(
        visual.scenePromptTemplate??
        '{{scene_direction}} + {{character_bible}} + {{visual_bible}} + {{negative_rules}} + {{aspect_ratio}}'
      ),
      negativePrompt:String(visual.negativePrompt??''),
      forbidden:list(visual.forbidden),
      visualMoat:visual.visualMoat?String(visual.visualMoat):undefined,
      qualityBenchmark:visual.qualityBenchmark
    },
    characters:Array.isArray(value.characters)?value.characters.map((item:any)=>({
      id:String(item?.id??crypto.randomUUID()),
      name:String(item?.name??'Character'),
      description:String(item?.description??''),
      role:item?.role?String(item.role):undefined,
      referenceStatus:['locked','needs-reference','ready'].includes(String(item?.referenceStatus))
        ?item.referenceStatus
        :undefined,
      visualRules:list(item?.visualRules),
      forbidden:list(item?.forbidden),
      referenceAssets:list(item?.referenceAssets)
    })):[],
    voice:{
      language:String(value.voice?.language??'English'),
      providerPreference:list(value.voice?.providerPreference),
      voiceId:String(value.voice?.voiceId??''),
      voiceName:String(value.voice?.voiceName??''),
      narrationStyle:list(value.voice?.narrationStyle),
      paceWpm:value.voice?.paceWpm??null,
      pronunciationRules:list(value.voice?.pronunciationRules)
    },
    captions:{
      enabled:value.captions?.enabled??true,
      styleDescription:String(value.captions?.styleDescription??''),
      position:String(value.captions?.position??'bottom-center'),
      maxWordsPerCaption:value.captions?.maxWordsPerCaption??null,
      highlightKeywords:value.captions?.highlightKeywords??false
    },
    editing:{
      transitions:list(editing.transitions),
      defaultTransition:String(editing.defaultTransition??'cut'),
      kenBurns:Boolean(editing.kenBurns??false),
      musicStyle:list(editing.musicStyle),
      sfxRules:list(editing.sfxRules),
      pacingRules:list(editing.pacingRules)
    },
    thumbnail:{
      styleRules:list(value.thumbnail?.styleRules),
      forbidden:list(value.thumbnail?.forbidden)
    },
    providers:{
      image:list(value.providers?.image),
      video:list(value.providers?.video),
      voice:list(value.providers?.voice),
      stock:list(value.providers?.stock)
    },
    createdAt:String(value.createdAt??now),
    updatedAt:String(value.updatedAt??now)
  };
}

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
    payload:normalizeProductionDnaPayload(row.payload,channelId),
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
    ...normalizeProductionDnaPayload(payload,payload.channelId),
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

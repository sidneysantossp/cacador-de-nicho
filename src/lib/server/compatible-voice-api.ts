import 'server-only';

import { HttpError } from './auth';

export type CompatibleVoiceApiAuthMode='xi-api-key'|'bearer';

export type CompatibleVoiceApiConfig={
  baseUrl:string;
  apiKey:string;
  authMode:CompatibleVoiceApiAuthMode;
};

function normalizeBaseUrl(value:string){
  const raw=value.trim().replace(/\/+$/,'');
  let url:URL;
  try{url=new URL(raw);}catch{throw new HttpError('A Base URL da Voice API é inválida.',400);}
  if(url.protocol!=='https:')throw new HttpError('A Voice API precisa usar HTTPS.',400);
  if(url.username||url.password)throw new HttpError('A Base URL da Voice API não pode conter credenciais.',400);
  if(url.search||url.hash)throw new HttpError('A Base URL da Voice API não pode conter query string ou fragmento.',400);
  return url.toString().replace(/\/$/,'');
}

export function parseCompatibleVoiceApiConfig(value:string):CompatibleVoiceApiConfig{
  let parsed:unknown;
  try{parsed=JSON.parse(value);}catch{throw new HttpError('Configuração da Voice API externa inválida.',503);}
  if(!parsed||typeof parsed!=='object')throw new HttpError('Configuração da Voice API externa inválida.',503);
  const row=parsed as Record<string,unknown>;
  const apiKey=String(row.apiKey??'').trim();
  if(apiKey.length<8)throw new HttpError('A API key da Voice API externa é inválida.',400);
  const authMode=row.authMode==='bearer'?'bearer':'xi-api-key';
  return {baseUrl:normalizeBaseUrl(String(row.baseUrl??'')),apiKey,authMode};
}

export function serializeCompatibleVoiceApiConfig(config:CompatibleVoiceApiConfig){
  return JSON.stringify({
    baseUrl:normalizeBaseUrl(config.baseUrl),
    apiKey:config.apiKey.trim(),
    authMode:config.authMode
  });
}

export function compatibleVoiceApiFromEnv(){
  const baseUrl=process.env.VOICE_API_BASE_URL?.trim();
  const apiKey=process.env.VOICE_API_KEY?.trim();
  if(!baseUrl||!apiKey)return null;
  const raw=(process.env.VOICE_API_AUTH_MODE??'xi-api-key').trim().toLowerCase();
  const authMode:CompatibleVoiceApiAuthMode=raw==='bearer'?'bearer':'xi-api-key';
  try{return parseCompatibleVoiceApiConfig(JSON.stringify({baseUrl,apiKey,authMode}));}
  catch{return null;}
}

export function compatibleVoiceApiHeaders(config:CompatibleVoiceApiConfig,json=false){
  const headers:Record<string,string>={};
  if(config.authMode==='bearer')headers.Authorization='Bearer '+config.apiKey;
  else headers['xi-api-key']=config.apiKey;
  if(json)headers['Content-Type']='application/json';
  return headers;
}

export function compatibleVoiceApiUrl(config:CompatibleVoiceApiConfig,path:string){
  const suffix=path.startsWith('/')?path:'/'+path;
  return config.baseUrl+suffix;
}

export type CompatibleVoiceApiVoice={
  voiceId:string;
  name:string;
  category:string;
  description:string;
  previewUrl:string;
  labels:Record<string,string>;
};

function normalizeVoices(body:unknown):CompatibleVoiceApiVoice[]{
  if(!body||typeof body!=='object')return [];
  const rows=Array.isArray((body as {voices?:unknown}).voices)
    ?(body as {voices:unknown[]}).voices
    :Array.isArray((body as {data?:unknown}).data)
      ?(body as {data:unknown[]}).data
      :[];
  return rows.flatMap(item=>{
    if(!item||typeof item!=='object')return [];
    const row=item as Record<string,unknown>;
    const voiceId=String(row.voice_id??row.voiceId??row.id??'').trim();
    if(!voiceId)return [];
    return [{
      voiceId,
      name:String(row.name??row.display_name??voiceId),
      category:String(row.category??''),
      description:String(row.description??''),
      previewUrl:String(row.preview_url??row.previewUrl??''),
      labels:row.labels&&typeof row.labels==='object'?row.labels as Record<string,string>:{}
    }];
  });
}

export async function listCompatibleVoiceApiVoices(
  config:CompatibleVoiceApiConfig,
  search=''
):Promise<CompatibleVoiceApiVoice[]>{
  const candidates=['/v2/voices?page_size=100&include_total_count=false','/v1/voices'];
  let lastStatus=0;
  for(const candidate of candidates){
    const joiner=candidate.includes('?')?'&':'?';
    const target=candidate+(search.trim()?joiner+'search='+encodeURIComponent(search.trim()):'');
    let response:Response;
    try{
      response=await fetch(compatibleVoiceApiUrl(config,target),{
        headers:compatibleVoiceApiHeaders(config),
        signal:AbortSignal.timeout(20000),
        cache:'no-store'
      });
    }catch{
      throw new HttpError('Não foi possível alcançar a Voice API externa.',502);
    }
    lastStatus=response.status;
    if(response.ok){
      const voices=normalizeVoices(await response.json().catch(()=>({})));
      if(voices.length)return voices.slice(0,100);
      if(candidate.startsWith('/v2/'))continue;
      throw new HttpError('A Voice API externa respondeu, mas não retornou nenhuma voz disponível.',422);
    }
    if(response.status===401||response.status===403){
      throw new HttpError('A Voice API externa recusou a credencial configurada.',422);
    }
    if(response.status===429)throw new HttpError('A Voice API externa atingiu limite de uso ou concorrência.',429);
    if(response.status!==404&&response.status!==405)break;
  }
  throw new HttpError('A Voice API externa não expõe uma rota de vozes compatível (HTTP '+lastStatus+').',422);
}

export async function testCompatibleVoiceApiConfig(config:CompatibleVoiceApiConfig){
  const voices=await listCompatibleVoiceApiVoices(config);
  if(!voices.length)throw new HttpError('A Voice API externa não retornou vozes disponíveis.',422);
}

export function compatibleVoiceApiPublicConfig(config:CompatibleVoiceApiConfig){
  return {baseUrl:config.baseUrl,authMode:config.authMode};
}

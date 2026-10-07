import 'server-only';

import { HttpError } from './auth';

const PREFERRED_MODELS=[
  'models/gemini-3.5-flash-lite',
  'models/gemini-3.6-flash',
  'models/gemini-3.8-flash',
  'models/gemini-3.5-flash',
  'models/gemini-2.5-flash-lite',
  'models/gemini-2.5-flash'
] as const;
const CACHE_MS=5*60*1000;

let cached:null|{
  configured:string;
  model:string;
  expiresAt:number;
}=null;

function normalizedConfigured(){
  const raw=(process.env.VISUAL_INTELLIGENCE_MODEL??'').trim();
  if(!raw)return '';
  return raw.startsWith('models/')?raw:'models/'+raw;
}

async function availableModels(key:string){
  const response=await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?key='+encodeURIComponent(key),
    {signal:AbortSignal.timeout(15000),cache:'no-store'}
  );
  if(!response.ok)throw new Error('google-model-list-'+response.status);
  const body=await response.json() as {
    models?:Array<{name?:string;supportedGenerationMethods?:string[]}>
  };
  return (body.models??[])
    .filter(item=>(item.supportedGenerationMethods??[]).includes('generateContent'))
    .map(item=>String(item.name??''))
    .filter(Boolean);
}

export async function resolveGoogleVisionModel(
  key:string,
  options:{forceRefresh?:boolean;excludeModel?:string}={}
){
  const configured=normalizedConfigured();
  const now=Date.now();
  if(
    !options.forceRefresh&&
    cached&&
    cached.configured===configured&&
    cached.expiresAt>now
  )return cached.model;

  let model='';
  try{
    const names=await availableModels(key);
    const excluded=options.excludeModel??'';
    if(configured&&configured!==excluded&&names.includes(configured)){
      model=configured;
    }else{
      model=PREFERRED_MODELS.find(item=>item!==excluded&&names.includes(item))??'';
      if(!model)model=names.find(name=>name!==excluded&&/gemini.*flash/i.test(name))??'';
    }
  }catch{}

  if(!model){
    const excluded=options.excludeModel??'';
    model=/^models\/gemini-3\./i.test(configured)&&configured!==excluded
      ?configured
      :PREFERRED_MODELS.find(item=>item!==excluded)??PREFERRED_MODELS[0];
  }

  cached={configured,model,expiresAt:now+CACHE_MS};
  return model;
}

export function googleVisionModelUnavailable(error:unknown){
  if(!(error instanceof HttpError||error instanceof Error))return false;
  const message=error.message.toLowerCase();
  return message.includes('(http 404)')||
    message.includes('"status": "not_found"')||
    message.includes('model')&&(
      message.includes('no longer available')||
      message.includes('not found')||
      message.includes('not available')
    );
}

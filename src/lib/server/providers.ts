import 'server-only';
import OpenAI from 'openai';
import { db, dbConfigured, checked } from './db';
import { HttpError } from './auth';
import {
  parseR2Config, r2ConfigFromEnv, serializeR2Config, testR2Config, type R2Config
} from './r2';
import {
  parseVecteezyConfig, serializeVecteezyConfig, testVecteezyConfig,
  vecteezyConfigFromEnv, type VecteezyConfig
} from './vecteezy';

export type Provider=
  'openai'|'youtube'|'elevenlabs'|'googleai'|'pexels'|'pixabay'|'unsplash'|'vecteezy'|'r2';

const names:Record<Provider,string>={
  openai:'openai_api_key',
  youtube:'youtube_api_key',
  elevenlabs:'elevenlabs_api_key',
  googleai:'google_ai_api_key',
  pexels:'pexels_api_key',
  pixabay:'pixabay_api_key',
  unsplash:'unsplash_access_key',
  vecteezy:'vecteezy_config',
  r2:'cloudflare_r2_config'
};

function envValue(provider:Provider){
  if(provider==='openai')return process.env.OPENAI_API_KEY;
  if(provider==='youtube')return process.env.YOUTUBE_API_KEY;
  if(provider==='elevenlabs')return process.env.ELEVENLABS_API_KEY;
  if(provider==='googleai')return process.env.GOOGLE_AI_API_KEY;
  if(provider==='pexels')return process.env.PEXELS_API_KEY;
  if(provider==='pixabay')return process.env.PIXABAY_API_KEY;
  if(provider==='unsplash')return process.env.UNSPLASH_ACCESS_KEY;
  if(provider==='vecteezy'){
    const config=vecteezyConfigFromEnv();
    return config?serializeVecteezyConfig(config):undefined;
  }
  const config=r2ConfigFromEnv();
  return config?serializeR2Config(config):undefined;
}

function label(provider:Provider){
  if(provider==='openai')return 'OpenAI';
  if(provider==='youtube')return 'YouTube Data API';
  if(provider==='elevenlabs')return 'ElevenLabs';
  if(provider==='googleai')return 'Google AI';
  if(provider==='pexels')return 'Pexels';
  if(provider==='pixabay')return 'Pixabay';
  if(provider==='unsplash')return 'Unsplash';
  if(provider==='vecteezy')return 'Vecteezy';
  return 'Cloudflare R2';
}

function last4(provider:Provider,value:string){
  if(provider==='r2'){
    try{return parseR2Config(value).accessKeyId.slice(-4);}catch{return '';}
  }
  if(provider==='vecteezy'){
    try{return parseVecteezyConfig(value).secretKey.slice(-4);}catch{return '';}
  }
  return value.slice(-4);
}

export async function providerSecret(provider:Provider){
  if(dbConfigured()){
    const result=await db().rpc('radar_get_secret',{p_secret_name:names[provider]});
    if(!result.error&&typeof result.data==='string'&&result.data)return result.data;
  }
  const fallback=envValue(provider);
  if(fallback)return fallback;
  throw new HttpError(`Configure a credencial da ${label(provider)}.`,503);
}

export async function providerAvailable(provider:Provider){
  try{await providerSecret(provider);return true;}catch{return false;}
}

export async function saveProviderSecret(provider:Provider,value:string){
  if(!dbConfigured())throw new HttpError('Configure o Supabase antes de cadastrar credenciais.',503);
  checked(await db().rpc('radar_set_secret',{p_secret_name:names[provider],p_secret_value:value}));
}

export async function saveR2ProviderConfig(config:R2Config){
  await testR2Config(config);
  await saveProviderSecret('r2',serializeR2Config(config));
}

export async function saveVecteezyProviderConfig(config:VecteezyConfig){
  await testVecteezyConfig(config);
  await saveProviderSecret('vecteezy',serializeVecteezyConfig(config));
}

export async function removeProviderSecret(provider:Provider){
  if(!dbConfigured())throw new HttpError('Configure o Supabase antes de alterar credenciais.',503);
  checked(await db().rpc('radar_delete_secret',{p_secret_name:names[provider]}));
}

export async function providerStatuses(){
  const rows:Record<string,unknown>[]=[];
  let r2VaultLast4:string|null=null;
  let vecteezyVaultLast4:string|null=null;
  if(dbConfigured()){
    const result=await db().rpc('radar_secret_status');
    if(result.error)throw new HttpError('O cofre de credenciais ainda não foi instalado. Aplique o schema atualizado.',503);
    if(Array.isArray(result.data))rows.push(...result.data);
    if(rows.some(item=>item.secret_name===names.r2)){
      const secret=await db().rpc('radar_get_secret',{p_secret_name:names.r2});
      if(!secret.error&&typeof secret.data==='string'){
        try{r2VaultLast4=parseR2Config(secret.data).accessKeyId.slice(-4);}catch{}
      }
    }
    if(rows.some(item=>item.secret_name===names.vecteezy)){
      const secret=await db().rpc('radar_get_secret',{p_secret_name:names.vecteezy});
      if(!secret.error&&typeof secret.data==='string'){
        try{vecteezyVaultLast4=parseVecteezyConfig(secret.data).secretKey.slice(-4);}catch{}
      }
    }
  }
  return (['openai','youtube','elevenlabs','googleai','pexels','pixabay','unsplash','vecteezy','r2'] as Provider[]).map(provider=>{
    const name=names[provider];
    const row=rows.find(item=>item.secret_name===name);
    const fallback=envValue(provider);
    if(row){
      return {
        provider,configured:true,source:'vault' as const,
        last4:provider==='r2'
          ?(r2VaultLast4??'')
          :provider==='vecteezy'
            ?(vecteezyVaultLast4??'')
            :String(row.last4??'')
      };
    }
    if(fallback)return {provider,configured:true,source:'environment' as const,last4:last4(provider,fallback)};
    return {provider,configured:false,source:null,last4:null};
  });
}

export async function testProvider(provider:Provider,key:string,model='gpt-5.6-terra'){
  if(provider==='openai'){
    try{await new OpenAI({apiKey:key,timeout:15000,maxRetries:0}).models.retrieve(model);}
    catch{throw new HttpError('A OpenAI recusou a chave ou o modelo escolhido não está disponível nesta conta.',422);}
    return;
  }
  if(provider==='elevenlabs'){
    let response:Response;
    try{response=await fetch('https://api.elevenlabs.io/v1/user',{headers:{'xi-api-key':key},signal:AbortSignal.timeout(15000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);}
    if(!response.ok)throw new HttpError('A ElevenLabs recusou a chave. Confira a credencial e as permissões da conta.',422);
    return;
  }
  if(provider==='googleai'){
    let response:Response;
    try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível alcançar a Google AI API.',502);}
    if(!response.ok)throw new HttpError('A Google AI recusou a chave. Confira a credencial e o acesso à Gemini API.',422);
    return;
  }
  if(provider==='pexels'){
    let response:Response;
    try{response=await fetch('https://api.pexels.com/v1/curated?per_page=1',{headers:{Authorization:key},signal:AbortSignal.timeout(15000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível alcançar a API do Pexels.',502);}
    if(!response.ok)throw new HttpError('O Pexels recusou a chave da API.',422);
    return;
  }
  if(provider==='pixabay'){
    let response:Response;
    try{response=await fetch('https://pixabay.com/api/?key='+encodeURIComponent(key)+'&per_page=3',{signal:AbortSignal.timeout(15000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível alcançar a API do Pixabay.',502);}
    if(!response.ok)throw new HttpError('O Pixabay recusou a chave da API.',422);
    return;
  }
  if(provider==='unsplash'){
    let response:Response;
    try{
      response=await fetch('https://api.unsplash.com/photos/random?count=1',{
        headers:{Authorization:'Client-ID '+key,'Accept-Version':'v1'},
        signal:AbortSignal.timeout(15000),
        cache:'no-store'
      });
    }catch{throw new HttpError('Não foi possível alcançar a API do Unsplash.',502);}
    if(!response.ok)throw new HttpError('O Unsplash recusou a Access Key.',422);
    return;
  }
  if(provider==='vecteezy'){
    await testVecteezyConfig(parseVecteezyConfig(key));
    return;
  }
  if(provider==='r2'){
    await testR2Config(parseR2Config(key));
    return;
  }

  const query=new URLSearchParams({part:'id',id:'jNQXAC9IVRw',key});
  let response:Response;
  try{response=await fetch(`https://www.googleapis.com/youtube/v3/videos?${query}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});}
  catch{throw new HttpError('Não foi possível alcançar a YouTube Data API.',502);}
  if(!response.ok)throw new HttpError('O YouTube recusou a chave. Confira a API habilitada, as restrições e a cota.',422);
}

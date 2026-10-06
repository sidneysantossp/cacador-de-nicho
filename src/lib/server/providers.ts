import 'server-only';
import OpenAI from 'openai';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db, dbConfigured, checked, databaseMode } from './db';
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

function secretKey(){
  const raw=(process.env.PROVIDER_SECRETS_KEY||'').trim();
  if(!raw)throw new HttpError('Configure PROVIDER_SECRETS_KEY para proteger as credenciais locais.',503);
  const candidates=[Buffer.from(raw,'base64'),/^[0-9a-f]{64}$/i.test(raw)?Buffer.from(raw,'hex'):Buffer.alloc(0)];
  const key=candidates.find(item=>item.length===32);
  if(!key)throw new HttpError('PROVIDER_SECRETS_KEY precisa representar exatamente 32 bytes.',503);
  return key;
}

function encryptSecret(value:string){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',secretKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value:string){
  const [version,ivRaw,tagRaw,cipherRaw]=value.split('.');
  if(version!=='v1'||!ivRaw||!tagRaw||!cipherRaw)throw new Error('invalid-provider-secret');
  const decipher=createDecipheriv('aes-256-gcm',secretKey(),Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherRaw,'base64url')),decipher.final()]).toString('utf8');
}

async function localProviderSecret(provider:Provider){
  const row=checked(await db().from('radar_provider_secrets').select('ciphertext').eq('provider',provider).maybeSingle()) as {ciphertext?:string}|null;
  if(!row?.ciphertext)return null;
  return decryptSecret(String(row.ciphertext));
}

export async function providerSecret(provider:Provider){
  if(databaseMode()==='self-hosted'){
    try{
      const local=await localProviderSecret(provider);
      if(local)return local;
    }catch{}
    const fallback=envValue(provider);
    if(fallback)return fallback;
    // During migration, keep a read-only fallback to the old Vault while it is still reachable.
    if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
      try{
        const result=await db().rpc('radar_get_secret',{p_secret_name:names[provider]});
        if(!result.error&&typeof result.data==='string'&&result.data)return result.data;
      }catch{}
    }
  }else if(dbConfigured()){
    const result=await db().rpc('radar_get_secret',{p_secret_name:names[provider]});
    if(!result.error&&typeof result.data==='string'&&result.data)return result.data;
    const fallback=envValue(provider);
    if(fallback)return fallback;
  }
  const fallback=envValue(provider);
  if(fallback)return fallback;
  throw new HttpError(`Configure a credencial da ${label(provider)}.`,503);
}

export async function providerAvailable(provider:Provider){
  try{await providerSecret(provider);return true;}catch{return false;}
}

export async function saveProviderSecret(provider:Provider,value:string){
  if(databaseMode()==='self-hosted'){
    checked(await db().from('radar_provider_secrets').upsert({provider,ciphertext:encryptSecret(value),updated_at:new Date().toISOString()}));
    return;
  }
  if(!dbConfigured())throw new HttpError('Configure o banco de dados antes de cadastrar credenciais.',503);
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
  if(databaseMode()==='self-hosted'){
    checked(await db().from('radar_provider_secrets').delete().eq('provider',provider));
    return;
  }
  if(!dbConfigured())throw new HttpError('Configure o banco de dados antes de alterar credenciais.',503);
  checked(await db().rpc('radar_delete_secret',{p_secret_name:names[provider]}));
}

export async function providerStatuses(){
  const rows:Record<string,unknown>[]=[];
  if(databaseMode()==='self-hosted'){
    const result=await db().from('radar_provider_secrets').select('provider,ciphertext,updated_at');
    if(!result.error&&Array.isArray(result.data)){
      for(const item of result.data as Array<{provider:string;ciphertext:string}>){
        try{
          const secret=decryptSecret(item.ciphertext);
          rows.push({secret_name:names[item.provider as Provider],last4:last4(item.provider as Provider,secret)});
        }catch{}
      }
    }
  }else if(dbConfigured()){
    const result=await db().rpc('radar_secret_status');
    if(result.error)throw new HttpError('O cofre de credenciais ainda não foi instalado. Aplique o schema atualizado.',503);
    if(Array.isArray(result.data))rows.push(...result.data);
  }
  return (['openai','youtube','elevenlabs','googleai','pexels','pixabay','unsplash','vecteezy','r2'] as Provider[]).map(provider=>{
    const name=names[provider];
    const row=rows.find(item=>item.secret_name===name);
    const fallback=envValue(provider);
    if(row)return {provider,configured:true,source:databaseMode()==='self-hosted'?'local-encrypted-db' as const:'vault' as const,last4:String(row.last4??'')};
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
    try{
      response=await fetch('https://api.elevenlabs.io/v2/voices?page_size=10&include_total_count=false',{
        headers:{'xi-api-key':key},
        signal:AbortSignal.timeout(15000),
        cache:'no-store'
      });
    }catch{throw new HttpError('Não foi possível alcançar a API da ElevenLabs.',502);}
    if(!response.ok){
      const raw=await response.text().catch(()=>'');
      let status='';
      let message='';
      try{
        const parsed=JSON.parse(raw) as {detail?:{status?:unknown;message?:unknown}};
        status=typeof parsed.detail?.status==='string'?parsed.detail.status:'';
        message=typeof parsed.detail?.message==='string'?parsed.detail.message:'';
      }catch{}
      if(status==='missing_permissions'||response.status===403){
        throw new HttpError('A nova chave não possui Voices: Read. Edite a API key na ElevenLabs e habilite leitura de vozes.',422);
      }
      if(status==='invalid_api_key'||response.status===401){
        throw new HttpError('A ElevenLabs recusou a nova chave. Confira se ela foi copiada por completo e continua ativa.',422);
      }
      if(response.status===429){
        throw new HttpError('A ElevenLabs limitou temporariamente a validação da nova chave. Aguarde alguns segundos e tente novamente.',429);
      }
      const safeStatus=status.replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80);
      const safeMessage=message.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,220);
      throw new HttpError('A ElevenLabs não conseguiu listar as vozes'+(safeStatus?' ['+safeStatus+']':'')+(safeMessage?': '+safeMessage:'')+' (HTTP '+response.status+').',422);
    }
    const voices=await response.json().catch(()=>({})) as {voices?:Array<{voice_id?:unknown}>};
    const voiceId=voices.voices?.map(item=>String(item.voice_id??'').trim()).find(Boolean);
    if(!voiceId)throw new HttpError('A chave foi aceita, mas a conta ElevenLabs não retornou nenhuma voz disponível.',422);
    let tts:Response;
    try{
      tts=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(voiceId)+'/with-timestamps?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({text:'teste',model_id:'eleven_flash_v2_5'}),signal:AbortSignal.timeout(30000),cache:'no-store'});
    }catch{throw new HttpError('A chave foi aceita, mas o endpoint Text to Speech da ElevenLabs não respondeu.',502);}
    if(!tts.ok){
      const raw=await tts.text().catch(()=>'');
      let status='';
      let message='';
      try{const parsed=JSON.parse(raw) as {detail?:{status?:unknown;message?:unknown}};status=typeof parsed.detail?.status==='string'?parsed.detail.status:'';message=typeof parsed.detail?.message==='string'?parsed.detail.message:'';}catch{}
      if(status==='missing_permissions')throw new HttpError('A nova chave não possui Text to Speech: Access. Habilite essa permissão na ElevenLabs antes de salvar.',422);
      if(status==='payment_issue')throw new HttpError('A nova conta ElevenLabs possui uma pendência de pagamento e não pode gerar voz ainda.',422);
      if(status==='invalid_api_key'||tts.status===401)throw new HttpError('A ElevenLabs recusou a nova chave para Text to Speech. Verifique a chave, as permissões e a conta.',422);
      if(tts.status===403)throw new HttpError('Text to Speech foi bloqueado pela ElevenLabs. Verifique a permissão e qualquer restrição de IP.',422);
      if(tts.status===429)throw new HttpError('A nova conta ElevenLabs atingiu limite de uso, concorrência ou créditos.',429);
      const safe=message.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
      throw new HttpError('A ElevenLabs não conseguiu validar Text to Speech'+(safe?': '+safe:'')+'.',422);
    }
    return;
  }
  if(provider==='googleai'){
    let response:Response;
    try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a Google AI API.',502);}
    if(!response.ok)throw new HttpError('A Google AI recusou a chave. Confira a credencial e o acesso à Gemini API.',422);
    return;
  }
  if(provider==='pexels'){
    let response:Response;
    try{response=await fetch('https://api.pexels.com/v1/curated?per_page=1',{headers:{Authorization:key},signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a API do Pexels.',502);}
    if(!response.ok)throw new HttpError('O Pexels recusou a chave da API.',422);
    return;
  }
  if(provider==='pixabay'){
    let response:Response;
    try{response=await fetch('https://pixabay.com/api/?key='+encodeURIComponent(key)+'&per_page=3',{signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a API do Pixabay.',502);}
    if(!response.ok)throw new HttpError('O Pixabay recusou a chave da API.',422);
    return;
  }
  if(provider==='unsplash'){
    let response:Response;
    try{response=await fetch('https://api.unsplash.com/photos/random?count=1',{headers:{Authorization:'Client-ID '+key,'Accept-Version':'v1'},signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a API do Unsplash.',502);}
    if(!response.ok)throw new HttpError('O Unsplash recusou a Access Key.',422);
    return;
  }
  if(provider==='vecteezy'){await testVecteezyConfig(parseVecteezyConfig(key));return;}
  if(provider==='r2'){await testR2Config(parseR2Config(key));return;}
  const query=new URLSearchParams({part:'id',id:'jNQXAC9IVRw',key});
  let response:Response;
  try{response=await fetch(`https://www.googleapis.com/youtube/v3/videos?${query}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a YouTube Data API.',502);}
  if(!response.ok)throw new HttpError('O YouTube recusou a chave. Confira a API habilitada, as restrições e a cota.',422);
}

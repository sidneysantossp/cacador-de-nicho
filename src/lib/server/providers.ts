import 'server-only';
import OpenAI from 'openai';
import { db, dbConfigured, checked } from './db';
import { HttpError } from './auth';

export type Provider='openai'|'youtube'|'elevenlabs'|'googleai';
const names:Record<Provider,string>={openai:'openai_api_key',youtube:'youtube_api_key',elevenlabs:'elevenlabs_api_key',googleai:'google_ai_api_key'};
const envKeys:Record<Provider,()=>string|undefined>={openai:()=>process.env.OPENAI_API_KEY,youtube:()=>process.env.YOUTUBE_API_KEY,elevenlabs:()=>process.env.ELEVENLABS_API_KEY,googleai:()=>process.env.GOOGLE_AI_API_KEY};

export async function providerSecret(provider:Provider){
 if(dbConfigured()){
  const result=await db().rpc('radar_get_secret',{p_secret_name:names[provider]});
  if(!result.error&&typeof result.data==='string'&&result.data)return result.data;
 }
 const fallback=envKeys[provider]();
 if(fallback)return fallback;
 const label=provider==='openai'?'OpenAI':provider==='youtube'?'YouTube Data API':provider==='elevenlabs'?'ElevenLabs':'Google AI';
 throw new HttpError(`Configure a chave da ${label}.`,503);
}

export async function providerAvailable(provider:Provider){try{await providerSecret(provider);return true;}catch{return false;}}

export async function saveProviderSecret(provider:Provider,value:string){
 if(!dbConfigured())throw new HttpError('Configure o Supabase antes de cadastrar credenciais.',503);
 checked(await db().rpc('radar_set_secret',{p_secret_name:names[provider],p_secret_value:value}));
}

export async function removeProviderSecret(provider:Provider){
 if(!dbConfigured())throw new HttpError('Configure o Supabase antes de alterar credenciais.',503);
 checked(await db().rpc('radar_delete_secret',{p_secret_name:names[provider]}));
}

export async function providerStatuses(){
 const rows:Record<string,unknown>[]=[];
 if(dbConfigured()){
  const result=await db().rpc('radar_secret_status');
  if(result.error)throw new HttpError('O cofre de credenciais ainda não foi instalado. Aplique o schema atualizado.',503);
  if(Array.isArray(result.data))rows.push(...result.data);
 }
 return (['openai','youtube','elevenlabs','googleai'] as Provider[]).map(provider=>{
  const name=names[provider],row=rows.find(item=>item.secret_name===name),fallback=envKeys[provider]();
  if(row)return {provider,configured:true,source:'vault' as const,last4:String(row.last4??'')};
  if(fallback)return {provider,configured:true,source:'environment' as const,last4:fallback.slice(-4)};
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
 const query=new URLSearchParams({part:'id',id:'jNQXAC9IVRw',key});
 let response:Response;
 try{response=await fetch(`https://www.googleapis.com/youtube/v3/videos?${query}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new HttpError('Não foi possível alcançar a YouTube Data API.',502);}
 if(!response.ok)throw new HttpError('O YouTube recusou a chave. Confira a API habilitada, as restrições e a cota.',422);
}

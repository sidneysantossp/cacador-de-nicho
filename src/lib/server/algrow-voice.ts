import 'server-only';

import { HttpError } from './auth';

const ALGROW_BASE='https://api.algrow.online';
const MAX_REMOTE_AUDIO_BYTES=100*1024*1024;

export type AlgrowTtsProvider='elevenlabs'|'stealth'|'minimax';

export type AlgrowVoiceOption={
  voiceId:string;
  name:string;
  category:string;
  description:string;
  previewUrl:string;
  labels:Record<string,string>;
};

function headers(apiKey:string){
  return {Authorization:'Bearer '+apiKey};
}

function endpointForVoices(provider:AlgrowTtsProvider){
  if(provider==='stealth')return '/api/voices/stealth';
  if(provider==='minimax')return '/api/voices/minimax';
  return '/api/voices';
}

function normalizeVoices(body:unknown):AlgrowVoiceOption[]{
  if(!body||typeof body!=='object')return [];
  const source=body as Record<string,unknown>;
  const rows=Array.isArray(source.voices)
    ?source.voices
    :Array.isArray(source.data)
      ?source.data
      :Array.isArray(source.items)
        ?source.items
        :[];
  return rows.flatMap(item=>{
    if(!item||typeof item!=='object')return [];
    const row=item as Record<string,unknown>;
    const voiceId=String(row.voice_id??row.voiceId??row.id??row.name??'').trim();
    if(!voiceId)return [];
    const labels:Record<string,string>={};
    for(const key of ['gender','age','accent','language','use_case']){
      const value=row[key];
      if(typeof value==='string'&&value.trim())labels[key]=value.trim();
    }
    if(row.labels&&typeof row.labels==='object'){
      for(const [key,value] of Object.entries(row.labels as Record<string,unknown>)){
        if(typeof value==='string')labels[key]=value;
      }
    }
    return [{
      voiceId,
      name:String(row.name??row.display_name??voiceId),
      category:String(row.category??row.provider??''),
      description:String(row.description??''),
      previewUrl:String(row.preview_url??row.previewUrl??''),
      labels
    }];
  });
}

async function algrowJson(
  apiKey:string,
  path:string,
  init:RequestInit={},
  timeoutMs=20000
){
  let response:Response;
  try{
    response=await fetch(ALGROW_BASE+path,{
      ...init,
      headers:{...headers(apiKey),...(init.headers??{})},
      signal:AbortSignal.timeout(timeoutMs),
      cache:'no-store'
    });
  }catch{
    throw new HttpError('Não foi possível alcançar a API da Algrow.',502);
  }
  const raw=await response.text().catch(()=>'');
  let body:Record<string,unknown>={};
  try{body=raw?JSON.parse(raw) as Record<string,unknown>:{};}catch{}
  if(response.ok)return body;

  const error=String(body.error??body.error_message??body.message??'').replace(/[
	]+/g,' ').trim().slice(0,240);
  if(response.status===401)throw new HttpError('A Algrow recusou a API key. Confira a chave em Settings → API Keys.',422);
  if(response.status===402)throw new HttpError('A Algrow informou saldo/créditos insuficientes para esta geração.',402);
  if(response.status===403)throw new HttpError('Seu plano Algrow não permite este recurso de voz.',422);
  if(response.status===429)throw new HttpError('A Algrow atingiu o limite de concorrência. Aguarde alguns segundos.',429);
  throw new HttpError('A Algrow respondeu com erro'+(error?': '+error:'')+' (HTTP '+response.status+').',502);
}

export async function testAlgrowApiKey(apiKey:string){
  const body=await algrowJson(apiKey,'/api/voices?page_size=1');
  if(!normalizeVoices(body).length)throw new HttpError('A chave foi aceita, mas a Algrow não retornou vozes.',422);
}

export async function listAlgrowVoices(
  apiKey:string,
  provider:AlgrowTtsProvider='elevenlabs',
  search=''
){
  const query=new URLSearchParams();
  if(search.trim())query.set('search',search.trim());
  if(provider==='elevenlabs'){
    query.set('sort','trending');
    query.set('page_size','100');
    query.set('page','0');
  }
  const suffix=query.size?'?'+query.toString():'';
  const body=await algrowJson(apiKey,endpointForVoices(provider)+suffix);
  return normalizeVoices(body).slice(0,100);
}

export type AlgrowGenerationResult={
  jobId:string;
  audioUrl:string;
  transcriptUrl?:string;
  bytes:Buffer;
  mimeType:string;
};

function safeHostedUrl(value:unknown,kind:'audio'|'transcript'){
  const raw=String(value??'').trim();
  if(!raw)throw new HttpError('A Algrow concluiu o job sem URL de '+(kind==='audio'?'áudio':'transcrição')+'.',502);
  let url:URL;
  try{url=new URL(raw);}catch{throw new HttpError('A Algrow devolveu uma URL inválida.',502);}
  if(url.protocol!=='https:'||url.hostname!=='audio.algrow.online'){
    throw new HttpError('A Algrow devolveu uma URL de mídia fora do domínio esperado.',502);
  }
  return url.toString();
}

async function downloadAlgrowAudio(url:string){
  let response:Response;
  try{
    response=await fetch(url,{signal:AbortSignal.timeout(120000),cache:'no-store'});
  }catch{throw new HttpError('O áudio gerado pela Algrow não pôde ser baixado.',502);}
  if(!response.ok)throw new HttpError('A URL de áudio da Algrow retornou HTTP '+response.status+'.',502);
  const length=Number(response.headers.get('content-length')??0);
  if(length>MAX_REMOTE_AUDIO_BYTES)throw new HttpError('O áudio da Algrow excede 100 MB.',413);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length)throw new HttpError('A Algrow devolveu um áudio vazio.',502);
  if(bytes.length>MAX_REMOTE_AUDIO_BYTES)throw new HttpError('O áudio da Algrow excede 100 MB.',413);
  const contentType=(response.headers.get('content-type')??'audio/mpeg').split(';')[0].trim();
  return {bytes,mimeType:contentType.startsWith('audio/')?contentType:'audio/mpeg'};
}

export async function generateAlgrowTts(input:{
  apiKey:string;
  script:string;
  voiceId:string;
  provider?:AlgrowTtsProvider;
  modelId?:string;
}):Promise<AlgrowGenerationResult>{
  const provider=input.provider??'elevenlabs';
  const form=new FormData();
  form.set('script',input.script);
  form.set('voice_id',input.voiceId);
  form.set('provider',provider);
  form.set('generate_srt','true');
  if(provider==='elevenlabs'&&input.modelId)form.set('model_id',input.modelId);

  const submitted=await algrowJson(input.apiKey,'/api/generate-simple',{
    method:'POST',
    body:form
  },60000);
  const jobId=String(submitted.job_id??'').trim();
  if(!jobId)throw new HttpError('A Algrow aceitou a solicitação, mas não devolveu job_id.',502);

  for(let attempt=0;attempt<120;attempt++){
    if(attempt>0)await new Promise(resolve=>setTimeout(resolve,3000));
    const status=await algrowJson(input.apiKey,'/api/job-status/'+encodeURIComponent(jobId),{},30000);
    const state=String(status.status??'').toLowerCase();
    if(state==='completed'){
      const audioUrl=safeHostedUrl(status.audio_url,'audio');
      const transcriptRaw=String(status.transcript_url??'').trim();
      const transcriptUrl=transcriptRaw?safeHostedUrl(transcriptRaw,'transcript'):undefined;
      const downloaded=await downloadAlgrowAudio(audioUrl);
      return {
        jobId,
        audioUrl,
        transcriptUrl,
        bytes:downloaded.bytes,
        mimeType:downloaded.mimeType
      };
    }
    if(state==='failed'){
      const detail=String(status.error_message??status.error??status.status_detail_message??'Falha na geração').replace(/[
	]+/g,' ').trim().slice(0,260);
      const code=String(status.error_code??'').replace(/[^A-Z0-9_.-]/gi,'').slice(0,80);
      throw new HttpError('A Algrow falhou na geração'+(code?' ['+code+']':'')+': '+detail,422);
    }
  }
  throw new HttpError('A geração Algrow excedeu 6 minutos sem concluir.',504);
}

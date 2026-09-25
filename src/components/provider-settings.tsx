'use client';
import { useEffect, useState } from 'react';
import {
  BrainCircuit, Check, Cloud, ExternalLink, Film, HardDrive,
  Image as ImageIcon, Images, KeyRound, Mic2, Play, ShieldCheck, Trash2
} from 'lucide-react';
import { modelOptions as fallbackModels } from '@/lib/models';
import { defaultSettings } from '@/lib/types';

type Provider='openai'|'youtube'|'elevenlabs'|'googleai'|'pexels'|'pixabay'|'unsplash'|'r2';
type Status={provider:Provider;configured:boolean;source:'vault'|'environment'|null;last4:string|null};
type Model={id:string;name:string;description:string};
type Payload={providers:Status[];models:readonly Model[];selection:{analysisModel:string;scriptModel:string};message?:string};

export default function ProviderSettings({
  authenticated,supabaseConfigured,environmentProviders,onSaved,onMessage
}:{
  authenticated:boolean;
  supabaseConfigured:boolean;
  environmentProviders:{openai:boolean;youtube:boolean};
  onSaved:()=>void;
  onMessage:(message:string)=>void;
}){
 const [providers,setProviders]=useState<Status[]>(()=>
   ['openai','youtube','elevenlabs','googleai','pexels','pixabay','unsplash','r2'].map(provider=>{
     const env=provider==='openai'?environmentProviders.openai:provider==='youtube'?environmentProviders.youtube:false;
     return {provider:provider as Provider,configured:env,source:env?'environment':null,last4:null};
   })
 );
 const [models,setModels]=useState<readonly Model[]>(fallbackModels);
 const [analysisModel,setAnalysisModel]=useState(defaultSettings.analysisModel);
 const [scriptModel,setScriptModel]=useState(defaultSettings.scriptModel);
 const [openaiKey,setOpenaiKey]=useState('');
 const [youtubeKey,setYoutubeKey]=useState('');
 const [elevenlabsKey,setElevenlabsKey]=useState('');
 const [googleAiKey,setGoogleAiKey]=useState('');
 const [pexelsKey,setPexelsKey]=useState('');
 const [pixabayKey,setPixabayKey]=useState('');
 const [unsplashKey,setUnsplashKey]=useState('');
 const [r2AccountId,setR2AccountId]=useState('');
 const [r2AccessKeyId,setR2AccessKeyId]=useState('');
 const [r2SecretAccessKey,setR2SecretAccessKey]=useState('');
 const [r2Bucket,setR2Bucket]=useState('cacadores-media');
 const [r2PublicUrl,setR2PublicUrl]=useState('');
 const [busy,setBusy]=useState('');

 async function load(){
   if(!authenticated||!supabaseConfigured)return;
   try{
     const response=await fetch('/api/provider-settings',{cache:'no-store'});
     const body=await response.json();
     if(!response.ok)throw new Error(body.message??'Não foi possível abrir o cofre.');
     apply(body);
   }catch(error){onMessage(error instanceof Error?error.message:'Não foi possível abrir o cofre.');}
 }
 useEffect(()=>{void load();},[authenticated,supabaseConfigured]);
 function apply(body:Payload){
   setProviders(body.providers);
   setModels(body.models);
   setAnalysisModel(body.selection.analysisModel);
   setScriptModel(body.selection.scriptModel);
 }
 async function send(body:Record<string,unknown>,key:string){
   setBusy(key);
   try{
     const response=await fetch('/api/provider-settings',{
       method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify(body)
     });
     const result=await response.json();
     if(!response.ok)throw new Error(result.message??'Não foi possível salvar a configuração.');
     apply(result);onMessage(result.message);onSaved();return true;
   }catch(error){
     onMessage(error instanceof Error?error.message:'Não foi possível salvar a configuração.');
     return false;
   }finally{setBusy('');}
 }

 const ready=authenticated&&supabaseConfigured;
 const status=(provider:Provider)=>providers.find(x=>x.provider===provider)??{provider,configured:false,source:null,last4:null};
 const openai=status('openai'),youtube=status('youtube'),elevenlabs=status('elevenlabs'),googleai=status('googleai');
 const pexels=status('pexels'),pixabay=status('pixabay'),unsplash=status('unsplash'),r2=status('r2');

 return <section className="provider-section">
  <div className="settings-section-head">
   <div><span className="eyebrow">CREDENCIAIS & MODELOS</span><h2>Central de inteligência</h2><p>Conecte inteligência, distribuição, bancos de mídia e o storage proprietário da operação.</p></div>
   <span className={`vault-state ${ready?'ready':''}`}><ShieldCheck size={16}/>{ready?'Cofre disponível':'Cofre aguardando acesso'}</span>
  </div>

  {!ready&&<div className="config-gate"><KeyRound size={19}/><div><strong>{authenticated?'Supabase ainda não configurado':'Entre na operação para configurar'}</strong><p>{authenticated?'A base privada precisa estar ativa antes de receber chaves.':'As credenciais só podem ser vistas e alteradas depois do login.'}</p></div></div>}

  <div className="provider-grid">
   <CredentialCard provider="openai" title="OpenAI API" description="Pesquisa, anatomia, crítica e roteiros." status={openai} value={openaiKey} onChange={setOpenaiKey} disabled={!ready} busy={busy} icon={<BrainCircuit size={20}/>} placeholder="sk-…" onSave={async()=>{if(await send({action:'saveSecret',provider:'openai',key:openaiKey},'openai-save'))setOpenaiKey('');}} onTest={()=>void send({action:'test',provider:'openai'},'openai-test')} onRemove={()=>void send({action:'removeSecret',provider:'openai'},'openai-remove')}/>
   <CredentialCard provider="youtube" title="YouTube Data API" description="Descoberta e estatísticas públicas dos canais." status={youtube} value={youtubeKey} onChange={setYoutubeKey} disabled={!ready} busy={busy} icon={<Play size={20}/>} placeholder="AIza…" onSave={async()=>{if(await send({action:'saveSecret',provider:'youtube',key:youtubeKey},'youtube-save'))setYoutubeKey('');}} onTest={()=>void send({action:'test',provider:'youtube'},'youtube-test')} onRemove={()=>void send({action:'removeSecret',provider:'youtube'},'youtube-remove')}/>
   <CredentialCard provider="elevenlabs" title="ElevenLabs" description="Narração e vozes do Voice Engine." status={elevenlabs} value={elevenlabsKey} onChange={setElevenlabsKey} disabled={!ready} busy={busy} icon={<Mic2 size={20}/>} placeholder="sk_…" onSave={async()=>{if(await send({action:'saveSecret',provider:'elevenlabs',key:elevenlabsKey},'elevenlabs-save'))setElevenlabsKey('');}} onTest={()=>void send({action:'test',provider:'elevenlabs'},'elevenlabs-test')} onRemove={()=>void send({action:'removeSecret',provider:'elevenlabs'},'elevenlabs-remove')}/>
   <CredentialCard provider="googleai" title="Google AI" description="Nano Banana e Veo para o Asset Factory." status={googleai} value={googleAiKey} onChange={setGoogleAiKey} disabled={!ready} busy={busy} icon={<ImageIcon size={20}/>} placeholder="AIza…" onSave={async()=>{if(await send({action:'saveSecret',provider:'googleai',key:googleAiKey},'googleai-save'))setGoogleAiKey('');}} onTest={()=>void send({action:'test',provider:'googleai'},'googleai-test')} onRemove={()=>void send({action:'removeSecret',provider:'googleai'},'googleai-remove')}/>

   <CredentialCard provider="pexels" title="Pexels" description="Fotos e vídeos para o Stock Media Engine." status={pexels} value={pexelsKey} onChange={setPexelsKey} disabled={!ready} busy={busy} icon={<Images size={20}/>} placeholder="Pexels API key" onSave={async()=>{if(await send({action:'saveSecret',provider:'pexels',key:pexelsKey},'pexels-save'))setPexelsKey('');}} onTest={()=>void send({action:'test',provider:'pexels'},'pexels-test')} onRemove={()=>void send({action:'removeSecret',provider:'pexels'},'pexels-remove')}/>
   <CredentialCard provider="pixabay" title="Pixabay" description="Imagens e vídeos alternativos para Stock Media." status={pixabay} value={pixabayKey} onChange={setPixabayKey} disabled={!ready} busy={busy} icon={<Film size={20}/>} placeholder="Pixabay API key" onSave={async()=>{if(await send({action:'saveSecret',provider:'pixabay',key:pixabayKey},'pixabay-save'))setPixabayKey('');}} onTest={()=>void send({action:'test',provider:'pixabay'},'pixabay-test')} onRemove={()=>void send({action:'removeSecret',provider:'pixabay'},'pixabay-remove')}/>
   <CredentialCard provider="unsplash" title="Unsplash" description="Fotografia editorial e stock em alta resolução. Imagens apenas." status={unsplash} value={unsplashKey} onChange={setUnsplashKey} disabled={!ready} busy={busy} icon={<ImageIcon size={20}/>} placeholder="Unsplash Access Key" minLength={8} onSave={async()=>{if(await send({action:'saveSecret',provider:'unsplash',key:unsplashKey},'unsplash-save'))setUnsplashKey('');}} onTest={()=>void send({action:'test',provider:'unsplash'},'unsplash-test')} onRemove={()=>void send({action:'removeSecret',provider:'unsplash'},'unsplash-remove')}/>

   <R2Card
     status={r2}
     disabled={!ready}
     busy={busy}
     accountId={r2AccountId}
     accessKeyId={r2AccessKeyId}
     secretAccessKey={r2SecretAccessKey}
     bucket={r2Bucket}
     publicUrl={r2PublicUrl}
     onAccountId={setR2AccountId}
     onAccessKeyId={setR2AccessKeyId}
     onSecretAccessKey={setR2SecretAccessKey}
     onBucket={setR2Bucket}
     onPublicUrl={setR2PublicUrl}
     onSave={async()=>{
       const ok=await send({
         action:'saveR2',
         accountId:r2AccountId,
         accessKeyId:r2AccessKeyId,
         secretAccessKey:r2SecretAccessKey,
         bucket:r2Bucket,
         publicUrl:r2PublicUrl
       },'r2-save');
       if(ok){setR2AccountId('');setR2AccessKeyId('');setR2SecretAccessKey('');setR2PublicUrl('');}
     }}
     onTest={()=>void send({action:'test',provider:'r2'},'r2-test')}
     onRemove={()=>void send({action:'removeSecret',provider:'r2'},'r2-remove')}
   />

   <article className="credential-card">
    <div className="credential-head"><span className="integration-icon"><Film size={20}/></span><div><h3>Videezy</h3><p>Fonte complementar de stock. Importação manual com licença conferida por asset.</p></div><span className="tag">Manual</span></div>
    <p className="credential-note">Não automatizamos scraping. Quando usado, o arquivo entra no Asset Vault com URL de origem, licença e atribuição exigida.</p>
    <div className="credential-actions"><a className="button subtle small" href="https://www.videezy.com/" target="_blank" rel="noreferrer">Abrir Videezy <ExternalLink size={13}/></a></div>
   </article>
  </div>

  <div className="model-panel">
   <div className="model-copy"><span className="integration-icon openai"><BrainCircuit size={18}/></span><div><strong>Modelos da operação</strong><p>A pesquisa e a anatomia usam o modelo de inteligência. O roteiro pode usar um modelo diferente.</p></div></div>
   <div className="model-selects"><label>Pesquisa e análise<select value={analysisModel} disabled={!ready} onChange={event=>setAnalysisModel(event.target.value)}>{models.map(model=><option key={model.id} value={model.id}>{model.name} — {model.description}</option>)}</select></label><label>Roteiros em inglês<select value={scriptModel} disabled={!ready} onChange={event=>setScriptModel(event.target.value)}>{models.map(model=><option key={model.id} value={model.id}>{model.name} — {model.description}</option>)}</select></label></div>
   <div className="model-actions"><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noreferrer">Ver catálogo oficial <ExternalLink size={13}/></a><button className="button primary" disabled={!ready||!!busy} onClick={()=>void send({action:'saveModels',analysisModel,scriptModel},'models')}><Check size={16}/>{busy==='models'?'Salvando…':'Salvar modelos'}</button></div>
  </div>
 </section>;
}

function CredentialCard({
 provider,title,description,status,value,onChange,disabled,busy,icon,placeholder,minLength=20,onSave,onTest,onRemove
}:{
 provider:Provider;title:string;description:string;status:Status;value:string;onChange:(value:string)=>void;
 disabled:boolean;busy:string;icon:React.ReactNode;placeholder:string;minLength?:number;
 onSave:()=>void;onTest:()=>void;onRemove:()=>void
}){
 const prefix=provider;
 return <article className="credential-card">
  <div className="credential-head"><span className={`integration-icon ${prefix}`}>{icon}</span><div><h3>{title}</h3><p>{description}</p></div><span className={`tag ${status.configured?'green':''}`}>{status.configured?(status.last4?`Chave salva · ••••${status.last4}`:'Chave salva'):'Pendente'}</span></div>
  <label>Chave privada<input type="password" autoComplete="new-password" spellCheck={false} placeholder={status.configured?'Cole uma nova chave para substituir':placeholder} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/></label>
  <p className="credential-note">{status.source==='vault'?'Cifrada no Supabase Vault. Use “Testar conexão” para validar acesso e quota.':status.source==='environment'?'Definida no ambiente de hospedagem. Use “Testar conexão” para validar acesso e quota.':'O valor nunca retorna para o navegador.'}</p>
  <div className="credential-actions"><button className="button primary small" disabled={disabled||value.trim().length<minLength||!!busy} onClick={onSave}>{busy===`${prefix}-save`?'Validando…':'Validar e salvar'}</button><button className="button subtle small" disabled={disabled||!status.configured||!!busy} onClick={onTest}>{busy===`${prefix}-test`?'Testando…':'Testar conexão'}</button>{status.source==='vault'&&<button className="icon-button danger" aria-label={`Remover chave ${title}`} disabled={!!busy} onClick={onRemove}><Trash2 size={17}/></button>}</div>
 </article>;
}

function R2Card({
 status,disabled,busy,accountId,accessKeyId,secretAccessKey,bucket,publicUrl,
 onAccountId,onAccessKeyId,onSecretAccessKey,onBucket,onPublicUrl,onSave,onTest,onRemove
}:{
 status:Status;disabled:boolean;busy:string;accountId:string;accessKeyId:string;secretAccessKey:string;
 bucket:string;publicUrl:string;onAccountId:(v:string)=>void;onAccessKeyId:(v:string)=>void;
 onSecretAccessKey:(v:string)=>void;onBucket:(v:string)=>void;onPublicUrl:(v:string)=>void;
 onSave:()=>void;onTest:()=>void;onRemove:()=>void
}){
 const complete=accountId.trim().length>=10&&accessKeyId.trim().length>=8&&secretAccessKey.trim().length>=16&&bucket.trim().length>=3;
 return <article className="credential-card">
  <div className="credential-head"><span className="integration-icon r2"><HardDrive size={20}/></span><div><h3>Cloudflare R2</h3><p>Asset Vault e storage privado das mídias da operação.</p></div><span className={`tag ${status.configured?'green':''}`}>{status.configured?(status.last4?`Conectado · ••••${status.last4}`:'Conectado'):'Pendente'}</span></div>
  <label>Account ID<input type="password" autoComplete="new-password" value={accountId} disabled={disabled} onChange={e=>onAccountId(e.target.value)} placeholder={status.configured?'Preencha todos os campos para substituir':'Cloudflare Account ID'}/></label>
  <label>Access Key ID<input type="password" autoComplete="new-password" value={accessKeyId} disabled={disabled} onChange={e=>onAccessKeyId(e.target.value)} placeholder="R2 Access Key ID"/></label>
  <label>Secret Access Key<input type="password" autoComplete="new-password" value={secretAccessKey} disabled={disabled} onChange={e=>onSecretAccessKey(e.target.value)} placeholder="R2 Secret Access Key"/></label>
  <label>Bucket<input value={bucket} disabled={disabled} onChange={e=>onBucket(e.target.value)} placeholder="cacadores-media"/></label>
  <label>Public URL <small>opcional</small><input value={publicUrl} disabled={disabled} onChange={e=>onPublicUrl(e.target.value)} placeholder="https://media.seudominio.com"/></label>
  <p className="credential-note"><Cloud size={13}/> Mídia nova usa R2 quando esta conexão está ativa. Assets antigos do Supabase continuam legíveis pelo storage híbrido.</p>
  <div className="credential-actions"><button className="button primary small" disabled={disabled||!complete||!!busy} onClick={onSave}>{busy==='r2-save'?'Validando…':'Validar e salvar'}</button><button className="button subtle small" disabled={disabled||!status.configured||!!busy} onClick={onTest}>{busy==='r2-test'?'Testando…':'Testar conexão'}</button>{status.source==='vault'&&<button className="icon-button danger" aria-label="Remover Cloudflare R2" disabled={!!busy} onClick={onRemove}><Trash2 size={17}/></button>}</div>
 </article>;
}

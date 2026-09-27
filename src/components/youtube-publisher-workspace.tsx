'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle,
  Play, RefreshCw, RotateCcw, Send, ShieldCheck
} from 'lucide-react';
import type {
  LinkedYouTubeChannel, ManagedChannel, PublicationPackage, YouTubePublishJob
} from '@/lib/types';

type State={
  configured:boolean;
  missing:string[];
  linkedChannels:LinkedYouTubeChannel[];
  jobs:YouTubePublishJob[];
  readyPackages:PublicationPackage[];
};

const EMPTY:State={configured:false,missing:[],linkedChannels:[],jobs:[],readyPackages:[]};

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function statusLabel(status:YouTubePublishJob['status']){
  return {
    queued:'Na fila',processing:'Publicando',completed:'Publicado',
    failed:'Falhou',cancelled:'Cancelado'
  }[status];
}

export default function YouTubePublisherWorkspace({channel}:{channel:ManagedChannel}){
  const [state,setState]=useState<State>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/youtube-publisher?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar YouTube Publisher.');
      setState({
        configured:Boolean(body.configured),
        missing:Array.isArray(body.missing)?body.missing:[],
        linkedChannels:Array.isArray(body.linkedChannels)?body.linkedChannels:[],
        jobs:body.jobs??[],
        readyPackages:body.readyPackages??[]
      });
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar YouTube Publisher.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  useEffect(()=>{
    if(!state.jobs.some(job=>job.status==='queued'||job.status==='processing'))return;
    const stream=new EventSource('/api/youtube-publisher/events?channelId='+encodeURIComponent(channel.id));
    const listener=(event:MessageEvent)=>{
      try{
        const body=JSON.parse(event.data) as {jobs?:YouTubePublishJob[]};
        if(body.jobs)setState(prev=>({...prev,jobs:body.jobs!}));
      }catch{}
    };
    stream.addEventListener('jobs',listener as EventListener);
    stream.onerror=()=>{};
    return()=>{
      stream.removeEventListener('jobs',listener as EventListener);
      stream.close();
    };
  },[channel.id,state.jobs.some(job=>job.status==='queued'||job.status==='processing')]);

  async function publisherAction(payload:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/youtube-publisher',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha na publicação YouTube.');
      setMessage(body.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha na publicação YouTube.');
    }finally{setBusy('');}
  }

  async function validateLinkedChannel(item:LinkedYouTubeChannel){
    const key='validate:'+item.id;
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/youtube-channels',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'validate',youtubeChannelId:item.id})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha na conexão YouTube.');
      setMessage(body.message??'Conexão YouTube validada.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha na conexão YouTube.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="youtube-loading"><LoaderCircle className="spin" size={19}/>Carregando YouTube Publisher…</div>;

  return <div className="youtube-publisher">
    {message&&<div className="youtube-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="youtube-hero">
      <div>
        <span>YOUTUBE CONNECTION & PUBLISHER</span>
        <h2>Publicação controlada, versionada e retomável.</h2>
        <p>O upload só parte de um Publication Package aprovado. O worker persiste progresso, retoma sessões interrompidas e nunca expõe refresh tokens ao navegador.</p>
      </div>
      <Play size={39}/>
    </section>

    <section className="youtube-connection">
      <div className="youtube-section-head">
        <div>
          <span>CANAIS VINCULADOS AO PROJETO</span>
          <h3>{state.linkedChannels.length?state.linkedChannels.length+' destino(s) configurado(s).':'Nenhum destino YouTube vinculado.'}</h3>
          <p>O Publication Package escolhe explicitamente qual destes canais receberá cada vídeo.</p>
        </div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={13}/>Atualizar</button>
      </div>

      {!state.configured&&<div className="youtube-config-blocker">
        <AlertTriangle size={17}/>
        <div><strong>OAuth ainda não configurado no servidor.</strong><p>Variáveis pendentes: {state.missing.join(', ')||'credenciais OAuth do YouTube'}.</p></div>
      </div>}

      <div className="youtube-project-channel-list">
        {state.linkedChannels.map(item=><article className={'youtube-channel-card '+item.status} key={item.id}>
          {item.youtubeThumbnail?<img src={item.youtubeThumbnail} alt="Canal YouTube"/>:<div className="youtube-channel-avatar"><Play size={22}/></div>}
          <div>
            <span>{item.status.toUpperCase()}{item.isPrimary?' · PRINCIPAL':''}</span>
            <strong>{item.youtubeTitle}</strong>
            <small>{item.youtubeHandle||item.youtubeChannelId}</small>
            {item.lastValidatedAt&&<small>Validado em {when(item.lastValidatedAt)}</small>}
            {item.error&&<p>{item.error}</p>}
          </div>
          <div className="youtube-channel-inline-actions">
            <button className="button subtle small" disabled={busy==='validate:'+item.id} onClick={()=>void validateLinkedChannel(item)}><ShieldCheck size={13}/>{busy==='validate:'+item.id?'Validando…':'Validar'}</button>
            <a className="button subtle small" href={'https://www.youtube.com/channel/'+encodeURIComponent(item.youtubeChannelId)} target="_blank" rel="noreferrer"><ExternalLink size={13}/>YouTube</a>
          </div>
        </article>)}
        {!state.linkedChannels.length&&<div className="youtube-empty-inline">Vincule um canal na Gestão de projetos para habilitar o Packaging e a publicação.</div>}
      </div>

      {state.configured&&<div className="youtube-connection-actions">
        <a className="button primary" href={'/api/youtube-oauth/start?channelId='+encodeURIComponent(channel.id)}><Play size={14}/>Conectar outro canal</a>
      </div>}
    </section>

    <section className="youtube-ready">
      <div className="youtube-section-head">
        <div><span>APPROVED PACKAGES</span><h3>Prontos para entrar na fila.</h3><p>O package vira um snapshot imutável no momento do enqueue.</p></div>
      </div>
      <div className="youtube-ready-list">
        {state.readyPackages.map(pkg=>{const target=state.linkedChannels.find(item=>item.youtubeChannelId===pkg.targetYouTubeChannelId);const targetReady=target?.status==='connected';return <article key={pkg.id}>
          <div><strong>{pkg.metadata.title}</strong><span>Package v{pkg.version} · {pkg.metadata.visibility} · destino: {target?.youtubeTitle??pkg.targetYouTubeChannelId??'não definido'}{target?.youtubeHandle?' · '+target.youtubeHandle:''}</span></div>
          <button className="button primary small" disabled={!targetReady||busy==='queue:'+pkg.id} onClick={()=>void publisherAction({action:'queue',packageId:pkg.id},'queue:'+pkg.id)}>
            {busy==='queue:'+pkg.id?<LoaderCircle className="spin" size={13}/>:<Send size={13}/>}
            Enfileirar
          </button>
        </article>;})}
        {!state.readyPackages.length&&<div className="youtube-empty-inline">Nenhum Publication Package aprovado aguardando envio.</div>}
      </div>
    </section>

    <section className="youtube-jobs">
      <div className="youtube-section-head"><div><span>PUBLISH QUEUE</span><h3>Uploads e histórico.</h3></div></div>
      <div className="youtube-job-list">
        {state.jobs.map(job=><article key={job.id} className={'youtube-job '+job.status}>
          <header>
            <div><span>{statusLabel(job.status)} · tentativa {job.attempts}</span><strong>{job.payload.video.title}</strong><small>{when(job.createdAt)}</small></div>
            <b>{job.progress}%</b>
          </header>
          <div className="youtube-progress"><i style={{width:Math.max(0,Math.min(100,job.progress))+'%'}}/></div>
          <div className="youtube-job-meta">
            <span>Etapa: {job.stage}</span>
            <span>Package v{job.packageVersion}</span>
            <span>Privacidade solicitada: {job.payload.video.privacyStatus}</span>
            {job.actualPrivacyStatus&&<span>Privacidade real: {job.actualPrivacyStatus}</span>}
          </div>
          {job.error&&<div className="youtube-job-error"><AlertTriangle size={13}/>{job.error}</div>}
          <footer>
            <div>
              {job.youtubeUrl&&<a className="button subtle small" href={job.youtubeUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>Abrir no YouTube</a>}
            </div>
            <div>
              {(job.status==='queued'||job.status==='processing')&&<button className="button subtle small danger" disabled={busy==='cancel:'+job.id} onClick={()=>void publisherAction({action:'cancel',jobId:job.id},'cancel:'+job.id)}>Cancelar</button>}
              {(job.status==='failed'||job.status==='cancelled')&&<button className="button subtle small" disabled={state.linkedChannels.find(item=>item.youtubeChannelId===job.payload.youtubeChannelId)?.status!=='connected'||busy==='retry:'+job.id} onClick={()=>void publisherAction({action:'retry',jobId:job.id},'retry:'+job.id)}><RotateCcw size={13}/>Retry</button>}
            </div>
          </footer>
        </article>)}
      </div>
      {!state.jobs.length&&<div className="youtube-empty"><Play size={28}/><h3>Nenhuma publicação ainda.</h3><p>Quando um package aprovado for enfileirado, ele aparecerá aqui.</p></div>}
    </section>
  </div>;
}

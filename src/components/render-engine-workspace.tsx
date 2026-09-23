'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, Film, LoaderCircle, RefreshCw,
  RotateCcw, Sparkles, Square, XCircle
} from 'lucide-react';
import type { ManagedChannel, RenderJob, RenderPreset, VideoEdit } from '@/lib/types';

function when(value?:string){
  if(!value)return '—';
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function bytes(value?:number){
  if(value===undefined)return '—';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}
function duration(value:number){
  const m=Math.floor(value/60);
  const s=Math.round(value%60).toString().padStart(2,'0');
  return m+':'+s;
}

export default function RenderEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [jobs,setJobs]=useState<RenderJob[]>([]);
  const [edits,setEdits]=useState<VideoEdit[]>([]);
  const [videoEditId,setVideoEditId]=useState('');
  const [preset,setPreset]=useState<RenderPreset>('source');
  const [liveStatus,setLiveStatus]=useState<'connecting'|'live'|'fallback'>('connecting');
  const [crf,setCrf]=useState(20);
  const [audioBitrateKbps,setAudioBitrateKbps]=useState(192);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const selectedEdit=useMemo(()=>edits.find(edit=>edit.id===videoEditId)??null,[edits,videoEditId]);
  const active=useMemo(()=>jobs.some(job=>job.status==='queued'||job.status==='processing'),[jobs]);

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/render-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Render Engine.');
      const nextJobs=(body.jobs??[]) as RenderJob[];
      const nextEdits=(body.videoEdits??[]) as VideoEdit[];
      setJobs(nextJobs);
      setEdits(nextEdits);
      setVideoEditId(prev=>prev&&nextEdits.some(edit=>edit.id===prev)?prev:(nextEdits[0]?.id??''));
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Render Engine.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);
  useEffect(()=>{
    setLiveStatus('connecting');
    const source=new EventSource('/api/render-engine/events?channelId='+encodeURIComponent(channel.id));
    const onJobs=(event:Event)=>{
      try{
        const body=JSON.parse((event as MessageEvent<string>).data) as {jobs?:RenderJob[]};
        if(Array.isArray(body.jobs))setJobs(body.jobs);
      }catch{}
    };
    source.addEventListener('jobs',onJobs);
    source.onopen=()=>setLiveStatus('live');
    source.onerror=()=>setLiveStatus('fallback');
    return()=>{
      source.removeEventListener('jobs',onJobs);
      source.close();
    };
  },[channel.id]);
  useEffect(()=>{
    if(!active||liveStatus!=='fallback')return;
    const id=window.setInterval(()=>void load(true),4000);
    return()=>window.clearInterval(id);
  },[active,channel.id,liveStatus]);

  async function action(body:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/render-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha no Render Engine.');
      setMessage(result.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Render Engine.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="render-loading"><Sparkles className="spin" size={20}/>Carregando Render Engine…</div>;

  return <div className="render-engine">
    {message&&<div className="render-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="render-hero">
      <div><span>RENDER ENGINE</span><h2>Transforme o projeto aprovado em MP4 final.</h2><p>O job captura um manifest imutável, roda em worker FFmpeg separado e continua mesmo se você fechar esta tela.</p></div>
      <Film size={34}/>
    </section>

    <section className="render-create">
      <div className="render-section-head"><div><span>NEW RENDER · V3</span><h3>Preset versionado + fallback de encoder.</h3><p>Novos jobs usam render-v3 com saída explícita e fallback libx264 → MPEG-4.</p></div></div>
      <div className="render-grid four">
        <label>Video Edit aprovado<select value={videoEditId} onChange={e=>setVideoEditId(e.target.value)}><option value="">Selecione</option>{edits.map(edit=><option key={edit.id} value={edit.id}>v{edit.version} · {duration(edit.durationSeconds)} · {edit.format.width}×{edit.format.height}</option>)}</select></label>
        <label>Preset<select value={preset} onChange={e=>setPreset(e.target.value as RenderPreset)}><option value="source">Source</option><option value="hd-1080p30">HD 1080p · 30 fps</option><option value="draft-720p30">Draft 720p · 30 fps</option></select></label>
        <label>Qualidade CRF<input type="number" min="18" max="30" step="1" value={crf} onChange={e=>setCrf(Number(e.target.value))}/><small>18 = maior qualidade/arquivo · 30 = menor arquivo</small></label>
        <label>Áudio AAC<input type="number" min="96" max="320" step="16" value={audioBitrateKbps} onChange={e=>setAudioBitrateKbps(Number(e.target.value))}/><small>kbps</small></label>
      </div>
      {selectedEdit&&<div className="render-edit-summary"><strong>Video Edit v{selectedEdit.version}</strong><span>{duration(selectedEdit.durationSeconds)}</span><span>{selectedEdit.clipStyles.length} clips</span><span>{selectedEdit.captions.cues.length} captions</span><span>{selectedEdit.overlays.length} overlays</span></div>}
      <button className="button primary" disabled={!videoEditId||busy==='create'} onClick={()=>void action({action:'create',videoEditId,preset,crf,audioBitrateKbps},'create')}><Film size={15}/>{busy==='create'?'Enfileirando…':'Enfileirar render'}</button>
    </section>

    <section className="render-jobs">
      <div className="render-section-head"><div><span>RENDER QUEUE · {liveStatus==='live'?'LIVE SSE':liveStatus==='fallback'?'POLLING FALLBACK':'CONNECTING'}</span><h3>Jobs e outputs.</h3><p>Progresso via SSE em tempo real; polling de 4 s entra somente como fallback de conexão.</p></div><button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={14}/>Atualizar</button></div>

      <div className="render-job-list">{jobs.map(job=><article key={job.id} className={job.status}>
        <div className="render-job-top">
          <div className="render-job-status">
            {job.status==='completed'?<CheckCircle2 size={18}/>:
             job.status==='failed'?<XCircle size={18}/>:
             job.status==='cancelled'?<Square size={18}/>:
             <LoaderCircle className={job.status==='processing'?'spin':''} size={18}/>}
            <div><strong>{job.status}</strong><span>{job.stage}</span></div>
          </div>
          <div className="render-job-meta"><span>edit v{job.videoEditVersion}</span><span>attempt {job.attempts}</span><span>{when(job.createdAt)}</span></div>
        </div>

        <div className="render-progress"><span style={{width:Math.max(0,Math.min(100,job.progress))+'%'}}/><em>{job.progress}%</em></div>

        <div className="render-job-details">
          <span>{job.payload.compilerVersion}</span>
          <span>{job.payload.preset??'source'}</span>
          <span>CRF {job.payload.crf}</span>
          <span>AAC {job.payload.audioBitrateKbps} kbps</span>
          <span>{(job.payload.outputFormat??job.payload.manifest.format).width}×{(job.payload.outputFormat??job.payload.manifest.format).height}</span>
          <span>{(job.payload.outputFormat??job.payload.manifest.format).fps} fps</span>
          <span>{duration(job.payload.manifest.durationSeconds)}</span>
          {job.outputBytes!==undefined&&<span>{bytes(job.outputBytes)}</span>}
        </div>

        {job.error&&<div className="render-error"><AlertTriangle size={14}/><span>{job.error}</span></div>}

        <div className="render-job-actions">
          {(job.status==='queued'||job.status==='processing')&&<button className="button subtle small" disabled={busy==='cancel:'+job.id} onClick={()=>void action({action:'cancel',jobId:job.id},'cancel:'+job.id)}><Square size={13}/>Cancelar</button>}
          {(job.status==='failed'||job.status==='cancelled')&&<button className="button subtle small" disabled={busy==='retry:'+job.id} onClick={()=>void action({action:'retry',jobId:job.id},'retry:'+job.id)}><RotateCcw size={13}/>Retry</button>}
          {job.status==='completed'&&job.outputSignedUrl&&<a className="button primary small" href={job.outputSignedUrl} target="_blank" rel="noreferrer"><Download size={13}/>Abrir MP4</a>}
        </div>
      </article>)}</div>

      {!jobs.length&&<div className="render-empty"><Film size={27}/><h3>Nenhum render ainda.</h3><p>Aprove um Video Edit e enfileire o primeiro output.</p></div>}
    </section>
  </div>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, Film, LoaderCircle, RefreshCw,
  RotateCcw, Sparkles, Square, UploadCloud, XCircle
} from 'lucide-react';
import type { ManagedChannel, RenderJob, RenderPreset, RenderWorkerNode, VideoEditListItem } from '@/lib/types';
import { renderCapacityForecast, renderCapacityProfiles, renderFleetSizing } from '@/lib/render-capacity-policy';

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
function forecastTime(valueMinutes:number){
  if(!Number.isFinite(valueMinutes)||valueMinutes<0)return '—';
  const total=Math.round(valueMinutes);
  const h=Math.floor(total/60);
  const m=total%60;
  return h?h+'h '+String(m).padStart(2,'0')+'m':m+' min';
}

type EpisodeOption={id:string;sequence:number;status:string;title:string;updatedAt:string};

function fileMime(file:File){
  if(file.type)return file.type;
  const name=file.name.toLowerCase();
  if(name.endsWith('.mp4'))return 'video/mp4';
  if(name.endsWith('.mp3'))return 'audio/mpeg';
  if(name.endsWith('.wav'))return 'audio/wav';
  if(name.endsWith('.m4a'))return 'audio/mp4';
  if(name.endsWith('.aac'))return 'audio/aac';
  if(name.endsWith('.ogg'))return 'audio/ogg';
  if(name.endsWith('.webm'))return 'audio/webm';
  return 'application/octet-stream';
}

export default function RenderEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [jobs,setJobs]=useState<RenderJob[]>([]);
  const [workers,setWorkers]=useState<RenderWorkerNode[]>([]);
  const [edits,setEdits]=useState<VideoEditListItem[]>([]);
  const [videoEditId,setVideoEditId]=useState('');
  const [preset,setPreset]=useState<RenderPreset>('source');
  const [liveStatus,setLiveStatus]=useState<'connecting'|'live'|'fallback'>('connecting');
  const [crf,setCrf]=useState(20);
  const [audioBitrateKbps,setAudioBitrateKbps]=useState(192);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [targetVideosPerDay,setTargetVideosPerDay]=useState(12);
  const [fleetUtilizationPercent,setFleetUtilizationPercent]=useState(80);
  const [episodes,setEpisodes]=useState<EpisodeOption[]>([]);
  const [externalEpisodeId,setExternalEpisodeId]=useState('');
  const [externalVideo,setExternalVideo]=useState<File|null>(null);
  const [externalAudio,setExternalAudio]=useState<File|null>(null);
  const [externalStage,setExternalStage]=useState('');
  const [externalProgress,setExternalProgress]=useState(0);

  const selectedEdit=useMemo(()=>edits.find(edit=>edit.id===videoEditId)??null,[edits,videoEditId]);
  const active=useMemo(()=>jobs.some(job=>job.status==='queued'||job.status==='processing'),[jobs]);
  const onlineWorkers=useMemo(()=>workers.filter(worker=>worker.status!=='offline'),[workers]);
  const totalNanoCpus=useMemo(()=>onlineWorkers.reduce((sum,worker)=>sum+(worker.nanoCpus??0),0),[onlineWorkers]);
  const totalMemoryBytes=useMemo(()=>onlineWorkers.reduce((sum,worker)=>sum+(worker.memoryBytes??0),0),[onlineWorkers]);
  const capacityProfiles=useMemo(()=>renderCapacityProfiles(jobs),[jobs]);
  const coldCapacity=useMemo(()=>capacityProfiles.find(
    profile=>profile.preset===preset&&profile.mode==='cold'
  )??null,[capacityProfiles,preset]);
  const cachedCapacity=useMemo(()=>capacityProfiles.find(
    profile=>profile.preset===preset&&profile.mode==='cached'
  )??null,[capacityProfiles,preset]);
  const forecastDurations=[20,30,40,50,60];
  const coldForecast=useMemo(()=>coldCapacity?renderCapacityForecast({
    profile:coldCapacity,
    durationsMinutes:forecastDurations,
    onlineWorkers:onlineWorkers.length
  }):[],[coldCapacity,onlineWorkers.length]);
  const fleetSizing=useMemo(()=>coldCapacity?renderFleetSizing({
    profile:coldCapacity,
    durationsMinutes:forecastDurations,
    targetVideosPerDay,
    onlineWorkers:onlineWorkers.length,
    utilization:fleetUtilizationPercent/100
  }):[],[coldCapacity,targetVideosPerDay,onlineWorkers.length,fleetUtilizationPercent]);

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/render-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Render Engine.');
      const nextJobs=(body.jobs??[]) as RenderJob[];
      const nextEdits=(body.videoEdits??[]) as VideoEditListItem[];
      setJobs(nextJobs);
      setWorkers((body.workers??[]) as RenderWorkerNode[]);
      setEdits(nextEdits);
      const nextEpisodes=(body.episodes??[]) as EpisodeOption[];
      setEpisodes(nextEpisodes);
      setExternalEpisodeId(prev=>prev&&nextEpisodes.some(item=>item.id===prev)
        ?prev:(nextEpisodes.find(item=>item.status==='producing')?.id??nextEpisodes[0]?.id??''));
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
        const body=JSON.parse((event as MessageEvent<string>).data) as {jobs?:RenderJob[];workers?:RenderWorkerNode[]};
        if(Array.isArray(body.jobs))setJobs(body.jobs);
        if(Array.isArray(body.workers))setWorkers(body.workers);
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

  function streamExternal(url:string,file:File,label:string){
    return new Promise<void>((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('PUT',url);
      xhr.setRequestHeader('Content-Type',fileMime(file));
      xhr.setRequestHeader('X-Upload-Size',String(file.size));
      xhr.withCredentials=true;
      xhr.upload.onprogress=event=>{
        if(!event.lengthComputable)return;
        const pct=Math.max(0,Math.min(100,Math.round((event.loaded/event.total)*100)));
        setExternalStage(label+' '+pct+'%');
        setExternalProgress(pct);
      };
      xhr.onerror=()=>reject(new Error('A conexão foi interrompida durante o upload.'));
      xhr.onabort=()=>reject(new Error('Upload cancelado.'));
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){resolve();return;}
        let msg='Falha ao transmitir o arquivo ao R2.';
        try{msg=JSON.parse(xhr.responseText)?.message??msg;}catch{}
        reject(new Error(msg));
      };
      xhr.send(file);
    });
  }

  async function uploadExternalMaster(){
    if(!externalEpisodeId||!externalVideo)return;
    setBusy('external-master');setMessage('');setExternalProgress(0);
    try{
      setExternalStage('Preparando master no R2…');
      const prepare=await fetch('/api/render-engine',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'external-prepare',
          channelId:channel.id,
          episodeId:externalEpisodeId,
          video:{fileName:externalVideo.name,mimeType:fileMime(externalVideo),bytes:externalVideo.size},
          audio:externalAudio?{fileName:externalAudio.name,mimeType:fileMime(externalAudio),bytes:externalAudio.size}:undefined
        })
      });
      const prepared=await prepare.json().catch(()=>({}));
      if(!prepare.ok)throw new Error(prepared.message??'Falha ao preparar o master externo.');
      await streamExternal(prepared.videoUploadUrl,externalVideo,'Enviando MP4 ao R2…');
      if(externalAudio&&prepared.audioUploadUrl){
        setExternalProgress(0);
        await streamExternal(prepared.audioUploadUrl,externalAudio,'Enviando áudio ao R2…');
      }
      setExternalStage('Validando arquivo e registrando no episódio…');
      const finalize=await fetch('/api/render-engine',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'external-finalize',jobId:prepared.jobId})
      });
      const finished=await finalize.json().catch(()=>({}));
      if(!finalize.ok)throw new Error(finished.message??'Falha ao finalizar o master externo.');
      setExternalProgress(100);
      setExternalStage('Concluído · pronto para Production QA');
      setMessage(finished.message??'Master externo importado.');
      setExternalVideo(null);setExternalAudio(null);
      await load(true);
    }catch(error){
      setExternalStage('Falhou');
      setMessage(error instanceof Error?error.message:'Falha ao importar o master externo.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="render-loading"><Sparkles className="spin" size={20}/>Carregando Render Engine…</div>;

  return <div className="render-engine">
    {message&&<div className="render-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="render-hero">
      <div><span>RENDER ENGINE</span><h2>Transforme o projeto aprovado em MP4 final.</h2><p>O job captura um manifest imutável, roda em worker FFmpeg separado e continua mesmo se você fechar esta tela.</p></div>
      <Film size={34}/>
    </section>

    <section className="render-workers">
      <div className="render-section-head">
        <div><span>RENDER NODES · SCALE-OUT READY</span><h3>{onlineWorkers.length} online · {(totalNanoCpus/1e9).toFixed(1)} CPU · {bytes(totalMemoryBytes)}</h3><p>A fila usa SKIP LOCKED; cada job é atribuído a um único nó e o cache v4 continua compartilhado via R2.</p></div>
      </div>
      <div className="render-worker-grid">{workers.map(worker=><article key={worker.id} className={worker.status}>
        <div><strong>{worker.id}</strong><span>{worker.status}</span></div>
        <p>SHA {worker.versionSha?worker.versionSha.slice(0,7):'—'} · {worker.nanoCpus?Number(worker.nanoCpus/1e9).toFixed(1)+' CPU':'—'} · {bytes(worker.memoryBytes)}</p>
        <p>Disco livre {bytes(worker.freeDiskBytes)} · visto {when(worker.lastSeenAt)}</p>
        <div className="render-worker-stats">
          <span><b>{worker.completedJobs}</b> concluídos/7d</span>
          <span><b>{worker.failedJobs}</b> falhas/7d</span>
          <span><b>{worker.avgRealTimeFactor===undefined?'—':worker.avgRealTimeFactor.toFixed(2)+'×'}</b> RTF médio</span>
          <span><b>{worker.totalFinishedMinutes.toFixed(0)}m</b> entregues/7d</span>
        </div>
        {worker.currentJobId&&<small>job atual {worker.currentJobId.slice(0,8)}</small>}
      </article>)}</div>
      {!workers.length&&<div className="render-worker-empty">Nenhum render node registrou heartbeat ainda.</div>}
    </section>

    <section className="render-capacity">
      <div className="render-section-head">
        <div>
          <span>CAPACITY FORECAST · DADOS OBSERVADOS</span>
          <h3>{preset} · {coldCapacity?coldCapacity.medianRealTimeFactor.toFixed(2)+'× RTF cold':'sem amostra cold'}</h3>
          <p>Tempo de um vídeo usa a mediana dos renders frios do mesmo preset. Mais nodes aumentam throughput da fila; um único vídeo continua em um único node.</p>
        </div>
        <div className="render-capacity-samples">
          <span>{coldCapacity?.sampleCount??0} cold sample(s)</span>
          <span>{cachedCapacity?.sampleCount??0} cache sample(s)</span>
        </div>
      </div>
      {coldCapacity?<div className="render-capacity-table">
        <div className="head"><span>Duração final</span><span>1 job / 1 node</span><span>Frota atual</span></div>
        {coldForecast.map(row=><div key={row.durationMinutes}>
          <strong>{row.durationMinutes} min</strong>
          <span>{forecastTime(row.singleJobMinutes)}</span>
          <span>{onlineWorkers.length?row.fleetVideosPerDay.toFixed(1)+' vídeos/dia':'0 nodes online'}</span>
        </div>)}
      </div>:<div className="render-capacity-empty">Ainda não há render frio concluído para este preset. A previsão aparecerá após a primeira amostra real.</div>}
      {coldCapacity&&<div className="render-fleet-planner">
        <div className="render-fleet-controls">
          <label>Meta diária<input type="number" min="1" max="100" step="1" value={targetVideosPerDay} onChange={e=>setTargetVideosPerDay(Math.max(1,Math.min(100,Number(e.target.value)||1)))}/><small>vídeos/dia</small></label>
          <label>Utilização segura<input type="number" min="50" max="100" step="5" value={fleetUtilizationPercent} onChange={e=>setFleetUtilizationPercent(Math.max(50,Math.min(100,Number(e.target.value)||80)))}/><small>% do dia disponível para render</small></label>
          <div><strong>{onlineWorkers.length}</strong><small>node(s) online agora</small></div>
          <div><strong>{coldCapacity.sampleCount<3?'baixa':'observada'}</strong><small>confiança · {coldCapacity.sampleCount} amostra(s)</small></div>
        </div>
        <div className="render-fleet-table">
          <div className="head"><span>Duração</span><span>Capacidade segura atual</span><span>Nodes p/ meta</span><span>Adicionar</span></div>
          {fleetSizing.map(row=><div key={row.durationMinutes}>
            <strong>{row.durationMinutes} min</strong>
            <span>{row.currentSafeVideosPerDay.toFixed(1)} vídeos/dia</span>
            <span>{row.requiredWorkers} node(s)</span>
            <span>{row.additionalWorkers>0?'+'+row.additionalWorkers:'nenhum'}</span>
          </div>)}
        </div>
      </div>}
      {cachedCapacity&&<div className="render-capacity-cache">
        <strong>Revisão 100% cacheada observada</strong>
        <span>{cachedCapacity.medianRealTimeFactor.toFixed(2)}× RTF · {cachedCapacity.sampleCount} amostra(s)</span>
      </div>}
      {coldCapacity&&<small className="render-capacity-note">Faixa observada cold: {coldCapacity.minRealTimeFactor.toFixed(2)}×–{coldCapacity.maxRealTimeFactor.toFixed(2)}× RTF. A previsão é operacional, não promessa de duração: densidade de clips, captions, transições e cache alteram o tempo.</small>}
    </section>

    <section className="render-create">
      <div className="render-section-head">
        <div>
          <span>MASTER EXTERNO · AUTOEDITOR → R2</span>
          <h3>Importe o MP4 final sem consumir o Supabase Storage.</h3>
          <p>O arquivo é transmitido diretamente ao Cloudflare R2, vinculado ao episódio e registrado como master pronto para Production QA.</p>
        </div>
        <UploadCloud size={28}/>
      </div>
      <div className="render-grid four">
        <label>Episódio<select value={externalEpisodeId} onChange={e=>setExternalEpisodeId(e.target.value)}>
          <option value="">Selecione</option>
          {episodes.map(item=><option key={item.id} value={item.id}>EP{String(item.sequence).padStart(2,'0')} · {item.title} · {item.status}</option>)}
        </select></label>
        <label>MP4 final<input type="file" accept="video/mp4,.mp4" onChange={e=>setExternalVideo(e.target.files?.[0]??null)}/><small>{externalVideo?externalVideo.name+' · '+bytes(externalVideo.size):'Obrigatório · até 2 GB'}</small></label>
        <label>Áudio final<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm" onChange={e=>setExternalAudio(e.target.files?.[0]??null)}/><small>{externalAudio?externalAudio.name+' · '+bytes(externalAudio.size):'Opcional se o take final já estiver registrado'}</small></label>
        <div className="render-edit-summary"><strong>Destino</strong><span>Cloudflare R2</span><span>Supabase: metadados apenas</span><span>QA → Packaging → YouTube</span></div>
      </div>
      {externalStage&&<div className="render-progress"><span style={{width:externalProgress+'%'}}/><em>{externalStage}</em></div>}
      {!episodes.length&&<div className="render-capacity-empty">Nenhum episódio cadastrado neste canal. Crie o episódio no Content OS antes de importar o master.</div>}
      <button className="button primary" disabled={!externalEpisodeId||!externalVideo||busy==='external-master'} onClick={()=>void uploadExternalMaster()}>
        <UploadCloud size={15}/>{busy==='external-master'?'Enviando master…':'Importar master externo'}
      </button>
    </section>

    <section className="render-create">
      <div className="render-section-head"><div><span>NEW RENDER · V4</span><h3>Capítulos cacheáveis + master incremental.</h3><p>Novos jobs usam render-v4: capítulos cacheáveis e master incremental. Draft 720p usa encoder ultrafast para revisão; Source/1080p mantêm preset medium para entrega final.</p></div></div>
      <div className="render-grid four">
        <label>Video Edit aprovado<select value={videoEditId} onChange={e=>setVideoEditId(e.target.value)}><option value="">Selecione</option>{edits.map(edit=><option key={edit.id} value={edit.id}>v{edit.version} · {duration(edit.durationSeconds)} · {edit.width}×{edit.height}</option>)}</select></label>
        <label>Preset<select value={preset} onChange={e=>{
          const next=e.target.value as RenderPreset;
          setPreset(next);
          setCrf(current=>{
            if(next==='draft-720p30'&&current===20)return 28;
            if(next!=='draft-720p30'&&current===28)return 20;
            return current;
          });
        }}><option value="source">Source</option><option value="hd-1080p30">HD 1080p · 30 fps</option><option value="draft-720p30">Draft rápido · 720p · 30 fps</option></select></label>
        <label>Qualidade CRF<input type="number" min="18" max="30" step="1" value={crf} onChange={e=>setCrf(Number(e.target.value))}/><small>Final padrão 20 · Draft rápido padrão 28 · 18 = maior qualidade/arquivo</small></label>
        <label>Áudio AAC<input type="number" min="96" max="320" step="16" value={audioBitrateKbps} onChange={e=>setAudioBitrateKbps(Number(e.target.value))}/><small>kbps</small></label>
      </div>
      {selectedEdit&&<div className="render-edit-summary"><strong>Video Edit v{selectedEdit.version}</strong><span>{duration(selectedEdit.durationSeconds)}</span><span>{selectedEdit.clipStyleCount} clips</span><span>{selectedEdit.captionCount} captions</span><span>{selectedEdit.overlayCount} overlays</span></div>}
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
          <div className="render-job-meta"><span>{job.payload.source==='external-master'?('master externo v'+(job.payload.externalMaster?.version??1)):('edit v'+job.videoEditVersion)}</span><span>{job.payload.source==='external-master'?'AutoEditor':'attempt '+job.attempts}</span><span>{when(job.createdAt)}</span></div>
        </div>

        <div className="render-progress"><span style={{width:Math.max(0,Math.min(100,job.progress))+'%'}}/><em>{job.progress}%</em></div>

        <div className="render-job-details">
          <span>{job.payload.compilerVersion}</span>
          <span>{job.payload.preset??'source'} · {job.payload.encoderPreset??(job.payload.preset==='draft-720p30'?'ultrafast':'medium')}</span>
          <span>CRF {job.payload.crf}</span>
          <span>AAC {job.payload.audioBitrateKbps} kbps</span>
          <span>{(job.payload.outputFormat??job.payload.manifest.format).width}×{(job.payload.outputFormat??job.payload.manifest.format).height}</span>
          <span>{(job.payload.outputFormat??job.payload.manifest.format).fps} fps</span>
          <span>{duration(job.payload.manifest.durationSeconds)}</span>
          {job.outputBytes!==undefined&&<span>{bytes(job.outputBytes)}</span>}
        </div>

        {job.payload.metrics&&<div className="render-v4-metrics">
          <span><strong>{job.payload.metrics.realTimeFactor.toFixed(2)}×</strong> real-time</span>
          <span><strong>{job.payload.metrics.secondsPerFinishedMinute.toFixed(0)}s</strong> / min final</span>
          <span><strong>{job.payload.metrics.cacheHits}</strong> cache hits</span>
          <span><strong>{job.payload.metrics.renderedChapters}</strong> capítulos renderizados</span>
        </div>}

        {Boolean(job.chapters?.length)&&<div className="render-chapter-list">{job.chapters!.map(chapter=><article key={chapter.id} className={chapter.status}>
          <div>
            <strong>{String(chapter.sequence).padStart(2,'0')} · {chapter.label}</strong>
            <span>{duration(chapter.durationSeconds)} · {chapter.cacheHit?'CACHE HIT':chapter.status}</span>
          </div>
          <div className="render-chapter-progress"><span style={{width:Math.max(0,Math.min(100,chapter.progress))+'%'}}/></div>
          <div>
            {chapter.renderSeconds!==undefined&&<small>{chapter.renderSeconds.toFixed(1)}s render</small>}
            {chapter.outputBytes!==undefined&&<small>{bytes(chapter.outputBytes)}</small>}
            {(chapter.status==='failed'||chapter.status==='cancelled')&&
              (job.status==='failed'||job.status==='cancelled')&&
              <button className="button subtle small" disabled={busy==='retry-chapter:'+chapter.id} onClick={()=>void action({
                action:'retry-chapter',jobId:job.id,chapterId:chapter.id
              },'retry-chapter:'+chapter.id)}><RotateCcw size={12}/>Retry capítulo</button>}
          </div>
          {chapter.error&&<p>{chapter.error}</p>}
        </article>)}</div>}

        {job.error&&<div className="render-error"><AlertTriangle size={14}/><span>{job.error}</span></div>}

        <div className="render-job-actions">
          {(job.status==='queued'||job.status==='processing')&&<button className="button subtle small" disabled={busy==='cancel:'+job.id} onClick={()=>void action({action:'cancel',jobId:job.id},'cancel:'+job.id)}><Square size={13}/>Cancelar</button>}
          {(job.status==='failed'||job.status==='cancelled')&&job.payload.source!=='external-master'&&<button className="button subtle small" disabled={busy==='retry:'+job.id} onClick={()=>void action({action:'retry',jobId:job.id},'retry:'+job.id)}><RotateCcw size={13}/>Retry</button>}
          {job.status==='completed'&&job.outputSignedUrl&&<a className="button primary small" href={job.outputSignedUrl} target="_blank" rel="noreferrer"><Download size={13}/>Abrir MP4</a>}
        </div>
      </article>)}</div>

      {!jobs.length&&<div className="render-empty"><Film size={27}/><h3>Nenhum render ainda.</h3><p>Aprove um Video Edit e enfileire o primeiro output.</p></div>}
    </section>
  </div>;
}

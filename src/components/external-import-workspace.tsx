'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, CircleAlert, FileAudio, FileText, Film, FolderUp,
  Image as ImageIcon, Link2, RefreshCw, SkipForward, Sparkles, Upload
} from 'lucide-react';
import type {
  EpisodeScriptListItem, ExternalImportBatch, ExternalImportItem, ManagedChannel,
  VisualPromptSet, VoiceAssetListItem
} from '@/lib/types';
import {
  classifyExternalFile, previewExternalImportFiles
} from '@/lib/external-import-policy';

type VoiceAssetView=VoiceAssetListItem;

function fileIcon(kind:ExternalImportItem['kind']){
  if(kind==='image')return <ImageIcon size={15}/>;
  if(kind==='video')return <Film size={15}/>;
  if(kind==='audio')return <FileAudio size={15}/>;
  return <FileText size={15}/>;
}
function formatBytes(value:number){
  if(value<1024)return value+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}
function batchProgress(batch:ExternalImportBatch){
  const total=batch.items.length;
  const done=batch.items.filter(item=>item.status==='ready'||item.status==='skipped').length;
  const problems=batch.items.filter(item=>item.status==='failed'||item.status==='unmatched').length;
  return {total,done,problems,pct:total?Math.round(done/total*100):0};
}
function fileDescriptor(file:File){return {name:file.name,size:file.size,type:file.type};}

export default function ExternalImportWorkspace({channel}:{channel:ManagedChannel}){
  const [scripts,setScripts]=useState<EpisodeScriptListItem[]>([]);
  const [promptSets,setPromptSets]=useState<VisualPromptSet[]>([]);
  const [batches,setBatches]=useState<ExternalImportBatch[]>([]);
  const [scriptId,setScriptId]=useState('');
  const [promptSetId,setPromptSetId]=useState('');
  const [voiceAssets,setVoiceAssets]=useState<VoiceAssetView[]>([]);
  const [voiceAssetId,setVoiceAssetId]=useState('');
  const [sourceLabel,setSourceLabel]=useState('');
  const [files,setFiles]=useState<File[]>([]);
  const [active,setActive]=useState<ExternalImportBatch|null>(null);
  const [busy,setBusy]=useState('');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');

  const selectedScript=useMemo(()=>scripts.find(item=>item.id===scriptId)??null,[scripts,scriptId]);
  const compatiblePromptSets=useMemo(()=>promptSets.filter(set=>!selectedScript||set.episodeId===selectedScript.episodeId),[promptSets,selectedScript]);
  const selectedPromptSet=useMemo(()=>promptSets.find(item=>item.id===promptSetId)??null,[promptSets,promptSetId]);
  const preview=useMemo(()=>previewExternalImportFiles(files.map(fileDescriptor),selectedPromptSet?.scenePrompts??[]),[files,selectedPromptSet]);
  const previewProblems=preview.filter(item=>item.status==='unmatched').length;

  async function load(){
    setLoading(true);setMessage('');
    try{
      const [scriptsRes,visualRes,batchesRes]=await Promise.all([
        fetch('/api/script-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'}),
        fetch('/api/visual-prompt-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'}),
        fetch('/api/external-import?channelId='+encodeURIComponent(channel.id),{cache:'no-store'})
      ]);
      const scriptsBody=await scriptsRes.json().catch(()=>({}));
      const visualBody=await visualRes.json().catch(()=>({}));
      const batchesBody=await batchesRes.json().catch(()=>({}));
      if(!scriptsRes.ok)throw new Error(scriptsBody.message??'Falha ao carregar roteiros.');
      if(!visualRes.ok)throw new Error(visualBody.message??'Falha ao carregar Visual Prompt Sets.');
      if(!batchesRes.ok)throw new Error(batchesBody.message??'Falha ao carregar batches.');

      const approvedScripts=(scriptsBody.scripts??[]).filter((item:EpisodeScript)=>item.status==='approved');
      const approvedSets=(visualBody.promptSets??[]).filter((item:VisualPromptSet)=>item.status==='approved');
      setScripts(approvedScripts);
      setPromptSets(approvedSets);
      setBatches(batchesBody.batches??[]);

      if(!scriptId&&approvedScripts.length)setScriptId(approvedScripts[0].id);
      if(!promptSetId&&approvedSets.length)setPromptSetId(approvedSets[0].id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar importação externa.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  useEffect(()=>{
    if(!scriptId){setVoiceAssets([]);setVoiceAssetId('');return;}
    let cancelled=false;
    void fetch('/api/voice-engine?scriptId='+encodeURIComponent(scriptId),{cache:'no-store'})
      .then(async res=>{
        const body=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(body.message??'Falha ao carregar takes.');
        if(cancelled)return;
        const ready=(body.assets??[]).filter((item:VoiceAssetView)=>item.status==='ready');
        setVoiceAssets(ready);
        const selected=ready.find((item:VoiceAssetView)=>item.selected);
        setVoiceAssetId(prev=>prev&&ready.some((item:VoiceAssetView)=>item.id===prev)?prev:(selected?.id??''));
      })
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Falha ao carregar takes.');});
    return()=>{cancelled=true;};
  },[scriptId]);

  useEffect(()=>{
    if(!selectedScript)return;
    const compatible=promptSets.filter(set=>set.episodeId===selectedScript.episodeId);
    if(promptSetId&&!compatible.some(set=>set.id===promptSetId))setPromptSetId(compatible[0]?.id??'');
  },[selectedScript?.id,promptSets]);

  async function createBatch(){
    if(!scriptId||!files.length)return;
    setBusy('create');setMessage('');
    try{
      const res=await fetch('/api/external-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'create',
          channelId:channel.id,
          scriptId,
          visualPromptSetId:promptSetId||undefined,
          voiceAssetId:voiceAssetId||undefined,
          sourceLabel:sourceLabel.trim()||undefined,
          files:files.map(fileDescriptor)
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao criar Import Batch.');
      setActive(body.batch);
      setBatches(prev=>[body.batch,...prev.filter(item=>item.id!==body.batch.id)]);
      setMessage(body.message??'Batch criado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar batch.');}
    finally{setBusy('');}
  }

  function localFileFor(item:ExternalImportItem){
    return files.find(file=>file.name===item.originalName&&file.size===item.bytes)??null;
  }

  async function uploadOne(batch:ExternalImportBatch,item:ExternalImportItem){
    const file=localFileFor(item);
    if(!file)throw new Error('Resselecione '+item.originalName+' para continuar.');
    const form=new FormData();
    form.set('batchId',batch.id);
    form.set('itemId',item.id);
    form.set('file',file);
    const res=await fetch('/api/external-import',{method:'POST',body:form});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.message??'Falha ao processar '+item.originalName+'.');
    return body.batch as ExternalImportBatch;
  }

  async function uploadGroup(batch:ExternalImportBatch,items:ExternalImportItem[],concurrency:number){
    let latest=batch;
    let cursor=0;
    const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{
      while(cursor<items.length){
        const index=cursor++;
        const item=items[index];
        try{
          latest=await uploadOne(latest,item);
          setActive(latest);
          setBatches(prev=>[latest,...prev.filter(entry=>entry.id!==latest.id)]);
        }catch(error){
          setMessage(error instanceof Error?error.message:'Falha em um arquivo do batch.');
          const refresh=await fetch('/api/external-import?batchId='+encodeURIComponent(batch.id),{cache:'no-store'});
          const body=await refresh.json().catch(()=>({}));
          if(refresh.ok&&body.batch){latest=body.batch;setActive(latest);}
        }
      }
    });
    await Promise.all(workers);
    return latest;
  }

  async function processPending(){
    if(!active)return;
    setBusy('upload');setMessage('');
    try{
      let batch=active;
      const processable=batch.items.filter(item=>
        (item.status==='pending'||item.status==='failed')&&localFileFor(item)
      );
      const audios=processable.filter(item=>item.kind==='audio');
      const transcripts=processable.filter(item=>item.kind==='transcript');
      const media=processable.filter(item=>item.kind==='image'||item.kind==='video');

      if(audios.length)batch=await uploadGroup(batch,audios,1);
      if(transcripts.length){
        const currentItems=(await (await fetch('/api/external-import?batchId='+encodeURIComponent(batch.id),{cache:'no-store'})).json()).batch?.items??batch.items;
        const currentTranscripts=currentItems.filter((item:ExternalImportItem)=>
          item.kind==='transcript'&&(item.status==='pending'||item.status==='failed')&&localFileFor(item)
        );
        batch=await uploadGroup({...batch,items:currentItems},currentTranscripts,1);
      }
      const refreshed=await fetch('/api/external-import?batchId='+encodeURIComponent(batch.id),{cache:'no-store'});
      const refreshedBody=await refreshed.json().catch(()=>({}));
      if(refreshed.ok&&refreshedBody.batch)batch=refreshedBody.batch;
      const currentMedia=batch.items.filter(item=>
        (item.kind==='image'||item.kind==='video')&&
        (item.status==='pending'||item.status==='failed')&&
        !!item.matchedSceneId&&!!localFileFor(item)
      );
      if(currentMedia.length)batch=await uploadGroup(batch,currentMedia,3);

      const finalRes=await fetch('/api/external-import?batchId='+encodeURIComponent(batch.id),{cache:'no-store'});
      const finalBody=await finalRes.json().catch(()=>({}));
      if(finalRes.ok&&finalBody.batch)batch=finalBody.batch;
      setActive(batch);
      setBatches(prev=>[batch,...prev.filter(item=>item.id!==batch.id)]);
      setMessage('Processamento do batch concluído para todos os arquivos disponíveis.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao processar batch.');}
    finally{setBusy('');}
  }

  async function remap(item:ExternalImportItem,sceneId:string){
    if(!active||!sceneId)return;
    setBusy('map:'+item.id);
    try{
      const res=await fetch('/api/external-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'remap',batchId:active.id,itemId:item.id,sceneId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao remapear arquivo.');
      setActive(body.batch);setBatches(prev=>[body.batch,...prev.filter(entry=>entry.id!==body.batch.id)]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao remapear arquivo.');}
    finally{setBusy('');}
  }

  async function skip(item:ExternalImportItem){
    if(!active)return;
    setBusy('skip:'+item.id);
    try{
      const res=await fetch('/api/external-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'skip',batchId:active.id,itemId:item.id})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao ignorar arquivo.');
      setActive(body.batch);setBatches(prev=>[body.batch,...prev.filter(entry=>entry.id!==body.batch.id)]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao ignorar arquivo.');}
    finally{setBusy('');}
  }

  async function openBatch(batch:ExternalImportBatch){
    setBusy('open');setMessage('');
    try{
      const res=await fetch('/api/external-import?batchId='+encodeURIComponent(batch.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir batch.');
      const loaded=body.batch as ExternalImportBatch;
      setActive(loaded);
      setScriptId(loaded.scriptId);
      setPromptSetId(loaded.visualPromptSetId??'');
      setVoiceAssetId(loaded.payload.voiceAssetId??'');
      setSourceLabel(loaded.payload.sourceLabel??'');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir batch.');}
    finally{setBusy('');}
  }

  const activeProgress=active?batchProgress(active):null;
  const activePromptSet=active?.visualPromptSetId
    ?promptSets.find(set=>set.id===active.visualPromptSetId)??selectedPromptSet
    :selectedPromptSet;

  if(loading)return <div className="external-import-loading"><Sparkles className="spin" size={20}/>Carregando External Import…</div>;

  return <div className="external-import">
    {message&&<div className="external-import-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="external-import-hero">
      <div><span>EXTERNAL PRODUCTION COMPATIBILITY</span><h2>Traga a produção externa inteira de uma vez.</h2><p>Nano Banana, ElevenLabs, TurboScribe, editores externos ou arquivos próprios entram no mesmo pipeline interno sem perder timecode, cena ou linhagem.</p></div>
      <FolderUp size={34}/>
    </section>

    {!active&&<section className="external-import-create">
      <div className="external-import-grid two">
        <Field label="Roteiro aprovado"><select value={scriptId} onChange={e=>setScriptId(e.target.value)}><option value="">Selecione</option>{scripts.map(script=><option key={script.id} value={script.id}>{script.title} · v{script.version}</option>)}</select></Field>
        <Field label="Visual Prompt Set"><select value={promptSetId} onChange={e=>setPromptSetId(e.target.value)}><option value="">Sem mapeamento visual</option>{compatiblePromptSets.map(set=><option key={set.id} value={set.id}>v{set.version} · {set.scenePrompts.length} cenas</option>)}</select></Field>
        <Field label="Take existente para transcript"><select value={voiceAssetId} onChange={e=>setVoiceAssetId(e.target.value)}><option value="">Usar áudio do próprio batch</option>{voiceAssets.map(asset=><option key={asset.id} value={asset.id}>Take {asset.take}{asset.selected?' · ativo':''}</option>)}</select></Field>
        <Field label="Origem / lote"><input value={sourceLabel} onChange={e=>setSourceLabel(e.target.value)} placeholder="Ex.: Nano Banana + TurboScribe"/></Field>
      </div>

      <label className="external-import-picker">
        <Upload size={28}/>
        <span>Selecionar pacote de produção<small>Imagens, vídeos, áudio e SRT/VTT/TXT/JSON — seleção múltipla.</small></span>
        <input type="file" multiple accept="image/*,video/*,audio/*,.srt,.vtt,.txt,.json" onChange={e=>setFiles(Array.from(e.target.files??[]))}/>
      </label>

      {files.length>0&&<>
        <section className="external-preview-summary">
          <div><strong>{files.length}</strong><small>arquivos</small></div>
          <div><strong>{preview.filter(item=>item.kind==='image').length}</strong><small>imagens</small></div>
          <div><strong>{preview.filter(item=>item.kind==='video').length}</strong><small>vídeos</small></div>
          <div><strong>{preview.filter(item=>item.kind==='audio').length}</strong><small>áudios</small></div>
          <div><strong>{preview.filter(item=>item.kind==='transcript').length}</strong><small>transcrições</small></div>
          <div className={previewProblems?'warn':''}><strong>{previewProblems}</strong><small>sem cena</small></div>
        </section>
        <div className="external-preview-list">{preview.slice(0,300).map(item=><article key={item.itemIndex} className={item.status}>
          <div>{fileIcon(item.kind)}<strong>{item.originalName}</strong></div>
          <span>{item.kind}</span>
          <span>{item.payload.normalizedMarker??'—'}</span>
          <em>{item.matchedSceneId?'mapeado':item.status==='skipped'?'ignorado':'revisar'}</em>
        </article>)}</div>
        {preview.length>300&&<div className="external-import-note">Mostrando os primeiros 300 de {preview.length} arquivos. Todos serão registrados no batch.</div>}
      </>}

      <button className="button primary" disabled={!scriptId||!files.length||busy==='create'} onClick={()=>void createBatch()}><FolderUp size={16}/>{busy==='create'?'Criando batch…':'Criar batch e revisar mapeamento'}</button>
    </section>}

    {active&&<section className="external-batch">
      <div className="external-batch-head">
        <div><button className="button subtle small" onClick={()=>{setActive(null);setFiles([]);}}>← Batches</button><span>{active.status}</span><h3>{active.payload.sourceLabel||'Import Batch'}</h3><p>{activeProgress?.done}/{activeProgress?.total} concluídos · {activeProgress?.problems} problema(s)</p></div>
        <div className="external-progress"><span style={{width:(activeProgress?.pct??0)+'%'}}/><em>{activeProgress?.pct??0}%</em></div>
      </div>

      <label className="external-reselect">
        <RefreshCw size={18}/>
        <span>Resselecionar arquivos para continuar/retry<small>Após refresh, escolha novamente o mesmo pacote; o sistema casa por nome + tamanho.</small></span>
        <input type="file" multiple accept="image/*,video/*,audio/*,.srt,.vtt,.txt,.json" onChange={e=>setFiles(Array.from(e.target.files??[]))}/>
      </label>

      <div className="external-batch-actions">
        <button className="button primary" disabled={busy==='upload'||!files.length} onClick={()=>void processPending()}><Upload size={15}/>{busy==='upload'?'Processando…':'Processar pendentes disponíveis'}</button>
      </div>

      <div className="external-item-list">{active.items.map(item=>{
        const local=localFileFor(item);
        const scene=activePromptSet?.scenePrompts.find(scene=>scene.sceneId===item.matchedSceneId);
        return <article key={item.id} className={item.status}>
          <div className="external-item-main">
            <div className="external-item-title">{fileIcon(item.kind)}<div><strong>{item.originalName}</strong><small>{formatBytes(item.bytes)} · {item.kind}</small></div></div>
            <div className="external-item-tags"><span>{item.status}</span>{item.payload.normalizedMarker&&<span>{item.payload.normalizedMarker}</span>}{item.resourceType&&<span>{item.resourceType}</span>}{!local&&(item.status==='pending'||item.status==='failed')&&<span className="warn">arquivo não reselecionado</span>}</div>
            {item.error&&<p>{item.error}</p>}
            {(item.kind==='image'||item.kind==='video')&&<div className="external-scene-map">
              <Link2 size={14}/>
              <select value={item.matchedSceneId??''} onChange={e=>void remap(item,e.target.value)} disabled={busy==='map:'+item.id}>
                <option value="">Sem cena</option>
                {(activePromptSet?.scenePrompts??[]).map(scene=><option key={scene.sceneId} value={scene.sceneId}>Scene {String(scene.sequence).padStart(3,'0')} · {scene.timecodeLabel}</option>)}
              </select>
              <small>{scene?scene.direction:'Mapeie manualmente se o nome não contém timecode.'}</small>
            </div>}
          </div>
          <div className="external-item-actions">
            {(item.status==='unmatched'||item.status==='failed')&&<button className="button subtle small" disabled={busy==='skip:'+item.id} onClick={()=>void skip(item)}><SkipForward size={13}/>Ignorar</button>}
            {item.status==='ready'&&<CheckCircle2 size={20}/>}
            {item.status==='failed'&&<CircleAlert size={20}/>}
          </div>
        </article>;
      })}</div>
    </section>}

    {!active&&batches.length>0&&<section className="external-history">
      <div className="external-section-head"><div><span>IMPORT HISTORY</span><h3>Batches anteriores.</h3></div><strong>{batches.length}</strong></div>
      <div className="external-batch-grid">{batches.map(batch=>{const p=batchProgress(batch);return <article key={batch.id}><div><span>{batch.status}</span><em>{p.pct}%</em></div><h4>{batch.payload.sourceLabel||'Import Batch'}</h4><p>{p.done}/{p.total} concluídos · {p.problems} problema(s)</p><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openBatch(batch)}>Abrir batch</button></article>;})}</div>
    </section>}
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="external-field"><span>{label}</span>{children}</label>;}

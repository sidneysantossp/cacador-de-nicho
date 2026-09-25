'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, FileVideo2, Film, Image as ImageIcon, Library, LoaderCircle,
  Search, Trash2, UploadCloud, X
} from 'lucide-react';
import type { OwnedMediaAsset } from '@/lib/types';

type Kind='all'|'video'|'image';
type QueueItem={id:string;name:string;stage:string;error?:string};

function bytes(value:number){
  if(value<1024)return value+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  if(value<1024*1024*1024)return (value/(1024*1024)).toFixed(1)+' MB';
  return (value/(1024*1024*1024)).toFixed(2)+' GB';
}
function duration(value:number|null){
  if(value===null)return '—';
  const m=Math.floor(value/60),s=Math.round(value%60).toString().padStart(2,'0');
  return m+':'+s;
}
function inferMime(file:File){
  if(file.type)return file.type;
  const lower=file.name.toLowerCase();
  if(lower.endsWith('.mp4'))return 'video/mp4';
  if(lower.endsWith('.mov'))return 'video/quicktime';
  if(lower.endsWith('.webm'))return 'video/webm';
  if(lower.endsWith('.jpg')||lower.endsWith('.jpeg'))return 'image/jpeg';
  if(lower.endsWith('.png'))return 'image/png';
  if(lower.endsWith('.webp'))return 'image/webp';
  return 'application/octet-stream';
}
async function browserMetadata(file:File){
  const url=URL.createObjectURL(file);
  try{
    if(inferMime(file).startsWith('video/')){
      return await new Promise<{width:number|null;height:number|null;durationSeconds:number|null}>((resolve)=>{
        const video=document.createElement('video');
        video.preload='metadata';
        video.onloadedmetadata=()=>resolve({
          width:video.videoWidth||null,
          height:video.videoHeight||null,
          durationSeconds:Number.isFinite(video.duration)?video.duration:null
        });
        video.onerror=()=>resolve({width:null,height:null,durationSeconds:null});
        video.src=url;
      });
    }
    return await new Promise<{width:number|null;height:number|null;durationSeconds:number|null}>((resolve)=>{
      const image=new window.Image();
      image.onload=()=>resolve({width:image.naturalWidth||null,height:image.naturalHeight||null,durationSeconds:null});
      image.onerror=()=>resolve({width:null,height:null,durationSeconds:null});
      image.src=url;
    });
  }finally{URL.revokeObjectURL(url);}
}

export default function OwnedMediaLibraryWorkspace(){
  const inputRef=useRef<HTMLInputElement>(null);
  const [items,setItems]=useState<OwnedMediaAsset[]>([]);
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState<Kind>('all');
  const [loading,setLoading]=useState(true);
  const [dragging,setDragging]=useState(false);
  const [queue,setQueue]=useState<QueueItem[]>([]);
  const [message,setMessage]=useState('');
  const [selected,setSelected]=useState<OwnedMediaAsset|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params=new URLSearchParams({page:'1',limit:'120',kind});
      if(query.trim())params.set('q',query.trim());
      const res=await fetch('/api/owned-media?'+params.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar a Biblioteca de Mídia.');
      setItems(body.items??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar a Biblioteca de Mídia.');}
    finally{setLoading(false);}
  },[kind,query]);

  useEffect(()=>{const t=setTimeout(()=>void load(),query?250:0);return()=>clearTimeout(t);},[load,query]);

  function patchQueue(id:string,patch:Partial<QueueItem>){
    setQueue(prev=>prev.map(item=>item.id===id?{...item,...patch}:item));
  }

  async function uploadOne(file:File){
    const qid=crypto.randomUUID();
    setQueue(prev=>[{id:qid,name:file.name,stage:'Lendo metadados…'},...prev]);
    try{
      const mimeType=inferMime(file);
      const meta=await browserMetadata(file);
      patchQueue(qid,{stage:'Preparando R2…'});
      const prepare=await fetch('/api/owned-media',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'prepare',fileName:file.name,mimeType,bytes:file.size})
      });
      const prepared=await prepare.json().catch(()=>({}));
      if(!prepare.ok)throw new Error(prepared.message??'Falha ao preparar o upload.');

      patchQueue(qid,{stage:'Enviando direto para o R2…'});
      const upload=await fetch(prepared.uploadUrl,{
        method:'PUT',
        headers:{'Content-Type':mimeType},
        body:file
      });
      if(!upload.ok)throw new Error('O navegador não conseguiu enviar o arquivo ao R2. Verifique CORS do bucket.');

      patchQueue(qid,{stage:'Cadastrando e categorizando…'});
      const finalize=await fetch('/api/owned-media',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'finalize',assetId:prepared.assetId,
          width:meta.width,height:meta.height,durationSeconds:meta.durationSeconds
        })
      });
      const finished=await finalize.json().catch(()=>({}));
      if(!finalize.ok)throw new Error(finished.message??'Falha ao finalizar o cadastro.');
      patchQueue(qid,{stage:'Concluído'});
      setMessage(file.name+' entrou na Biblioteca de Mídia.');
      await load();
    }catch(error){
      patchQueue(qid,{stage:'Falhou',error:error instanceof Error?error.message:'Falha no upload.'});
    }
  }

  async function uploadFiles(files:File[]){
    const supported=files.filter(file=>/^(video\/(mp4|webm|quicktime)|image\/(jpeg|png|webp))$/.test(inferMime(file)));
    if(!supported.length){setMessage('Selecione MP4, MOV, WebM, JPG, PNG ou WebP.');return;}
    for(const file of supported)await uploadOne(file);
  }

  async function remove(item:OwnedMediaAsset){
    if(!confirm('Remover este asset da Biblioteca e do R2?'))return;
    const res=await fetch('/api/owned-media',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'delete',assetId:item.id})
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){setMessage(body.message??'Falha ao remover o asset.');return;}
    setSelected(null);setMessage(body.message??'Asset removido.');await load();
  }

  const totalBytes=useMemo(()=>items.reduce((sum,item)=>sum+item.bytes,0),[items]);

  return <div className="owned-library">
    {message&&<div className="media-library-message"><CheckCircle2 size={15}/>{message}<button onClick={()=>setMessage('')}><X size={14}/></button></div>}

    <section className="owned-library-hero">
      <div>
        <span>OWN MEDIA LIBRARY</span>
        <h2>Sua própria biblioteca visual, antes de qualquer banco externo.</h2>
        <p>Arraste vídeos e imagens. O arquivo vai direto ao R2, a nomenclatura vira inteligência inicial e o acervo passa a ser pesquisável e reutilizável.</p>
      </div>
      <div className="owned-library-stats"><strong>{items.length}</strong><span>assets</span><b>{bytes(totalBytes)}</b><small>carregados nesta página</small></div>
    </section>

    <section
      className={'owned-upload-zone '+(dragging?'dragging':'')}
      onDragEnter={e=>{e.preventDefault();setDragging(true);}}
      onDragOver={e=>{e.preventDefault();setDragging(true);}}
      onDragLeave={e=>{e.preventDefault();setDragging(false);}}
      onDrop={e=>{e.preventDefault();setDragging(false);void uploadFiles([...e.dataTransfer.files]);}}
      onClick={()=>inputRef.current?.click()}
    >
      <UploadCloud size={34}/>
      <div><strong>Arraste seus arquivos aqui</strong><span>ou clique para selecionar · upload direto ao Cloudflare R2</span></div>
      <em>MP4 · MOV · WebM · JPG · PNG · WebP · até 2 GB por arquivo</em>
      <input ref={inputRef} hidden multiple type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" onChange={e=>void uploadFiles([...(e.target.files??[])])}/>
    </section>

    {!!queue.length&&<section className="owned-upload-queue">
      <header><strong>Fila de ingestão</strong><span>{queue.length} item(ns)</span></header>
      {queue.map(item=><article key={item.id}>
        <FileVideo2 size={17}/>
        <div><strong>{item.name}</strong><span className={item.error?'error':''}>{item.error??item.stage}</span></div>
        {item.stage!=='Concluído'&&item.stage!=='Falhou'?<LoaderCircle className="spin" size={17}/>:item.stage==='Concluído'?<CheckCircle2 size={17}/>:null}
      </article>)}
    </section>}

    <section className="owned-library-toolbar">
      <label><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar local, tema, nome do arquivo, tag…"/></label>
      <div>
        <button className={kind==='all'?'active':''} onClick={()=>setKind('all')}>Todos</button>
        <button className={kind==='video'?'active':''} onClick={()=>setKind('video')}>Vídeos</button>
        <button className={kind==='image'?'active':''} onClick={()=>setKind('image')}>Imagens</button>
      </div>
    </section>

    {loading?<div className="media-library-loading"><LoaderCircle className="spin" size={20}/>Carregando biblioteca…</div>:
    <section className="owned-library-grid">
      {items.map(item=><article key={item.id} className="owned-media-card">
        <button className="owned-media-preview" onClick={()=>setSelected(item)}
          onMouseEnter={e=>{const v=e.currentTarget.querySelector('video');if(v)void v.play().catch(()=>{});}}
          onMouseLeave={e=>{const v=e.currentTarget.querySelector('video');if(v){v.pause();v.currentTime=0;}}}>
          {item.assetKind==='video'&&item.signedUrl?<video src={item.signedUrl} muted playsInline preload="metadata"/>:
           item.assetKind==='image'&&item.signedUrl?<img src={item.signedUrl} alt=""/>:
           <div><Library size={26}/></div>}
          <span>{item.assetKind==='video'?<Film size={13}/>:<ImageIcon size={13}/>} OWNED</span>
        </button>
        <div className="owned-media-card-body">
          <strong title={item.title}>{item.title}</strong>
          <small>{bytes(item.bytes)}{item.durationSeconds!==null?' · '+duration(item.durationSeconds):''}{item.width&&item.height?' · '+item.width+'×'+item.height:''}</small>
          <div>{item.tags.slice(0,5).map(tag=><span key={tag}>{tag}</span>)}</div>
        </div>
      </article>)}
    </section>}

    {!loading&&!items.length&&<div className="media-library-empty"><Library size={29}/><h3>Sua biblioteca ainda está vazia.</h3><p>O primeiro upload já começa a formar o acervo próprio da operação.</p></div>}

    {selected&&<div className="owned-detail-backdrop" onClick={()=>setSelected(null)}>
      <aside className="owned-detail" onClick={e=>e.stopPropagation()}>
        <header><div><span>OWNED ASSET</span><h3>{selected.title}</h3></div><button onClick={()=>setSelected(null)}><X size={18}/></button></header>
        <div className="owned-detail-preview">
          {selected.assetKind==='video'&&selected.signedUrl?<video controls playsInline src={selected.signedUrl}/>:
           selected.signedUrl?<img src={selected.signedUrl} alt=""/>:null}
        </div>
        <section className="owned-detail-facts">
          <span><b>Arquivo</b>{selected.originalName}</span>
          <span><b>Tamanho</b>{bytes(selected.bytes)}</span>
          {selected.durationSeconds!==null&&<span><b>Duração</b>{duration(selected.durationSeconds)}</span>}
          {selected.width&&selected.height&&<span><b>Resolução</b>{selected.width}×{selected.height}</span>}
          <span><b>Origem</b>Owned / upload local</span>
        </section>
        <section className="owned-detail-intel">
          <span>INTELIGÊNCIA DA NOMENCLATURA</span>
          <div>{selected.tags.map(tag=><em key={tag}>{tag}</em>)}</div>
          {!!selected.semantic.locations.length&&<p><b>Locais:</b> {selected.semantic.locations.join(', ')}</p>}
          {!!selected.semantic.shotTypes.length&&<p><b>Planos:</b> {selected.semantic.shotTypes.join(', ')}</p>}
          <small>Esta é a indexação inicial. A Visual Intelligence pode enriquecer o asset por frames e trechos depois da ingestão.</small>
        </section>
        <button className="button danger" onClick={()=>void remove(selected)}><Trash2 size={15}/>Remover do acervo</button>
      </aside>
    </div>}
  </div>;
}

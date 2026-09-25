'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, FileVideo2, Film, Image as ImageIcon, Library, LoaderCircle,
  Search, Trash2, UploadCloud, X
} from 'lucide-react';
import type { OwnedMediaAsset } from '@/lib/types';

type Kind='all'|'video'|'image';
type QueueItem={id:string;name:string;stage:string;progress?:number;error?:string};
type TaxonomyOption={value:string;label:string};
type TaxonomyCatalog={
  version:number;
  countries:TaxonomyOption[];
  citiesByCountry:Record<string,TaxonomyOption[]>;
  scenes:TaxonomyOption[];
  timeOfDay:TaxonomyOption[];
  weather:TaxonomyOption[];
  seasons:TaxonomyOption[];
  shotTypes:TaxonomyOption[];
  cameraMotion:TaxonomyOption[];
};
type TaxonomyFilters={
  country:string;city:string;scene:string;timeOfDay:string;
  weather:string;season:string;shotType:string;cameraMotion:string;
};
const EMPTY_FILTERS:TaxonomyFilters={
  country:'',city:'',scene:'',timeOfDay:'',weather:'',season:'',shotType:'',cameraMotion:''
};

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
  const [taxonomy,setTaxonomy]=useState<TaxonomyCatalog|null>(null);
  const [filters,setFilters]=useState<TaxonomyFilters>(EMPTY_FILTERS);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params=new URLSearchParams({page:'1',limit:'120',kind});
      if(query.trim())params.set('q',query.trim());
      for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);
      const res=await fetch('/api/owned-media?'+params.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar a Biblioteca de Mídia.');
      setItems(body.items??[]);
      if(body.taxonomy)setTaxonomy(body.taxonomy);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar a Biblioteca de Mídia.');}
    finally{setLoading(false);}
  },[kind,query,filters]);

  useEffect(()=>{const t=setTimeout(()=>void load(),query?250:0);return()=>clearTimeout(t);},[load,query]);

  function patchQueue(id:string,patch:Partial<QueueItem>){
    setQueue(prev=>prev.map(item=>item.id===id?{...item,...patch}:item));
  }


  function streamUpload(url:string,file:File,mimeType:string,qid:string){
    return new Promise<void>((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('PUT',url);
      xhr.setRequestHeader('Content-Type',mimeType);
      xhr.setRequestHeader('X-Upload-Size',String(file.size));
      xhr.withCredentials=true;
      xhr.upload.onprogress=event=>{
        if(!event.lengthComputable)return;
        const progress=Math.max(0,Math.min(100,Math.round((event.loaded/event.total)*100)));
        patchQueue(qid,{stage:'Enviando para o R2… '+progress+'%',progress});
      };
      xhr.onerror=()=>reject(new Error('A conexão foi interrompida durante o upload.'));
      xhr.onabort=()=>reject(new Error('Upload cancelado.'));
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){resolve();return;}
        let message='Falha ao transmitir o arquivo para o R2.';
        try{message=JSON.parse(xhr.responseText)?.message??message;}catch{}
        reject(new Error(message));
      };
      xhr.send(file);
    });
  }

  async function uploadOne(file:File){
    const qid=crypto.randomUUID();
    setQueue(prev=>[{id:qid,name:file.name,stage:'Lendo metadados…'},...prev]);
    try{
      const mimeType=inferMime(file);
      const meta=await browserMetadata(file);
      patchQueue(qid,{stage:'Preparando ingestão…',progress:0});
      const prepare=await fetch('/api/owned-media',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'prepare',fileName:file.name,mimeType,bytes:file.size})
      });
      const prepared=await prepare.json().catch(()=>({}));
      if(!prepare.ok)throw new Error(prepared.message??'Falha ao preparar o upload.');

      patchQueue(qid,{stage:'Enviando para o R2… 0%',progress:0});
      await streamUpload(prepared.uploadUrl,file,mimeType,qid);

      patchQueue(qid,{stage:'Cadastrando e categorizando…',progress:100});
      const finalize=await fetch('/api/owned-media',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'finalize',assetId:prepared.assetId,
          width:meta.width,height:meta.height,durationSeconds:meta.durationSeconds
        })
      });
      const finished=await finalize.json().catch(()=>({}));
      if(!finalize.ok)throw new Error(finished.message??'Falha ao finalizar o cadastro.');
      patchQueue(qid,{stage:'Concluído',progress:100});
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
  const cityOptions=useMemo(()=>{
    if(!taxonomy)return [];
    if(filters.country)return taxonomy.citiesByCountry[filters.country]??[];
    return Object.values(taxonomy.citiesByCountry).flat().sort((a,b)=>a.label.localeCompare(b.label));
  },[taxonomy,filters.country]);
  const hasTaxonomyFilters=Object.values(filters).some(Boolean);
  function setFilter(key:keyof TaxonomyFilters,value:string){
    setFilters(prev=>{
      const next={...prev,[key]:value};
      if(key==='country')next.city='';
      return next;
    });
  }

  return <div className="owned-library">
    {message&&<div className="media-library-message"><CheckCircle2 size={15}/>{message}<button onClick={()=>setMessage('')}><X size={14}/></button></div>}

    <section className="owned-library-hero">
      <div>
        <span>OWN MEDIA LIBRARY</span>
        <h2>Sua própria biblioteca visual, antes de qualquer banco externo.</h2>
        <p>Arraste vídeos e imagens. O arquivo é transmitido em streaming para o R2, a nomenclatura vira inteligência inicial e o acervo passa a ser pesquisável e reutilizável.</p>
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
      <div><strong>Arraste seus arquivos aqui</strong><span>ou clique para selecionar · transmissão em streaming ao Cloudflare R2</span></div>
      <em>MP4 · MOV · WebM · JPG · PNG · WebP · até 2 GB por arquivo</em>
      <input ref={inputRef} hidden multiple type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" onChange={e=>void uploadFiles([...(e.target.files??[])])}/>
    </section>

    {!!queue.length&&<section className="owned-upload-queue">
      <header><strong>Fila de ingestão</strong><span>{queue.length} item(ns)</span></header>
      {queue.map(item=><article key={item.id}>
        <FileVideo2 size={17}/>
        <div><strong>{item.name}</strong><span className={item.error?'error':''}>{item.error??item.stage}</span>{typeof item.progress==='number'&&!item.error&&item.stage!=='Concluído'&&<progress max="100" value={item.progress}/>}</div>
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

    {taxonomy&&<section className="owned-taxonomy-filters">
      <div className="owned-taxonomy-filter-title"><strong>Media Taxonomy v{taxonomy.version}</strong><span>Filtre o acervo pela mesma estrutura que usaremos nas pesquisas externas.</span></div>
      <div className="owned-taxonomy-filter-grid">
        <label><span>País</span><select value={filters.country} onChange={e=>setFilter('country',e.target.value)}><option value="">Todos</option>{taxonomy.countries.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Cidade</span><select value={filters.city} onChange={e=>setFilter('city',e.target.value)}><option value="">Todas</option>{cityOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Cenário</span><select value={filters.scene} onChange={e=>setFilter('scene',e.target.value)}><option value="">Todos</option>{taxonomy.scenes.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Horário</span><select value={filters.timeOfDay} onChange={e=>setFilter('timeOfDay',e.target.value)}><option value="">Todos</option>{taxonomy.timeOfDay.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Clima</span><select value={filters.weather} onChange={e=>setFilter('weather',e.target.value)}><option value="">Todos</option>{taxonomy.weather.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Estação</span><select value={filters.season} onChange={e=>setFilter('season',e.target.value)}><option value="">Todas</option>{taxonomy.seasons.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Plano</span><select value={filters.shotType} onChange={e=>setFilter('shotType',e.target.value)}><option value="">Todos</option>{taxonomy.shotTypes.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Câmera</span><select value={filters.cameraMotion} onChange={e=>setFilter('cameraMotion',e.target.value)}><option value="">Todos</option>{taxonomy.cameraMotion.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      {hasTaxonomyFilters&&<button className="button subtle small" onClick={()=>setFilters(EMPTY_FILTERS)}>Limpar filtros</button>}
    </section>}

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
          {!!selected.semantic.countries.length&&<p><b>País:</b> {selected.semantic.countries.join(', ')}</p>}
          {!!selected.semantic.regions.length&&<p><b>Região/Estado:</b> {selected.semantic.regions.join(', ')}</p>}
          {!!selected.semantic.cities.length&&<p><b>Cidade:</b> {selected.semantic.cities.join(', ')}</p>}
          {!!selected.semantic.districts.length&&<p><b>Distrito/Bairro:</b> {selected.semantic.districts.join(', ')}</p>}
          {!!selected.semantic.landmarks.length&&<p><b>Landmark:</b> {selected.semantic.landmarks.join(', ')}</p>}
          {!!selected.semantic.scenes.length&&<p><b>Cenário:</b> {selected.semantic.scenes.join(', ')}</p>}
          {!!selected.semantic.objects.length&&<p><b>Objetos:</b> {selected.semantic.objects.join(', ')}</p>}
          {!!selected.semantic.activities.length&&<p><b>Atividades:</b> {selected.semantic.activities.join(', ')}</p>}
          {!!selected.semantic.people.length&&<p><b>Pessoas:</b> {selected.semantic.people.join(', ')}</p>}
          {!!selected.semantic.timeOfDay.length&&<p><b>Horário:</b> {selected.semantic.timeOfDay.join(', ')}</p>}
          {!!selected.semantic.weather.length&&<p><b>Clima:</b> {selected.semantic.weather.join(', ')}</p>}
          {!!selected.semantic.seasons.length&&<p><b>Estação:</b> {selected.semantic.seasons.join(', ')}</p>}
          {!!selected.semantic.shotTypes.length&&<p><b>Plano:</b> {selected.semantic.shotTypes.join(', ')}</p>}
          {!!selected.semantic.cameraMotion.length&&<p><b>Movimento:</b> {selected.semantic.cameraMotion.join(', ')}</p>}
          {!!selected.semantic.moods.length&&<p><b>Mood:</b> {selected.semantic.moods.join(', ')}</p>}
          <small>Taxonomia inicial baseada no nome do arquivo. A Visual Intelligence enriquecerá e corrigirá essas facetas por frames e segmentos.</small>
        </section>
        <button className="button danger" onClick={()=>void remove(selected)}><Trash2 size={15}/>Remover do acervo</button>
      </aside>
    </div>}
  </div>;
}

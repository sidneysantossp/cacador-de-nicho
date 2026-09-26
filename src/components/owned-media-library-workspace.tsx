'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, FileVideo2, Film, Image as ImageIcon, Library, LoaderCircle,
  Search, Sparkles, Trash2, UploadCloud, X, XCircle
} from 'lucide-react';
import type { OwnedMediaAsset, OwnedMediaIntelligenceResult } from '@/lib/types';

type Kind='all'|'video'|'image';
type QueueItem={id:string;name:string;stage:string;progress?:number;error?:string;duplicate?:boolean};
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

function normalizeDuplicateName(fileName:string){
  return fileName
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\.[a-z0-9]{2,8}$/i,'')
    .replace(/\s*\(\d+\)\s*$/,'')
    .replace(/(?:[-_ ]+copy(?:[-_ ]+\d+)?)$/i,'')
    .replace(/[-_\s]+/g,' ')
    .trim();
}

async function sampledContentFingerprint(file:File){
  const chunkSize=256*1024;
  const rawOffsets=[
    0,
    Math.max(0,Math.floor(file.size*.25)-Math.floor(chunkSize/2)),
    Math.max(0,Math.floor(file.size*.5)-Math.floor(chunkSize/2)),
    Math.max(0,Math.floor(file.size*.75)-Math.floor(chunkSize/2)),
    Math.max(0,file.size-chunkSize)
  ];
  const offsets=[...new Set(rawOffsets.map(value=>Math.min(Math.max(0,value),Math.max(0,file.size-1))))];
  const chunks=await Promise.all(offsets.map(async offset=>
    new Uint8Array(await file.slice(offset,Math.min(file.size,offset+chunkSize)).arrayBuffer())
  ));
  const header=new TextEncoder().encode('sample-sha256-v1|'+file.size+'|'+offsets.join(',')+'|');
  const total=header.byteLength+chunks.reduce((sum,item)=>sum+item.byteLength,0);
  const merged=new Uint8Array(total);
  let cursor=0;
  merged.set(header,cursor);cursor+=header.byteLength;
  for(const chunk of chunks){merged.set(chunk,cursor);cursor+=chunk.byteLength;}
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',merged));
  return 'sample-sha256-v1:'+Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function withConcurrency<T,R>(items:T[],limit:number,worker:(item:T)=>Promise<R>){
  const output=new Array<R>(items.length);
  let cursor=0;
  async function run(){
    while(true){
      const index=cursor++;
      if(index>=items.length)return;
      output[index]=await worker(items[index]);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));
  return output;
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
  const [analysis,setAnalysis]=useState<OwnedMediaIntelligenceResult|null>(null);
  const [analysisLoading,setAnalysisLoading]=useState(false);

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

  async function uploadOne(qid:string,file:File,contentFingerprint?:string){
    try{
      patchQueue(qid,{stage:'Lendo metadados…',progress:0,error:undefined,duplicate:false});
      const mimeType=inferMime(file);
      const meta=await browserMetadata(file);
      patchQueue(qid,{stage:'Preparando ingestão…',progress:0});
      const prepare=await fetch('/api/owned-media',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'prepare',fileName:file.name,mimeType,bytes:file.size,contentFingerprint})
      });
      const prepared=await prepare.json().catch(()=>({}));
      if(!prepare.ok){
        if(prepare.status===409){
          patchQueue(qid,{stage:'Arquivo duplicado',progress:undefined,error:undefined,duplicate:true});
          return 'duplicate' as const;
        }
        throw new Error(prepared.message??'Falha ao preparar o upload.');
      }

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
      await load();
      return 'completed' as const;
    }catch(error){
      patchQueue(qid,{stage:'Falhou',error:error instanceof Error?error.message:'Falha no upload.',duplicate:false});
      return 'failed' as const;
    }
  }

  async function uploadFiles(files:File[]){
    if(!files.length)return;
    const supportedMime=/^(video\/(mp4|webm|quicktime)|image\/(jpeg|png|webp))$/;
    const batch=files.map(file=>({
      id:crypto.randomUUID(),
      file,
      supported:supportedMime.test(inferMime(file)),
      fingerprint:'',
      duplicate:false
    }));

    setQueue(prev=>[
      ...prev,
      ...batch.map(({id,file,supported})=>({
        id,
        name:file.name,
        stage:supported?'Verificando duplicidade…':'Falhou',
        progress:supported?0:undefined,
        error:supported?undefined:'Formato não suportado. Use MP4, MOV, WebM, JPG, PNG ou WebP.'
      }))
    ]);

    const processable=batch.filter(item=>item.supported);
    const rejected=batch.length-processable.length;
    if(!processable.length){
      setMessage('Nenhum dos arquivos selecionados possui formato suportado.');
      return;
    }

    setMessage(
      processable.length+' arquivo(s) adicionado(s) à fila · verificando duplicidade'+
      (rejected?' · '+rejected+' formato(s) não suportado(s).':'.')
    );

    await withConcurrency(processable,4,async item=>{
      try{item.fingerprint=await sampledContentFingerprint(item.file);}
      catch{item.fingerprint='';}
      return item;
    });

    const seenNames=new Map<string,{id:string;fingerprint:string}>();
    const seenFingerprints=new Set<string>();
    for(const item of processable){
      const nameKey=normalizeDuplicateName(item.file.name)+'::'+item.file.size;
      const fingerprintKey=item.fingerprint?item.fingerprint+'::'+item.file.size:'';
      const priorName=seenNames.get(nameKey);
      const duplicateByFingerprint=!!fingerprintKey&&seenFingerprints.has(fingerprintKey);
      const duplicateByName=!!priorName&&(!item.fingerprint||!priorName.fingerprint||item.fingerprint===priorName.fingerprint);
      if(duplicateByFingerprint||duplicateByName){
        item.duplicate=true;
        patchQueue(item.id,{stage:'Arquivo duplicado',progress:undefined,error:undefined,duplicate:true});
        continue;
      }
      if(!priorName)seenNames.set(nameKey,{id:item.id,fingerprint:item.fingerprint});
      if(fingerprintKey)seenFingerprints.add(fingerprintKey);
    }

    const candidates=processable.filter(item=>!item.duplicate);
    for(let offset=0;offset<candidates.length;offset+=100){
      const chunk=candidates.slice(offset,offset+100);
      const response=await fetch('/api/owned-media',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'preflight',
          files:chunk.map(item=>({
            clientId:item.id,
            fileName:item.file.name,
            bytes:item.file.size,
            contentFingerprint:item.fingerprint||undefined
          }))
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok){
        for(const item of chunk)patchQueue(item.id,{stage:'Na fila',progress:0});
        setMessage(body.message??'Não foi possível concluir a verificação de duplicidade; a proteção do servidor continuará ativa no upload.');
        continue;
      }
      const byId=new Map<string,{duplicate?:boolean}>();
      for(const result of body.results??[])byId.set(String(result.clientId),result);
      for(const item of chunk){
        if(byId.get(item.id)?.duplicate){
          item.duplicate=true;
          patchQueue(item.id,{stage:'Arquivo duplicado',progress:undefined,error:undefined,duplicate:true});
        }else{
          patchQueue(item.id,{stage:'Na fila',progress:0,error:undefined,duplicate:false});
        }
      }
    }

    let completed=0;
    let failed=0;
    let duplicates=processable.filter(item=>item.duplicate).length;
    for(const item of processable){
      if(item.duplicate)continue;
      const outcome=await uploadOne(item.id,item.file,item.fingerprint||undefined);
      if(outcome==='completed')completed++;
      else if(outcome==='duplicate')duplicates++;
      else failed++;
    }
    setMessage(
      completed+' upload(s) concluído(s)'+
      (duplicates?' · '+duplicates+' duplicado(s) ignorado(s)':'')+
      (failed?' · '+failed+' falhou/falharam.':'.')
    );
  }

  async function loadAnalysis(assetId:string){
    setAnalysisLoading(true);
    try{
      const res=await fetch('/api/owned-media/intelligence?assetId='+encodeURIComponent(assetId),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar a análise visual.');
      setAnalysis(body.analysis??null);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha ao carregar a análise visual.');
    }finally{setAnalysisLoading(false);}
  }

  async function analyzeSelected(item:OwnedMediaAsset){
    setAnalysisLoading(true);
    setMessage('Analisando conteúdo visual de '+item.originalName+'…');
    try{
      const res=await fetch('/api/owned-media/intelligence',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'analyze',assetId:item.id})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha na Visual Intelligence.');
      setAnalysis(body.analysis??null);
      setMessage('Visual Intelligence concluída: '+String(body.analysis?.segments?.length??0)+' segmento(s) indexado(s).');
      await load();
      setSelected(current=>current?.id===item.id?{
        ...current,
        visualIntelligence:{
          status:'completed',
          segmentCount:Number(body.analysis?.segments?.length??0),
          usableSegmentCount:Number(body.analysis?.usableSegmentCount??0),
          meanQuality:Number(body.analysis?.meanQuality??0),
          embeddingStatus:body.analysis?.embeddingStatus??'idle',
          analyzedAt:body.analysis?.analyzedAt
        }
      }:current);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha na Visual Intelligence.');
      await load();
    }finally{setAnalysisLoading(false);}
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
      <input ref={inputRef} hidden multiple type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" onChange={e=>{const files=[...(e.target.files??[])];e.currentTarget.value='';void uploadFiles(files);}}/>
    </section>

    {!!queue.length&&<section className="owned-upload-queue">
      <header><strong>Fila de ingestão</strong><span>{queue.length} item(ns)</span></header>
      {queue.map(item=><article key={item.id} className={item.duplicate?'duplicate':''}>
        <FileVideo2 size={17}/>
        <div><strong>{item.name}</strong><span className={item.duplicate?'duplicate':item.error?'error':''}>{item.duplicate?'Arquivo duplicado':item.error??item.stage}</span>{typeof item.progress==='number'&&!item.error&&!item.duplicate&&item.stage!=='Concluído'&&<progress max="100" value={item.progress}/>}</div>
        {item.duplicate?<XCircle className="owned-upload-duplicate-icon" size={18}/>:item.stage!=='Concluído'&&item.stage!=='Falhou'?<LoaderCircle className="spin" size={17}/>:item.stage==='Concluído'?<CheckCircle2 size={17}/>:null}
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
        <button className="owned-media-preview" onClick={()=>{setSelected(item);setAnalysis(null);void loadAnalysis(item.id);}}
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
          <small className={'owned-visual-status '+(item.visualIntelligence?.status??'idle')}>
            <Sparkles size={10}/>
            {item.visualIntelligence?.status==='completed'
              ?[
                'Visual AI · '+item.visualIntelligence.segmentCount+' segmento(s)',
                item.visualIntelligence.meanQuality!==undefined?'Q '+Math.round(item.visualIntelligence.meanQuality*100)+'%':null,
                item.visualIntelligence.embeddingStatus==='completed'?'Vector ✓':item.visualIntelligence.embeddingStatus==='failed'?'Vector !':null
              ].filter(Boolean).join(' · ')
              :item.visualIntelligence?.status==='processing'
                ?'Visual AI · processando'
                :item.visualIntelligence?.status==='failed'
                  ?'Visual AI · falhou'
                  :'Visual AI · não analisado'}
          </small>
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
          <small>Taxonomia inicial baseada no nome do arquivo. A Visual Intelligence enriquece e corrige essas facetas por frames e segmentos.</small>
        </section>
        <section className="owned-detail-visual-ai">
          <header><div><Sparkles size={15}/><strong>Visual Intelligence 2.0</strong></div>
            <span>{analysisLoading?'Processando…':analysis?.status==='completed'?analysis.segments.length+' segmento(s)':analysis?.status==='failed'?'Falhou':'Não analisado'}</span>
          </header>
          {selected.visualIntelligence?.status==='completed'&&<p>
            Qualidade média: {Math.round((selected.visualIntelligence.meanQuality??0)*100)}% ·
            {' '}{selected.visualIntelligence.usableSegmentCount??selected.visualIntelligence.segmentCount} utilizável(is) ·
            {' '}vetor {selected.visualIntelligence.embeddingStatus==='completed'?'indexado':selected.visualIntelligence.embeddingStatus==='failed'?'com falha':'pendente'}
          </p>}
          {analysis?.status==='completed'&&<div className="owned-visual-segments">
            {analysis.segments.map(segment=><article key={segment.id}>
              <b>{selected.assetKind==='image'?'Imagem':segment.startSeconds.toFixed(1)+'s–'+segment.endSeconds.toFixed(1)+'s'} · Q {Math.round(segment.qualityScore*100)}% {segment.usable?'· utilizável':'· rejeitado'}</b>
              <strong>{segment.title}</strong>
              <p>{segment.summary}</p>
              {!!segment.qualityIssues.length&&<small>{segment.qualityIssues.join(' · ')}</small>}
              <small>{[
                ...segment.semantic.locations,
                ...segment.semantic.landmarks,
                ...segment.semantic.activities,
                ...segment.semantic.objects,
                ...segment.semantic.environments,
                ...segment.semantic.timeOfDay,
                ...segment.semantic.shotTypes
              ].slice(0,8).join(' · ')}</small>
            </article>)}
          </div>}
          {analysis?.status==='failed'&&<p className="error">{analysis.error??'A análise visual falhou.'}</p>}
          <button className="button" disabled={analysisLoading} onClick={()=>void analyzeSelected(selected)}>
            {analysisLoading?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>}
            {analysis?.status==='completed'?'Reanalisar mídia':'Analisar mídia'}
          </button>
        </section>
        <button className="button danger" onClick={()=>void remove(selected)}><Trash2 size={15}/>Remover do acervo</button>
      </aside>
    </div>}
  </div>;
}

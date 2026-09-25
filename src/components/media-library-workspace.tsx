'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, FileAudio, Film, Heart, Image as ImageIcon,
  Library, ScanSearch, Search, Sparkles, Tag, X
} from 'lucide-react';
import type { ManagedChannel, MediaLibraryItem, VisualIntelligenceResult } from '@/lib/types';
import { mediaLibrarySearch, normalizeMediaSemantic, normalizeMediaTags } from '@/lib/media-library-policy';

type KindFilter='all'|'image'|'video'|'audio';
type SourceFilter='all'|'generated'|'uploaded'|'stock';
type ScopeFilter='channel'|'all';

function bytes(value:number){
  if(value<1024)return value+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}
function duration(value:number|null){
  if(value===null)return '—';
  const m=Math.floor(value/60);
  const s=Math.round(value%60).toString().padStart(2,'0');
  return m+':'+s;
}
function icon(kind:MediaLibraryItem['mediaKind']){
  if(kind==='image')return <ImageIcon size={16}/>;
  if(kind==='video')return <Film size={16}/>;
  return <FileAudio size={16}/>;
}
function normalizeTagInput(value:string){
  return normalizeMediaTags(value.split(','));
}

export default function MediaLibraryWorkspace({channel}:{channel:ManagedChannel}){
  const [items,setItems]=useState<MediaLibraryItem[]>([]);
  const [page,setPage]=useState(1);
  const [hasMore,setHasMore]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [query,setQuery]=useState('');
  const [scope,setScope]=useState<ScopeFilter>('channel');
  const [kind,setKind]=useState<KindFilter>('all');
  const [source,setSource]=useState<SourceFilter>('all');
  const [favoritesOnly,setFavoritesOnly]=useState(false);
  const [staleOnly,setStaleOnly]=useState(false);
  const [selected,setSelected]=useState<MediaLibraryItem|null>(null);
  const [tagInput,setTagInput]=useState('');
  const [notes,setNotes]=useState('');
  const [subjects,setSubjects]=useState('');
  const [locations,setLocations]=useState('');
  const [periods,setPeriods]=useState('');
  const [shotTypes,setShotTypes]=useState('');
  const [moods,setMoods]=useState('');
  const [visualAnalysis,setVisualAnalysis]=useState<VisualIntelligenceResult|null>(null);

  async function fetchPage(nextPage:number,append:boolean){
    if(!append)setLoading(true);
    setBusy('page');setMessage('');
    try{
      const params=new URLSearchParams({page:String(nextPage),limit:'60',scope});
      if(scope==='channel')params.set('channelId',channel.id);
      const res=await fetch('/api/media-library?'+params.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Media Library.');
      const incoming=(body.items??[]) as MediaLibraryItem[];
      setItems(prev=>append?[...prev,...incoming.filter(item=>!prev.some(existing=>existing.mediaKey===item.mediaKey))]:incoming);
      setPage(nextPage);
      setHasMore(!!body.hasMore);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Media Library.');}
    finally{setBusy('');setLoading(false);}
  }

  useEffect(()=>{void fetchPage(1,false);},[channel.id,scope]);

  const filtered=useMemo(()=>mediaLibrarySearch(items,{
    query,kind,source,favoritesOnly,staleOnly
  }),[items,query,kind,source,favoritesOnly,staleOnly]);

  async function loadVisualAnalysis(item:MediaLibraryItem){
    if(item.mediaKind!=='video'){setVisualAnalysis(null);return;}
    setBusy('vision-load');
    try{
      const res=await fetch('/api/visual-intelligence?assetId='+encodeURIComponent(item.resourceId),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Visual Intelligence.');
      setVisualAnalysis(body.analysis??null);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Visual Intelligence.');}
    finally{setBusy(current=>current==='vision-load'?'':current);}
  }

  async function analyzeVisual(item:MediaLibraryItem){
    setBusy('vision');setMessage('');
    try{
      const res=await fetch('/api/visual-intelligence',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'analyze',assetId:item.resourceId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao analisar os frames.');
      setVisualAnalysis(body.analysis??null);
      setMessage(body.message??'Análise visual concluída.');
      await fetchPage(1,false);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao analisar os frames.');}
    finally{setBusy('');}
  }

  function open(item:MediaLibraryItem){
    setSelected(item);
    setTagInput(item.tags.join(', '));
    setNotes(item.notes);
    setSubjects(item.semantic.subjects.join(', '));
    setLocations(item.semantic.locations.join(', '));
    setPeriods(item.semantic.periods.join(', '));
    setShotTypes(item.semantic.shotTypes.join(', '));
    setMoods(item.semantic.moods.join(', '));
    setVisualAnalysis(null);
    setMessage('');
    if(item.mediaKind==='video')void loadVisualAnalysis(item);
  }

  function patchItem(mediaKey:string,patch:Partial<MediaLibraryItem>){
    setItems(prev=>prev.map(item=>item.mediaKey===mediaKey?{...item,...patch}:item));
    setSelected(prev=>prev?.mediaKey===mediaKey?{...prev,...patch}:prev);
  }

  async function saveMetadata(item:MediaLibraryItem,nextFavorite=item.favorite){
    const tags=normalizeTagInput(tagInput);
    const semantic=normalizeMediaSemantic({
      subjects:subjects.split(','),
      locations:locations.split(','),
      periods:periods.split(','),
      shotTypes:shotTypes.split(','),
      moods:moods.split(',')
    });
    setBusy('metadata');setMessage('');
    try{
      const res=await fetch('/api/media-library',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'metadata',
          channelId:item.channelId,
          resourceType:item.resourceType,
          resourceId:item.resourceId,
          favorite:nextFavorite,
          tags,
          notes,
          semantic
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar metadados.');
      patchItem(item.mediaKey,{favorite:nextFavorite,tags,notes,semantic});
      setTagInput(tags.join(', '));
      setMessage(body.message??'Metadados salvos.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar metadados.');}
    finally{setBusy('');}
  }

  async function toggleFavorite(item:MediaLibraryItem){
    const previous=selected;
    if(previous?.mediaKey!==item.mediaKey)open(item);
    setBusy('favorite:'+item.mediaKey);
    try{
      const tags=previous?.mediaKey===item.mediaKey?normalizeTagInput(tagInput):item.tags;
      const itemNotes=previous?.mediaKey===item.mediaKey?notes:item.notes;
      const semantic=previous?.mediaKey===item.mediaKey
        ?normalizeMediaSemantic({
          subjects:subjects.split(','),
          locations:locations.split(','),
          periods:periods.split(','),
          shotTypes:shotTypes.split(','),
          moods:moods.split(',')
        })
        :item.semantic;
      const res=await fetch('/api/media-library',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'metadata',channelId:item.channelId,resourceType:item.resourceType,
          resourceId:item.resourceId,favorite:!item.favorite,tags,notes:itemNotes,semantic
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao atualizar favorito.');
      patchItem(item.mediaKey,{favorite:!item.favorite,tags,notes:itemNotes,semantic});
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao atualizar favorito.');}
    finally{setBusy('');}
  }

  if(loading)return <div className="media-library-loading"><Sparkles className="spin" size={20}/>Carregando Media Library…</div>;

  return <div className="media-library">
    {message&&<div className="media-library-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="media-library-hero">
      <div><span>{scope==='all'?'ASSET VAULT':'MEDIA LIBRARY'}</span><h2>{scope==='all'?'Acervo visual da operação inteira.':'Todo asset produzido pelo canal, em um só lugar.'}</h2><p>{scope==='all'?'Descubra mídia reutilizável entre canais por assunto, local, período, plano, atmosfera, origem e licença.':'Generated, stock e uploads externos permanecem pesquisáveis com origem, licença, cena, take, versão e estado de atualidade.'}</p></div>
      <div><strong>{items.length}</strong><small>carregados</small></div>
    </section>

    <section className="media-library-toolbar">
      <button className={scope==='channel'?'active':''} onClick={()=>setScope('channel')}>Canal atual</button>
      <button className={scope==='all'?'active':''} onClick={()=>setScope('all')}>Vault global</button>
      <label className="media-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, assunto, local, período, tag, provider…"/></label>
      <select value={kind} onChange={e=>setKind(e.target.value as KindFilter)}><option value="all">Todos os tipos</option><option value="image">Imagens</option><option value="video">Vídeos</option><option value="audio">Áudios</option></select>
      <select value={source} onChange={e=>setSource(e.target.value as SourceFilter)}><option value="all">Todas as origens</option><option value="generated">Generated</option><option value="uploaded">Upload</option><option value="stock">Stock</option></select>
      <button className={favoritesOnly?'active':''} onClick={()=>setFavoritesOnly(v=>!v)}><Heart size={14}/>Favoritos</button>
      <button className={staleOnly?'active':''} onClick={()=>setStaleOnly(v=>!v)}><AlertTriangle size={14}/>Stale</button>
    </section>

    <div className="media-library-count">{filtered.length} resultado(s) nos assets carregados.</div>

    <section className="media-library-grid">{filtered.map(item=><article key={item.mediaKey} className={item.stale?'stale':''}>
      <button className="media-card-preview" onClick={()=>open(item)}>
        {item.mediaKind==='image'&&item.signedUrl?<img src={item.signedUrl} alt=""/>:
         item.mediaKind==='video'&&item.signedUrl?<video src={item.signedUrl} muted preload="metadata"/>:
         <div className="media-audio-placeholder"><FileAudio size={29}/><span>{item.voiceTake?'TAKE '+item.voiceTake:'AUDIO'}</span></div>}
        {item.stale&&<em><AlertTriangle size={12}/>STALE</em>}
        {item.selected&&<b>ATIVO</b>}
      </button>
      <div className="media-card-body">
        <div className="media-card-type">{icon(item.mediaKind)}<span>{item.mediaKind}</span><span>{item.sourceType}</span>{item.provider&&<span>{item.provider}</span>}{scope==='all'&&item.channelName&&<span>{item.channelName}</span>}</div>
        <strong title={item.title}>{item.title}</strong>
        <small>{bytes(item.bytes)}{item.durationSeconds!==null?' · '+duration(item.durationSeconds):''}{item.width&&item.height?' · '+item.width+'×'+item.height:''}</small>
        <div className="media-card-tags">{item.tags.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>
      </div>
      <div className="media-card-actions"><button className={item.favorite?'favorite':''} disabled={busy==='favorite:'+item.mediaKey} onClick={()=>void toggleFavorite(item)} aria-label="Favoritar"><Heart size={15} fill={item.favorite?'currentColor':'none'}/></button><button onClick={()=>open(item)}>Detalhes</button></div>
    </article>)}</section>

    {!filtered.length&&<div className="media-library-empty"><Library size={28}/><h3>Nenhuma mídia neste filtro.</h3><p>Os arquivos continuam preservados; ajuste a busca ou os filtros.</p></div>}

    {hasMore&&<button className="button subtle media-load-more" disabled={busy==='page'} onClick={()=>void fetchPage(page+1,true)}>{busy==='page'?'Carregando…':'Carregar mais assets'}</button>}

    {selected&&<div className="media-library-detail-backdrop" onClick={()=>setSelected(null)}>
      <aside className="media-library-detail" onClick={e=>e.stopPropagation()}>
        <header><div>{icon(selected.mediaKind)}<div><span>{selected.mediaKind} · {selected.sourceType}</span><h3>{selected.title}</h3></div></div><button onClick={()=>setSelected(null)}><X size={18}/></button></header>

        <div className="media-detail-preview">
          {selected.mediaKind==='image'&&selected.signedUrl?<img src={selected.signedUrl} alt=""/>:
           selected.mediaKind==='video'&&selected.signedUrl?<video controls src={selected.signedUrl}/>:
           selected.signedUrl?<audio controls src={selected.signedUrl}/>:
           <div>Preview temporariamente indisponível.</div>}
        </div>

        <section className="media-detail-status">
          <span className={selected.stale?'warn':'ok'}>{selected.stale?<><AlertTriangle size={13}/>Stale</>:<><CheckCircle2 size={13}/>Atual</>}</span>
          {selected.selected&&<span className="ok">Selecionado no pipeline</span>}
          {selected.provider&&<span>{selected.provider}</span>}
          <span>{bytes(selected.bytes)}</span>
        </section>

        <section className="media-detail-grid">
          {selected.timecodeLabel&&<Info label="Timecode" value={selected.timecodeLabel}/>}
          {selected.variant&&<Info label="Variante" value={'v'+selected.variant}/>}
          {selected.voiceTake&&<Info label="Voice take" value={String(selected.voiceTake)}/>}
          {selected.durationSeconds!==null&&<Info label="Duração" value={duration(selected.durationSeconds)}/>}
          {selected.width&&selected.height&&<Info label="Dimensão" value={selected.width+'×'+selected.height}/>}
          <Info label="MIME" value={selected.mimeType}/>
          {selected.channelName&&<Info label="Canal de origem" value={selected.channelName}/>}
        </section>

        {selected.license&&<section className="media-detail-license"><span>LICENÇA / PROVENIÊNCIA</span><strong>{selected.license.label}</strong><p>{selected.license.type}{selected.stock?' · '+selected.stock.attributionLabel:''}</p>{selected.stock?.creatorName&&<small>Creator: {selected.stock.creatorName}</small>}</section>}

        {selected.prompt&&<section className="media-detail-prompt"><span>PROMPT DE ORIGEM</span><p>{selected.prompt}</p></section>}

        {selected.mediaKind==='video'&&<section className="media-vision-panel">
          <div className="media-vision-head">
            <div><span>VISUAL INTELLIGENCE</span><strong>{visualAnalysis?.assetTitle||'Reconhecimento de frames e trechos'}</strong></div>
            <button className="button subtle small" disabled={busy==='vision'||busy==='vision-load'} onClick={()=>void analyzeVisual(selected)}><ScanSearch size={15}/>{busy==='vision'?'Analisando…':visualAnalysis?.status==='completed'?'Reanalisar frames':'Analisar frames'}</button>
          </div>
          {busy==='vision-load'?<p>Carregando análise…</p>:
           visualAnalysis?.status==='failed'?<p className="warn">{visualAnalysis.error??'A análise anterior falhou.'}</p>:
           visualAnalysis?.status==='completed'?<>
            <div className="media-vision-summary"><span>{visualAnalysis.segments.length} segmento(s)</span><span>{visualAnalysis.model.replace('models/','')}</span>{visualAnalysis.analyzedAt&&<span>{new Date(visualAnalysis.analyzedAt).toLocaleString('pt-BR')}</span>}</div>
            <div className="media-vision-segments">{visualAnalysis.segments.map(segment=><article key={segment.id}>
              <header><strong>{segment.sequence}. {segment.title}</strong><b>{duration(segment.startSeconds)} → {duration(segment.endSeconds)}</b></header>
              <p>{segment.summary}</p>
              <div>{[
                ...segment.semantic.landmarks,...segment.semantic.locations,...segment.semantic.activities,
                ...segment.semantic.subjects,...segment.semantic.timeOfDay,...segment.semantic.shotTypes
              ].slice(0,10).map(value=><span key={value}>{value}</span>)}</div>
              <small>Confiança {(segment.confidence*100).toFixed(0)}% · keyframe {duration(segment.keyframeSeconds)}</small>
            </article>)}</div>
           </>:<p>Analisa mudanças de cena e keyframes para descobrir o que existe dentro do vídeo e em qual intervalo. O arquivo original permanece intacto no R2.</p>}
        </section>}

        <label className="media-detail-field"><span><Tag size={13}/>TAGS</span><input value={tagInput} onChange={e=>setTagInput(e.target.value)} placeholder="história, cidade, nostalgia"/></label>
        <label className="media-detail-field"><span>ASSUNTOS / ENTIDADES</span><input value={subjects} onChange={e=>setSubjects(e.target.value)} placeholder="times square, skyline, shopping mall"/></label>
        <label className="media-detail-field"><span>LOCAIS</span><input value={locations} onChange={e=>setLocations(e.target.value)} placeholder="new york, manhattan"/></label>
        <label className="media-detail-field"><span>PERÍODOS</span><input value={periods} onChange={e=>setPeriods(e.target.value)} placeholder="1940s, 1970s, 2026"/></label>
        <label className="media-detail-field"><span>TIPOS DE PLANO</span><input value={shotTypes} onChange={e=>setShotTypes(e.target.value)} placeholder="aerial, street-level, close-up"/></label>
        <label className="media-detail-field"><span>ATMOSFERA / MOOD</span><input value={moods} onChange={e=>setMoods(e.target.value)} placeholder="nostalgic, tense, optimistic"/></label>
        <label className="media-detail-field"><span>NOTAS</span><textarea rows={5} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observações para reutilização futura."/></label>

        <div className="media-detail-actions">
          <button className={selected.favorite?'button subtle favorite':'button subtle'} disabled={busy==='metadata'} onClick={()=>void saveMetadata(selected,!selected.favorite)}><Heart size={15} fill={selected.favorite?'currentColor':'none'}/>{selected.favorite?'Remover favorito':'Favoritar'}</button>
          <button className="button primary" disabled={busy==='metadata'} onClick={()=>void saveMetadata(selected)}>{busy==='metadata'?'Salvando…':'Salvar metadados'}</button>
        </div>
      </aside>
    </div>}
  </div>;
}

function Info({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>;}

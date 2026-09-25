'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ExternalLink, Film, Image as ImageIcon, Search, Sparkles
} from 'lucide-react';
import type {
  ManagedChannel, ScenePlan, StockMediaProvider, StockMediaResult, VisualPromptSet
} from '@/lib/types';

export default function StockMediaWorkspace({channel}:{channel:ManagedChannel}){
  const [sets,setSets]=useState<VisualPromptSet[]>([]);
  const [setId,setSetId]=useState('');
  const [promptSet,setPromptSet]=useState<VisualPromptSet|null>(null);
  const [plan,setPlan]=useState<ScenePlan|null>(null);
  const [sceneId,setSceneId]=useState('');
  const [provider,setProvider]=useState<StockMediaProvider>('pexels');
  const [kind,setKind]=useState<'image'|'video'>('image');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<StockMediaResult[]>([]);
  const [rate,setRate]=useState<{remaining:string|null;reset:string|null}|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const selectedScene=useMemo(()=>promptSet?.scenePrompts.find(item=>item.sceneId===sceneId)??null,[promptSet,sceneId]);

  async function openSet(id:string){
    if(!id){setPromptSet(null);setPlan(null);setSceneId('');return;}
    setBusy('open');setMessage('');setResults([]);
    try{
      const res=await fetch('/api/visual-prompt-engine?setId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir prompts.');
      setSetId(id);setPromptSet(body.promptSet??null);setPlan(body.scenePlan??null);
      const first=body.promptSet?.scenePrompts?.[0];
      setSceneId(first?.sceneId??'');
      setQuery(String(first?.direction??'').slice(0,100));
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Stock Media.');}
    finally{setBusy('');}
  }

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar prompts visuais.');
      const approved=(body.promptSets??[]).filter((item:VisualPromptSet)=>item.status==='approved');
      setSets(approved);
      if(approved[0])await openSet(approved[0].id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Stock Media.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  function chooseScene(id:string){
    setSceneId(id);setResults([]);setRate(null);
    const item=promptSet?.scenePrompts.find(scene=>scene.sceneId===id);
    setQuery(String(item?.direction??'').slice(0,100));
  }

  async function search(){
    if(!promptSet||!sceneId||!query.trim())return;
    setBusy('search');setMessage('');
    try{
      const params=new URLSearchParams({
        promptSetId:promptSet.id,sceneId,provider,kind,q:query.trim()
      });
      const res=await fetch('/api/stock-media?'+params,{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao pesquisar stock media.');
      setResults(body.results??[]);setRate(body.rateLimit??null);
      setMessage((body.results??[]).length+' resultado(s) encontrados.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao pesquisar stock media.');}
    finally{setBusy('');}
  }

  async function use(result:StockMediaResult){
    if(!promptSet||!sceneId)return;
    setBusy('import:'+result.providerAssetId);setMessage('');
    try{
      const res=await fetch('/api/stock-media',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'import',
          promptSetId:promptSet.id,
          sceneId,
          provider:result.provider,
          kind:result.kind,
          providerAssetId:result.providerAssetId
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao importar stock media.');
      setMessage(body.message??'Stock media importado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao importar stock media.');}
    finally{setBusy('');}
  }

  if(loading)return <div className="stock-media-loading"><Sparkles className="spin" size={20}/>Carregando Stock Media…</div>;

  if(!sets.length)return <div className="stock-media-engine">
    <section className="stock-media-hero"><div><span>STOCK MEDIA ENGINE</span><h2>Nenhum prompt visual aprovado.</h2><p>A busca stock começa somente depois da aprovação dos prompts de cena.</p></div></section>
  </div>;

  return <div className="stock-media-engine">
    {message&&<div className="stock-media-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="stock-media-hero"><div><span>STOCK MEDIA ENGINE</span><h2>Busque mídia pronta sem perder origem e licença.</h2><p>Resultados são apenas previews. Ao escolher um item, o servidor revalida o ID e copia o arquivo para nosso storage privado.</p></div></section>

    <section className="stock-search-controls">
      <div className="stock-search-row">
        <label><span>PROMPT SET</span><select value={setId} onChange={e=>void openSet(e.target.value)}>{sets.map(item=><option key={item.id} value={item.id}>{item.scenePrompts.length} cenas · v{item.version}</option>)}</select></label>
        <label><span>CENA</span><select value={sceneId} onChange={e=>chooseScene(e.target.value)}>{promptSet?.scenePrompts.map(scene=><option key={scene.sceneId} value={scene.sceneId}>{scene.timecodeLabel} · Scene {scene.sequence}</option>)}</select></label>
        <label><span>PROVIDER</span><select value={provider} onChange={e=>{const next=e.target.value as StockMediaProvider;setProvider(next);if(next==='unsplash')setKind('image');setResults([]);}}><option value="pexels">Pexels</option><option value="pixabay">Pixabay</option><option value="unsplash">Unsplash</option><option value="vecteezy">Vecteezy</option></select></label>
        <label><span>TIPO</span><select value={kind} onChange={e=>{setKind(e.target.value as 'image'|'video');setResults([]);}}><option value="image">Imagem</option><option value="video" disabled={provider==='unsplash'}>Vídeo</option></select></label>
      </div>
      <div className="stock-query"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value.slice(0,100))} onKeyDown={e=>{if(e.key==='Enter')void search();}} placeholder="Ex.: prehistoric cave, counting stones"/><button className="button primary" disabled={!query.trim()||!!busy} onClick={()=>void search()}>{busy==='search'?'Buscando…':'Buscar'}</button></div>
      {selectedScene&&<details><summary>Direção da cena</summary><p>{selectedScene.direction}</p></details>}
    </section>

    {results.length>0&&<section className="stock-results">
      <div className="stock-results-head"><div><strong>{results.length} resultados</strong><small>{provider==='pexels'?'Media provided by Pexels':provider==='pixabay'?'Media provided by Pixabay':provider==='vecteezy'?'Photos and videos provided by Vecteezy':'Photos provided by Unsplash'}</small></div>{rate?.remaining&&<span>API remaining: {rate.remaining}</span>}</div>
      <div className="stock-results-grid">{results.map(result=><article key={result.provider+'-'+result.providerAssetId}>
        <div className="stock-preview">
          <img src={result.previewUrl} alt={result.title}/>
          <span>{result.kind==='image'?<ImageIcon size={14}/>:<Film size={14}/>} {result.kind}</span>
        </div>
        <div className="stock-result-copy"><h3>{result.title}</h3><p>{result.attributionLabel}</p><div>{result.width&&result.height&&<span>{result.width}×{result.height}</span>}{result.durationSeconds!==null&&<span>{result.durationSeconds}s</span>}<span>{result.licenseLabel}</span></div></div>
        <footer><a href={result.pageUrl} target="_blank" rel="noreferrer">Fonte <ExternalLink size={12}/></a>{result.provider==='unsplash'?<span className="tag">Preview / hotlink</span>:<button className="button primary small" disabled={!!busy} onClick={()=>void use(result)}>{busy==='import:'+result.providerAssetId?'Importando…':'Usar nesta cena'}</button>}</footer>
      </article>)}</div>
      <div className="stock-attribution"><a href={provider==='pexels'?'https://www.pexels.com':provider==='pixabay'?'https://pixabay.com':provider==='vecteezy'?'https://www.vecteezy.com':'https://unsplash.com'} target="_blank" rel="noreferrer">{provider==='pexels'?'Photos and videos provided by Pexels':provider==='pixabay'?'Images and videos provided by Pixabay':provider==='vecteezy'?'Photos and videos provided by Vecteezy':'Photos provided by Unsplash'} <ExternalLink size={12}/></a>{provider==='unsplash'&&<small> Nesta fase o Unsplash funciona como descoberta visual com hotlink e atribuição; cópia para o Asset Vault permanece bloqueada.</small>}{provider==='vecteezy'&&<small> A busca prioriza conteúdo não gerado por IA; licença e atribuição são registradas no download.</small>}</div>
    </section>}

    {!results.length&&<div className="stock-empty"><Search size={28}/><h3>Escolha a cena e pesquise.</h3><p>A direção visual já é usada como sugestão inicial de busca, mas pode ser simplificada antes da pesquisa.</p></div>}
  </div>;
}

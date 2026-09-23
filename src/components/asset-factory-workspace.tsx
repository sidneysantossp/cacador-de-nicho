'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, CircleAlert, Clapperboard, Image as ImageIcon, Play,
  RefreshCw, Sparkles, Trash2, Upload, WandSparkles
} from 'lucide-react';
import type {
  ManagedChannel, ProductionDNA, SceneAsset, ScenePlan, VisualPromptSet
} from '@/lib/types';

type AssetView=SceneAsset&{signedUrl:string|null;stale:boolean};

function bytes(value:number){
  if(value<1024)return value+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}

export default function AssetFactoryWorkspace({channel}:{channel:ManagedChannel}){
  const [sets,setSets]=useState<VisualPromptSet[]>([]);
  const [setId,setSetId]=useState('');
  const [promptSet,setPromptSet]=useState<VisualPromptSet|null>(null);
  const [plan,setPlan]=useState<ScenePlan|null>(null);
  const [dna,setDna]=useState<ProductionDNA|null>(null);
  const [assets,setAssets]=useState<AssetView[]>([]);
  const [imageModel,setImageModel]=useState<'gemini-3.1-flash-image'|'gemini-3.1-flash-lite-image'|'gemini-3-pro-image'>('gemini-3.1-flash-image');
  const [imageSize,setImageSize]=useState<'1K'|'2K'|'4K'>('2K');
  const [videoModel,setVideoModel]=useState<'veo-3.1-generate-preview'|'veo-3.1-fast-generate-preview'|'veo-3.1-lite-generate-preview'>('veo-3.1-fast-generate-preview');
  const [resolution,setResolution]=useState<'720p'|'1080p'|'4k'>('720p');
  const [videoDuration,setVideoDuration]=useState<4|6|8>(4);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const byScene=useMemo(()=>{
    const map=new Map<string,AssetView[]>();
    for(const asset of assets){
      const list=map.get(asset.sceneId)??[];
      list.push(asset);
      map.set(asset.sceneId,list);
    }
    for(const list of map.values())list.sort((a,b)=>b.variant-a.variant);
    return map;
  },[assets]);

  async function reloadAssets(id=setId){
    if(!id){setAssets([]);return;}
    const res=await fetch('/api/asset-factory?promptSetId='+encodeURIComponent(id),{cache:'no-store'});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.message??'Falha ao carregar assets.');
    setAssets(body.assets??[]);
  }

  async function openSet(id:string){
    if(!id){setPromptSet(null);setPlan(null);setDna(null);setAssets([]);return;}
    setBusy('open');setMessage('');
    try{
      const [setRes,assetsRes]=await Promise.all([
        fetch('/api/visual-prompt-engine?setId='+encodeURIComponent(id),{cache:'no-store'}),
        fetch('/api/asset-factory?promptSetId='+encodeURIComponent(id),{cache:'no-store'})
      ]);
      const setBody=await setRes.json().catch(()=>({}));
      const assetsBody=await assetsRes.json().catch(()=>({}));
      if(!setRes.ok)throw new Error(setBody.message??'Falha ao abrir prompts.');
      if(!assetsRes.ok)throw new Error(assetsBody.message??'Falha ao carregar assets.');
      setSetId(id);
      setPromptSet(setBody.promptSet??null);
      setPlan(setBody.scenePlan??null);
      setDna(setBody.productionDna??null);
      setAssets(assetsBody.assets??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Asset Factory.');}
    finally{setBusy('');}
  }

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Visual Prompt Sets.');
      const approved=(body.promptSets??[]).filter((item:VisualPromptSet)=>item.status==='approved');
      setSets(approved);
      if(approved[0])await openSet(approved[0].id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Asset Factory.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  async function action(sceneId:string,action:'generateImage'|'startVideo'){
    if(!promptSet)return;
    setBusy(action+':'+sceneId);setMessage('');
    try{
      const body=action==='generateImage'
        ?{action,promptSetId:promptSet.id,sceneId,modelId:imageModel,imageSize}
        :{action,promptSetId:promptSet.id,sceneId,modelId:videoModel,resolution,durationSeconds:videoDuration};
      const res=await fetch('/api/asset-factory',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha no Asset Factory.');
      setAssets(result.assets??assets);
      setMessage(result.message??'Asset Factory atualizado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha no Asset Factory.');}
    finally{setBusy('');}
  }

  async function upload(sceneId:string,file:File|null){
    if(!promptSet||!file)return;
    setBusy('upload:'+sceneId);setMessage('');
    try{
      const form=new FormData();
      form.set('promptSetId',promptSet.id);
      form.set('sceneId',sceneId);
      form.set('licenseType','owned');
      form.set('file',file);
      const res=await fetch('/api/asset-factory',{method:'POST',body:form});
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha ao enviar asset.');
      setAssets(result.assets??[]);
      setMessage(result.message??'Asset enviado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao enviar asset.');}
    finally{setBusy('');}
  }

  async function assetAction(action:'refreshVideo'|'select'|'delete',asset:AssetView){
    setBusy(action+':'+asset.id);setMessage('');
    try{
      const res=await fetch('/api/asset-factory',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,assetId:asset.id})
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha ao atualizar variante.');
      await reloadAssets(asset.visualPromptSetId);
      setMessage(result.message??'Variante atualizada.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao atualizar variante.');}
    finally{setBusy('');}
  }

  if(loading)return <div className="asset-factory-loading"><Sparkles className="spin" size={20}/>Carregando Asset Factory…</div>;

  if(!sets.length)return <div className="asset-factory">
    {message&&<div className="asset-factory-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="asset-factory-hero"><div><span>ASSET FACTORY</span><h2>Nenhum prompt visual aprovado.</h2><p>Aprove um Visual Prompt Set antes de gerar ou importar assets.</p></div></section>
  </div>;

  return <div className="asset-factory">
    {message&&<div className="asset-factory-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="asset-factory-hero">
      <div><span>ASSET FACTORY</span><h2>Uma cena, várias variantes, uma escolha ativa.</h2><p>Gere internamente, envie um arquivo externo e preserve todas as versões. O timecode e o prompt aprovado continuam sendo a origem canônica.</p></div>
      <div><strong>{assets.filter(item=>item.status==='ready').length}</strong><small>assets ready</small></div>
    </section>

    <section className="asset-factory-controls">
      <label><span>PROMPT SET APROVADO</span><select value={setId} onChange={e=>void openSet(e.target.value)}>{sets.map(item=><option key={item.id} value={item.id}>{item.scenePrompts.length} cenas · v{item.version}</option>)}</select></label>
      <div className="asset-factory-models">
        <label>Imagem<select value={imageModel} onChange={e=>setImageModel(e.target.value as typeof imageModel)}><option value="gemini-3.1-flash-image">Nano Banana 2</option><option value="gemini-3.1-flash-lite-image">Nano Banana 2 Lite</option><option value="gemini-3-pro-image">Nano Banana Pro</option></select></label>
        <label>Size<select value={imageSize} onChange={e=>setImageSize(e.target.value as typeof imageSize)}><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></label>
        <label>Vídeo<select value={videoModel} onChange={e=>setVideoModel(e.target.value as typeof videoModel)}><option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option><option value="veo-3.1-generate-preview">Veo 3.1</option><option value="veo-3.1-lite-generate-preview">Veo 3.1 Lite</option></select></label>
        <label>Resolução<select value={resolution} onChange={e=>{const next=e.target.value as typeof resolution;setResolution(next);if(next!=='720p')setVideoDuration(8);}}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option></select></label>
        <label>Duração<select value={videoDuration} disabled={resolution!=='720p'} onChange={e=>setVideoDuration(Number(e.target.value) as 4|6|8)}><option value={4}>4s</option><option value={6}>6s</option><option value={8}>8s</option></select></label>
      </div>
    </section>

    {promptSet&&plan&&<section className="asset-scene-list">
      {promptSet.scenePrompts.map(prompt=>{
        const scene=plan.scenes.find(item=>item.id===prompt.sceneId);
        const variants=byScene.get(prompt.sceneId)??[];
        const ready=variants.filter(item=>item.status==='ready');
        return <article className="asset-scene-card" key={prompt.sceneId}>
          <header>
            <div><span>{prompt.timecodeLabel}</span><strong>SCENE {String(prompt.sequence).padStart(3,'0')}</strong><small>{scene?.assetMode??'image'} · {scene?scene.durationSeconds.toFixed(2)+'s':''}</small></div>
            <div className="asset-scene-actions">
              <button className="button subtle small" disabled={!!busy} onClick={()=>void action(prompt.sceneId,'generateImage')}><ImageIcon size={14}/>{busy==='generateImage:'+prompt.sceneId?'Gerando…':'Gerar imagem'}</button>
              <button className="button subtle small" disabled={!!busy} onClick={()=>void action(prompt.sceneId,'startVideo')}><Clapperboard size={14}/>{busy==='startVideo:'+prompt.sceneId?'Iniciando…':'Gerar vídeo'}</button>
              <label className="asset-upload-button"><Upload size={14}/><span>{busy==='upload:'+prompt.sceneId?'Enviando…':'Upload'}</span><input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" disabled={!!busy} onChange={e=>void upload(prompt.sceneId,e.target.files?.[0]??null)}/></label>
            </div>
          </header>

          <details className="asset-prompt"><summary>Prompt aprovado</summary><p>{prompt.prompt}</p></details>

          {!variants.length&&<div className="asset-empty-scene">Nenhuma variante criada para esta cena.</div>}

          <div className="asset-variant-grid">{variants.map(asset=><section className={'asset-variant '+(asset.selected?'selected':'')} key={asset.id}>
            <div className="asset-preview">
              {asset.status==='ready'&&asset.signedUrl&&asset.assetKind==='image'&&<img src={asset.signedUrl} alt={'Variant '+asset.variant}/>}
              {asset.status==='ready'&&asset.signedUrl&&asset.assetKind==='video'&&<video controls preload="metadata" src={asset.signedUrl}/>}
              {asset.status==='processing'&&<div className="asset-processing"><RefreshCw className="spin" size={22}/><span>Processando</span></div>}
              {asset.status==='failed'&&<div className="asset-failed"><CircleAlert size={22}/><span>Falhou</span></div>}
            </div>
            <div className="asset-variant-head"><strong>VAR {String(asset.variant).padStart(2,'0')}</strong>{asset.selected&&<em>ATIVA</em>}{asset.stale&&<span>STALE</span>}</div>
            <div className="asset-meta">
              <span>{asset.sourceType}</span><span>{asset.provider??'external'}</span>{asset.modelId&&<span>{asset.modelId}</span>}<span>{asset.bytes?bytes(asset.bytes):'—'}</span>
            </div>
            <div className="asset-license"><small>{asset.license.label}</small>{asset.costUsd!==null&&<small>US$ {asset.costUsd.toFixed(4)}</small>}</div>
            {asset.error&&<div className="asset-error">{asset.error}</div>}
            <div className="asset-variant-actions">
              {asset.status==='processing'&&asset.assetKind==='video'&&<button className="button subtle small" disabled={!!busy} onClick={()=>void assetAction('refreshVideo',asset)}><RefreshCw size={13}/>Atualizar status</button>}
              {asset.status==='ready'&&!asset.selected&&<button className="button subtle small" disabled={!!busy} onClick={()=>void assetAction('select',asset)}><CheckCircle2 size={13}/>Usar variante</button>}
              <button className="icon-button danger" aria-label="Excluir variante" disabled={!!busy} onClick={()=>void assetAction('delete',asset)}><Trash2 size={14}/></button>
            </div>
          </section>)}</div>

          <footer><span>{ready.length} ready</span><span>{variants.length} variante(s)</span><span>{dna?.format.aspectRatio??'—'}</span></footer>
        </article>;
      })}
    </section>}
  </div>;
}

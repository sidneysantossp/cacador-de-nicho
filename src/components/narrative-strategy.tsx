'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Layers3, Plus, Route, Sparkles, Workflow } from 'lucide-react';
import type { ChannelBrain, ChannelConcept, ChannelEpisode, ContentArc, ManagedChannel, NarrativeBundle } from '@/lib/types';
import { conceptPrerequisitesMet, episodeNarrativeReadiness, narrativeProgress, nextNarrativeConcepts } from '@/lib/narrative-policy';

const emptyBundle: NarrativeBundle={arcs:[],episodes:[],concepts:[]};
const conceptStatuses:Record<ChannelConcept['status'],string>={unknown:'Desconhecido',introduced:'Introduzido',partial:'Parcial',established:'Estabelecido',retired:'Retirado'};
const episodeStatuses:Record<ChannelEpisode['status'],string>={idea:'Ideia',planned:'Planejado',scripted:'Roteirizado',producing:'Produção',published:'Publicado',archived:'Arquivado'};
const arcStatuses:Record<ContentArc['status'],string>={planned:'Planejado',active:'Ativo',completed:'Concluído',paused:'Pausado'};

function parseLines(value:string){return value.split('\n').map(x=>x.trim()).filter(Boolean);}
function slug(value:string){return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);}

export default function NarrativeStrategy({channel,brain}:{channel:ManagedChannel;brain:ChannelBrain|null}){
  const [bundle,setBundle]=useState<NarrativeBundle>(emptyBundle);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [showArc,setShowArc]=useState(false);
  const [showEpisode,setShowEpisode]=useState(false);
  const [showConcept,setShowConcept]=useState(false);
  const [arcName,setArcName]=useState('');
  const [arcObjective,setArcObjective]=useState('');
  const [arcTargets,setArcTargets]=useState('');
  const [episodeTitle,setEpisodeTitle]=useState('');
  const [episodeThesis,setEpisodeThesis]=useState('');
  const [episodeArc,setEpisodeArc]=useState('');
  const [episodePrereqs,setEpisodePrereqs]=useState('');
  const [episodeIntroduces,setEpisodeIntroduces]=useState('');
  const [episodeRepetition,setEpisodeRepetition]=useState('');
  const [conceptLabel,setConceptLabel]=useState('');
  const [conceptKey,setConceptKey]=useState('');
  const [conceptDescription,setConceptDescription]=useState('');
  const [conceptPrereqs,setConceptPrereqs]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    void fetch(`/api/narrative?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'})
      .then(async res=>{const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.message??'Falha ao carregar progressão narrativa.');if(!cancelled)setBundle(body);})
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Falha ao carregar progressão narrativa.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[channel.id]);

  const progress=useMemo(()=>narrativeProgress(bundle.concepts),[bundle.concepts]);
  const next=useMemo(()=>nextNarrativeConcepts(bundle.concepts).slice(0,8),[bundle.concepts]);
  const episodesByArc=useMemo(()=>{
    const map=new Map<string,ChannelEpisode[]>();
    for(const episode of bundle.episodes){
      const key=episode.arcId??'unassigned';
      map.set(key,[...(map.get(key)??[]),episode]);
    }
    return map;
  },[bundle.episodes]);

  async function save(payload:unknown,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/narrative',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar progressão narrativa.');
      setBundle(body.bundle);
      setMessage(body.message??'Narrativa atualizada.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar progressão narrativa.');return false;}
    finally{setBusy('');}
  }

  async function createArc(){
    const name=arcName.trim();if(!name)return;
    const now=new Date().toISOString();
    const arc:ContentArc={
      id:crypto.randomUUID(),channelId:channel.id,sequence:bundle.arcs.length+1,status:bundle.arcs.length?'planned':'active',
      name,objective:arcObjective.trim(),premise:'',prerequisiteConcepts:[],targetConcepts:parseLines(arcTargets),notes:[],createdAt:now,updatedAt:now
    };
    if(await save({action:'arc',arc},'arc')){setArcName('');setArcObjective('');setArcTargets('');setShowArc(false);}
  }

  async function createEpisode(){
    const title=episodeTitle.trim();if(!title)return;
    const now=new Date().toISOString();
    const episode:ChannelEpisode={
      id:crypto.randomUUID(),channelId:channel.id,arcId:episodeArc||undefined,sequence:bundle.episodes.length+1,status:'idea',
      title,thesis:episodeThesis.trim(),narrativeSummary:'',prerequisiteConcepts:parseLines(episodePrereqs),introducesConcepts:parseLines(episodeIntroduces),
      reinforcesConcepts:[],opensThreads:[],resolvesThreads:[],repetitionKeys:parseLines(episodeRepetition),createdAt:now,updatedAt:now
    };
    if(await save({action:'episode',episode},'episode')){setEpisodeTitle('');setEpisodeThesis('');setEpisodeArc('');setEpisodePrereqs('');setEpisodeIntroduces('');setEpisodeRepetition('');setShowEpisode(false);}
  }

  async function createConcept(){
    const label=conceptLabel.trim();const key=(conceptKey.trim()||slug(label));if(!label||!key)return;
    const now=new Date().toISOString();
    const concept:ChannelConcept={id:crypto.randomUUID(),channelId:channel.id,key,label,description:conceptDescription.trim(),status:'unknown',prerequisiteKeys:parseLines(conceptPrereqs),createdAt:now,updatedAt:now};
    if(await save({action:'concept',concept},'concept')){setConceptLabel('');setConceptKey('');setConceptDescription('');setConceptPrereqs('');setShowConcept(false);}
  }

  async function updateConcept(item:ChannelConcept,status:ChannelConcept['status']){
    await save({action:'concept',concept:{...item,status,updatedAt:new Date().toISOString()}},`concept:${item.id}`);
  }
  async function updateEpisode(item:ChannelEpisode,status:ChannelEpisode['status']){
    await save({action:'episode',episode:{...item,status,updatedAt:new Date().toISOString()}},`episode:${item.id}`);
  }
  async function updateArc(item:ContentArc,status:ContentArc['status']){
    await save({action:'arc',arc:{...item,status,updatedAt:new Date().toISOString()}},`arc:${item.id}`);
  }

  if(loading)return <div className="narrative-loading"><Sparkles className="spin" size={20}/>Carregando progressão narrativa…</div>;

  return <div className="narrative-os">
    {message&&<div className="narrative-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="narrative-command">
      <div><span>NARRATIVE INTELLIGENCE</span><h2>What should happen next?</h2><p>O próximo episódio deve respeitar o que este canal já estabeleceu. Mercado e audiência entrarão depois; aqui a pergunta é: <strong>o que faz sentido narrativamente agora?</strong></p></div>
      <div className="narrative-progress">
        <strong>{progress.established}/{progress.total}</strong><small>conceitos estabelecidos</small>
        <div><span style={{width:`${progress.progressPct}%`}}/></div>
        <em>{progress.active} em aprendizado · {progress.unknown} desconhecidos</em>
      </div>
    </section>

    <section className="narrative-dimensions">
      <article><span>NARRATIVE FIT</span><strong>${next.filter(concept=>concept.status!=='unknown'||conceptPrerequisitesMet(concept,bundle.concepts).ready).length}</strong><small>conceito(s) narrativamente utilizáveis agora</small></article>
      <article><span>MARKET SIGNAL</span><strong>{channel.opportunityId?'VINCULADO':'PENDENTE'}</strong><small>{channel.opportunityId?'Canal nasceu de uma oportunidade registrada.':'Será alimentado por Intelligence OS / Opportunities.'}</small></article>
      <article><span>AUDIENCE DEMAND</span><strong>SEM DADO</strong><small>Será alimentado pelo YouTube OAuth + Audience Intelligence. Não inferimos demanda sem evidência.</small></article>
      <article><span>REPETITION RISK</span><strong>{brain?.narrative.doNotRepeat.length??0}</strong><small>bloqueio(s) explícito(s) registrados no Brain</small></article>
    </section>

    <section className="narrative-next-grid">
      {next.length?next.map((concept,index)=>{
        const readiness=conceptPrerequisitesMet(concept,bundle.concepts);
        return <article key={concept.id} className={readiness.ready?'ready':'blocked'}>
          <span>{String(index+1).padStart(2,'0')}</span>
          <div><strong>{concept.label}</strong><small>{concept.status==='unknown'?(readiness.ready?'Pronto para introduzir':`Bloqueado por: ${readiness.missing.join(', ')}`):`Continuar evolução: ${conceptStatuses[concept.status]}`}</small></div>
          {readiness.ready?<CheckCircle2 size={17}/>:<CircleAlert size={17}/>}
        </article>;
      }):<div className="narrative-empty">Crie o Concept Graph para o sistema começar a ordenar a progressão.</div>}
    </section>

    {brain?.narrative.openThreads.length?<section className="narrative-open-threads"><span>OPEN THREADS DO BRAIN</span><div>{brain.narrative.openThreads.map(thread=><em key={thread}>{thread}</em>)}</div></section>:null}

    <div className="narrative-section-head"><div><span>CONTENT ARCS</span><h2>Progressão maior que um vídeo.</h2></div><button className="button subtle" onClick={()=>setShowArc(v=>!v)}><Plus size={15}/>Novo arco</button></div>
    {showArc&&<section className="narrative-form"><label>Nome do arco<input value={arcName} onChange={e=>setArcName(e.target.value)} placeholder="Ex.: Foundations of Money"/></label><label>Objetivo<textarea rows={3} value={arcObjective} onChange={e=>setArcObjective(e.target.value)} placeholder="O que o público/personagem deve entender ao fim deste arco?"/></label><label>Conceitos alvo <small>Uma key por linha.</small><textarea rows={4} value={arcTargets} onChange={e=>setArcTargets(e.target.value)} placeholder="saving&#10;inflation&#10;income"/></label><button className="button primary" disabled={!!busy} onClick={()=>void createArc()}>Salvar arco</button></section>}

    <div className="narrative-arc-list">{bundle.arcs.map(arc=><section className="narrative-arc" key={arc.id}>
      <header><div><span>ARC {String(arc.sequence).padStart(2,'0')}</span><h3>{arc.name}</h3><p>{arc.objective||'Objetivo ainda não definido.'}</p></div><select value={arc.status} onChange={e=>void updateArc(arc,e.target.value as ContentArc['status'])}>{Object.entries(arcStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></header>
      <div className="narrative-arc-targets">{arc.targetConcepts.map(item=><em key={item}>{item}</em>)}</div>
      <div className="narrative-episode-list">{(episodesByArc.get(arc.id)??[]).map(episode=>{
        const readiness=episodeNarrativeReadiness(episode,bundle.concepts,brain);
        return <article key={episode.id}>
          <div className="episode-seq">EP {String(episode.sequence).padStart(2,'0')}</div>
          <div><strong>{episode.title}</strong><p>{episode.thesis||'Tese ainda não definida.'}</p><small>{readiness.ready?'Narrativamente pronto':`Bloqueado: ${[...readiness.missingConcepts,...readiness.repetitionConflicts].join(', ')}`}</small></div>
          <select value={episode.status} onChange={e=>void updateEpisode(episode,e.target.value as ChannelEpisode['status'])}>{Object.entries(episodeStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        </article>;
      })}</div>
    </section>)}</div>
    {!bundle.arcs.length&&<div className="narrative-empty">Nenhum arco criado ainda.</div>}

    <div className="narrative-section-head"><div><span>EPISODES</span><h2>Planeje sem quebrar continuidade.</h2></div><button className="button subtle" onClick={()=>setShowEpisode(v=>!v)}><Plus size={15}/>Novo episódio</button></div>
    {showEpisode&&<section className="narrative-form">
      <div className="narrative-form-grid"><label>Título / working title<input value={episodeTitle} onChange={e=>setEpisodeTitle(e.target.value)}/></label><label>Arco<select value={episodeArc} onChange={e=>setEpisodeArc(e.target.value)}><option value="">Sem arco</option>{bundle.arcs.map(arc=><option key={arc.id} value={arc.id}>{arc.name}</option>)}</select></label></div>
      <label>Tese<textarea rows={3} value={episodeThesis} onChange={e=>setEpisodeThesis(e.target.value)}/></label>
      <div className="narrative-form-grid three"><label>Pré-requisitos <small>keys, uma por linha.</small><textarea rows={4} value={episodePrereqs} onChange={e=>setEpisodePrereqs(e.target.value)}/></label><label>Introduz <small>keys, uma por linha.</small><textarea rows={4} value={episodeIntroduces} onChange={e=>setEpisodeIntroduces(e.target.value)}/></label><label>Chaves de repetição <small>uma por linha.</small><textarea rows={4} value={episodeRepetition} onChange={e=>setEpisodeRepetition(e.target.value)}/></label></div>
      <button className="button primary" disabled={!!busy} onClick={()=>void createEpisode()}>Criar episódio</button>
    </section>}

    <div className="narrative-section-head"><div><span>CONCEPT GRAPH</span><h2>O que o canal sabe — e o que depende do quê.</h2></div><button className="button subtle" onClick={()=>setShowConcept(v=>!v)}><Plus size={15}/>Novo conceito</button></div>
    {showConcept&&<section className="narrative-form">
      <div className="narrative-form-grid"><label>Conceito<input value={conceptLabel} onChange={e=>{setConceptLabel(e.target.value);if(!conceptKey)setConceptKey(slug(e.target.value));}} placeholder="Investing"/></label><label>Key<input value={conceptKey} onChange={e=>setConceptKey(slug(e.target.value))} placeholder="investing"/></label></div>
      <label>Descrição<textarea rows={3} value={conceptDescription} onChange={e=>setConceptDescription(e.target.value)}/></label>
      <label>Pré-requisitos <small>keys, uma por linha.</small><textarea rows={4} value={conceptPrereqs} onChange={e=>setConceptPrereqs(e.target.value)}/></label>
      <button className="button primary" disabled={!!busy} onClick={()=>void createConcept()}>Adicionar conceito</button>
    </section>}

    <section className="concept-table">{bundle.concepts.map(item=>{
      const readiness=conceptPrerequisitesMet(item,bundle.concepts);
      return <article key={item.id}><div><Route size={17}/></div><div><strong>{item.label}</strong><small>{item.key}</small></div><div className="concept-prereqs">{item.prerequisiteKeys.length?item.prerequisiteKeys.map(x=><em key={x}>{x}</em>):<span>sem pré-requisito</span>}</div><div className={readiness.ready?'concept-ready':'concept-blocked'}>{readiness.ready?'ready':`falta ${readiness.missing.join(', ')}`}</div><select disabled={busy===`concept:${item.id}`} value={item.status} onChange={e=>void updateConcept(item,e.target.value as ChannelConcept['status'])}>{Object.entries(conceptStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></article>;
    })}</section>
  </div>;
}

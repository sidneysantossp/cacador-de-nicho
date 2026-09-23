'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BrainCircuit, CheckCircle2, Clock3, History, Plus, Save,
  ShieldCheck, Sparkles, Trash2, UserRound, Workflow
} from 'lucide-react';
import type {
  ChannelBrain, ChannelBrainCharacter, ChannelBrainLearning, ChannelBrainPayload,
  ChannelBrainVersion, ManagedChannel
} from '@/lib/types';
import NarrativeStrategy from './narrative-strategy';

type Tab='constitution'|'narrative'|'arcs'|'characters'|'learnings'|'history';

function blankBrain(channel:ManagedChannel):ChannelBrainPayload{
  const now=new Date().toISOString();
  return {
    kind:'channel-brain',
    channelId:channel.id,
    constitution:{
      premise:channel.description||'',
      audience:'',
      editorialPromise:channel.description||'',
      worldview:'',
      tone:[],
      languageRules:[],
      humor:[],
      universeRules:[],
      forbidden:[],
      metaphors:[]
    },
    characters:[],
    narrative:{
      currentArc:'',
      stateSummary:'',
      establishedConcepts:[],
      partialConcepts:[],
      unknownConcepts:[],
      openThreads:[],
      resolvedThreads:[],
      doNotRepeat:[],
      nextConcepts:[]
    },
    learnings:[],
    createdAt:now,
    updatedAt:now
  };
}

function lines(value:string[]){return value.join('\n');}
function parseLines(value:string){return value.split('\n').map(item=>item.trim()).filter(Boolean);}
function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}

export default function ChannelBrainPage({
  channel,
  brain,
  onBack,
  onSaved
}:{
  channel:ManagedChannel|null;
  brain:ChannelBrain|null;
  onBack:()=>void;
  onSaved:()=>Promise<void>;
}){
  const [tab,setTab]=useState<Tab>('constitution');
  const [draft,setDraft]=useState<ChannelBrainPayload|null>(channel?(brain??blankBrain(channel)):null);
  const [current,setCurrent]=useState<ChannelBrain|null>(brain);
  const [history,setHistory]=useState<ChannelBrainVersion[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [learningStatement,setLearningStatement]=useState('');
  const [learningEvidence,setLearningEvidence]=useState('');
  const [learningType,setLearningType]=useState<ChannelBrainLearning['type']>('operator');
  const [learningConfidence,setLearningConfidence]=useState<ChannelBrainLearning['confidence']>('medium');

  useEffect(()=>{
    if(!channel){setDraft(null);setCurrent(null);setHistory([]);return;}
    setDraft(brain??blankBrain(channel));
    setCurrent(brain);
    let cancelled=false;
    void fetch(`/api/channel-brain?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'})
      .then(async res=>{
        const body=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(body.message??'Falha ao carregar histórico.');
        if(cancelled)return;
        if(body.brain){setCurrent(body.brain);setDraft(body.brain);}
        setHistory(body.history??[]);
      })
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Falha ao carregar Channel Brain.');});
    return()=>{cancelled=true;};
  },[channel?.id,brain?.version]);

  const dirty=useMemo(()=>{
    if(!draft)return false;
    const base=current?JSON.stringify({...current,version:undefined}):JSON.stringify(blankBrain(channel!));
    return JSON.stringify(draft)!==base;
  },[draft,current,channel]);

  if(!channel||!draft)return <section className="brain-empty"><BrainCircuit size={30}/><h2>Canal não encontrado.</h2><button className="button primary" onClick={onBack}>Voltar</button></section>;

  async function save(){
    if(!draft)return;
    setBusy(true);setMessage('');
    try{
      const next={...draft,updatedAt:new Date().toISOString()};
      const res=await fetch('/api/channel-brain',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:current?.version??0,brain:next})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Não foi possível salvar o Channel Brain.');
      setCurrent(body.brain);
      setDraft(body.brain);
      setHistory(body.history??[]);
      setMessage(body.message??'Channel Brain salvo.');
      await onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Channel Brain.');}
    finally{setBusy(false);}
  }

  function constitution<K extends keyof ChannelBrainPayload['constitution']>(key:K,value:ChannelBrainPayload['constitution'][K]){
    setDraft(prev=>prev?{...prev,constitution:{...prev.constitution,[key]:value}}:prev);
  }
  function narrative<K extends keyof ChannelBrainPayload['narrative']>(key:K,value:ChannelBrainPayload['narrative'][K]){
    setDraft(prev=>prev?{...prev,narrative:{...prev.narrative,[key]:value}}:prev);
  }
  function character(index:number,next:ChannelBrainCharacter){
    setDraft(prev=>prev?{...prev,characters:prev.characters.map((item,i)=>i===index?next:item)}:prev);
  }
  function addCharacter(){
    setDraft(prev=>prev?{...prev,characters:[...prev.characters,{id:crypto.randomUUID(),name:'',role:'',traits:[],knows:[],doesNotKnow:[],rules:[]}]}:prev);
  }
  function addLearning(){
    const statement=learningStatement.trim();
    if(!statement)return;
    const learning:ChannelBrainLearning={
      id:crypto.randomUUID(),
      type:learningType,
      statement,
      evidence:parseLines(learningEvidence),
      confidence:learningConfidence,
      createdAt:new Date().toISOString()
    };
    setDraft(prev=>prev?{...prev,learnings:[learning,...prev.learnings]}:prev);
    setLearningStatement('');setLearningEvidence('');
  }
  function loadVersion(item:ChannelBrainVersion){
    setDraft({...item.payload,updatedAt:new Date().toISOString()});
    setTab('constitution');
    setMessage(`Versão ${item.version} carregada no editor. Salve para criar uma nova versão sem apagar o histórico.`);
  }

  const tabs:Array<{id:Tab;label:string;icon:React.ReactNode;count?:number}>=[
    {id:'constitution',label:'Constituição',icon:<ShieldCheck size={15}/>},
    {id:'narrative',label:'Narrative State',icon:<Workflow size={15}/>},
    {id:'arcs',label:'Arcos & Progressão',icon:<BrainCircuit size={15}/>},
    {id:'characters',label:'Personagens',icon:<UserRound size={15}/>,count:draft.characters.length},
    {id:'learnings',label:'Learnings',icon:<Sparkles size={15}/>,count:draft.learnings.length},
    {id:'history',label:'Versões',icon:<History size={15}/>,count:history.length}
  ];

  return <div className="brain-page">
    <div className="brain-back"><button onClick={onBack}><ArrowLeft size={16}/>Gestão de canais</button><span>CHANNEL BRAIN / MEMÓRIA EDITORIAL</span></div>

    <section className="brain-hero">
      <div>
        <div className="brain-kicker">CÉREBRO PERMANENTE DO CANAL</div>
        <h1>{channel.name}<span>.</span></h1>
        <p>{channel.description||'Construa a identidade, memória e progressão deste canal.'}</p>
        <div className="brain-meta">
          <em>{channel.niche}</em><em>{channel.format}</em><em>{channel.stage}</em>
          <em className="version">Brain v{current?.version??0}</em>
        </div>
      </div>
      <div className="brain-hero-actions">
        <span className={dirty?'brain-dirty':'brain-saved'}>{dirty?'Alterações não salvas':'Tudo salvo'}</span>
        <button className="button primary" disabled={busy||!dirty} onClick={()=>void save()}><Save size={16}/>{busy?'Salvando…':'Salvar nova versão'}</button>
      </div>
    </section>

    {message&&<div className="brain-message"><CheckCircle2 size={16}/><span>{message}</span></div>}

    <nav className="brain-tabs">{tabs.map(item=><button key={item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.icon}{item.label}{item.count!==undefined&&<b>{item.count}</b>}</button>)}</nav>

    {tab==='constitution'&&<div className="brain-content">
      <section className="brain-intro-card"><div><span>CHANNEL CONSTITUTION</span><h2>O que não deve mudar sozinho.</h2><p>Esta camada protege identidade, visão editorial e regras do universo. Learnings podem evoluir; a Constituição só muda quando você decide.</p></div><ShieldCheck size={34}/></section>
      <div className="brain-grid two">
        <TextField label="PREMISSA" value={draft.constitution.premise} onChange={v=>constitution('premise',v)} rows={6}/>
        <TextField label="PÚBLICO" value={draft.constitution.audience} onChange={v=>constitution('audience',v)} rows={6}/>
        <TextField label="PROMESSA EDITORIAL" value={draft.constitution.editorialPromise} onChange={v=>constitution('editorialPromise',v)} rows={6}/>
        <TextField label="VISÃO DE MUNDO / IDEOLOGIA EDITORIAL" value={draft.constitution.worldview} onChange={v=>constitution('worldview',v)} rows={6}/>
      </div>
      <div className="brain-grid two">
        <ListField label="TOM" value={draft.constitution.tone} onChange={v=>constitution('tone',v)}/>
        <ListField label="REGRAS DE LINGUAGEM" value={draft.constitution.languageRules} onChange={v=>constitution('languageRules',v)}/>
        <ListField label="HUMOR" value={draft.constitution.humor} onChange={v=>constitution('humor',v)}/>
        <ListField label="REGRAS DO UNIVERSO" value={draft.constitution.universeRules} onChange={v=>constitution('universeRules',v)}/>
        <ListField label="PROIBIDO / NÃO FAZER" value={draft.constitution.forbidden} onChange={v=>constitution('forbidden',v)}/>
        <ListField label="METÁFORAS ESTABELECIDAS" value={draft.constitution.metaphors} onChange={v=>constitution('metaphors',v)}/>
      </div>
    </div>}

    {tab==='narrative'&&<div className="brain-content">
      <section className="brain-intro-card narrative"><div><span>NARRATIVE STATE</span><h2>Onde o canal está agora.</h2><p>O roteiro futuro deve começar daqui — não de um prompt vazio. Conceitos, threads e aprendizados permanecem entre episódios.</p></div><Workflow size={34}/></section>
      <div className="brain-grid two">
        <TextField label="ARCO ATUAL" value={draft.narrative.currentArc} onChange={v=>narrative('currentArc',v)} rows={3}/>
        <TextField label="ÚLTIMO EPISÓDIO / ID" value={draft.narrative.lastEpisodeId??''} onChange={v=>narrative('lastEpisodeId',v||undefined)} rows={3}/>
      </div>
      <TextField label="ESTADO NARRATIVO ATUAL" value={draft.narrative.stateSummary} onChange={v=>narrative('stateSummary',v)} rows={7}/>
      <div className="brain-grid three">
        <ListField label="CONCEITOS ESTABELECIDOS" value={draft.narrative.establishedConcepts} onChange={v=>narrative('establishedConcepts',v)}/>
        <ListField label="CONCEITOS PARCIAIS" value={draft.narrative.partialConcepts} onChange={v=>narrative('partialConcepts',v)}/>
        <ListField label="AINDA DESCONHECIDOS" value={draft.narrative.unknownConcepts} onChange={v=>narrative('unknownConcepts',v)}/>
        <ListField label="OPEN THREADS" value={draft.narrative.openThreads} onChange={v=>narrative('openThreads',v)}/>
        <ListField label="THREADS RESOLVIDOS" value={draft.narrative.resolvedThreads} onChange={v=>narrative('resolvedThreads',v)}/>
        <ListField label="NÃO REPETIR" value={draft.narrative.doNotRepeat} onChange={v=>narrative('doNotRepeat',v)}/>
      </div>
      <ListField label="PRÓXIMOS CONCEITOS POSSÍVEIS" value={draft.narrative.nextConcepts} onChange={v=>narrative('nextConcepts',v)}/>
    </div>}

    {tab==='arcs'&&<NarrativeStrategy channel={channel} brain={current}/>}

    {tab==='characters'&&<div className="brain-content">
      <div className="brain-section-head"><div><span>CHARACTER KNOWLEDGE</span><h2>O personagem também tem memória.</h2><p>Defina o que cada personagem sabe, ainda não sabe e nunca deve contradizer.</p></div><button className="button subtle" onClick={addCharacter}><Plus size={15}/>Novo personagem</button></div>
      {!draft.characters.length&&<div className="brain-empty-inline">Nenhum personagem registrado.</div>}
      <div className="brain-character-list">{draft.characters.map((item,index)=><section className="brain-character" key={item.id}>
        <div className="brain-character-head"><UserRound size={22}/><input value={item.name} onChange={e=>character(index,{...item,name:e.target.value})} placeholder="Nome do personagem"/><button className="icon-button" onClick={()=>setDraft(prev=>prev?{...prev,characters:prev.characters.filter((_,i)=>i!==index)}:prev)}><Trash2 size={16}/></button></div>
        <TextField label="PAPEL" value={item.role} onChange={v=>character(index,{...item,role:v})} rows={3}/>
        <div className="brain-grid two">
          <ListField label="TRAÇOS" value={item.traits} onChange={v=>character(index,{...item,traits:v})}/>
          <ListField label="O QUE JÁ SABE" value={item.knows} onChange={v=>character(index,{...item,knows:v})}/>
          <ListField label="O QUE AINDA NÃO SABE" value={item.doesNotKnow} onChange={v=>character(index,{...item,doesNotKnow:v})}/>
          <ListField label="REGRAS DO PERSONAGEM" value={item.rules} onChange={v=>character(index,{...item,rules:v})}/>
        </div>
      </section>)}</div>
    </div>}

    {tab==='learnings'&&<div className="brain-content">
      <section className="brain-learning-form">
        <div><span>NOVO LEARNING MANUAL</span><h2>Registre algo que o canal aprendeu.</h2><p>Mais tarde Audience Intelligence e Performance vão alimentar esta camada automaticamente. Por enquanto, você já pode registrar decisões e aprendizados humanos.</p></div>
        <div className="brain-grid two">
          <label>Tipo<select value={learningType} onChange={e=>setLearningType(e.target.value as ChannelBrainLearning['type'])}><option value="operator">Operador</option><option value="editorial">Editorial</option><option value="audience">Audiência</option><option value="performance">Performance</option><option value="production">Produção</option></select></label>
          <label>Confiança<select value={learningConfidence} onChange={e=>setLearningConfidence(e.target.value as ChannelBrainLearning['confidence'])}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></label>
        </div>
        <label>Aprendizado<textarea rows={4} value={learningStatement} onChange={e=>setLearningStatement(e.target.value)} placeholder="Ex.: Metáforas físicas funcionam melhor que explicações abstratas."/></label>
        <label>Evidências <small>Uma por linha.</small><textarea rows={4} value={learningEvidence} onChange={e=>setLearningEvidence(e.target.value)} placeholder="Comentário recorrente…&#10;Queda de retenção…"/></label>
        <button className="button primary" onClick={addLearning}><Plus size={15}/>Adicionar ao Brain</button>
      </section>
      <div className="brain-learning-list">{draft.learnings.map(item=><article key={item.id}><div><span>{item.type} · {item.confidence}</span><strong>{item.statement}</strong><small>{when(item.createdAt)}</small></div><ul>{item.evidence.map(e=><li key={e}>{e}</li>)}</ul><button className="icon-button" onClick={()=>setDraft(prev=>prev?{...prev,learnings:prev.learnings.filter(x=>x.id!==item.id)}:prev)}><Trash2 size={15}/></button></article>)}</div>
      {!draft.learnings.length&&<div className="brain-empty-inline">Nenhum learning registrado ainda.</div>}
    </div>}

    {tab==='history'&&<div className="brain-content">
      <section className="brain-intro-card history"><div><span>VERSION HISTORY</span><h2>O cérebro nunca perde o passado.</h2><p>Cada salvamento gera uma nova versão imutável. Carregar uma versão antiga não apaga nada: ao salvar, ela vira uma nova versão.</p></div><History size={34}/></section>
      <div className="brain-version-list">{history.map(item=><article key={item.version}>
        <div className="brain-version-number">v{item.version}</div>
        <div><strong>{when(item.createdAt)}</strong><p>{item.payload.narrative.currentArc||'Sem arco definido'} · {item.payload.narrative.establishedConcepts.length} conceito(s) estabelecido(s) · {item.payload.learnings.length} learning(s)</p></div>
        <button className="button subtle small" onClick={()=>loadVersion(item)}>Carregar no editor</button>
      </article>)}</div>
    </div>}
  </div>;
}

function TextField({label,value,onChange,rows=4}:{label:string;value:string;onChange:(value:string)=>void;rows?:number}){
  return <label className="brain-field"><span>{label}</span><textarea rows={rows} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
function ListField({label,value,onChange}:{label:string;value:string[];onChange:(value:string[])=>void}){
  return <label className="brain-field brain-list-field"><span>{label}</span><small>Um item por linha.</small><textarea rows={Math.max(5,Math.min(10,value.length+2))} value={lines(value)} onChange={e=>onChange(parseLines(e.target.value))}/></label>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, CheckCircle2, Circle, CirclePause, LoaderCircle,
  Play, RefreshCw, Settings2, ShieldCheck, StopCircle, Workflow
} from 'lucide-react';
import type {
  EpisodeAutomationMode, EpisodeAutomationPolicy, EpisodeAutomationRun,
  EpisodeAutomationStepState, ManagedChannel
} from '@/lib/types';

type ProjectOption={
  id:string;
  episodeId:string;
  status:string;
  title:string;
  updatedAt:string;
};
type State={runs:EpisodeAutomationRun[];availableProjects:ProjectOption[]};

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function stepIcon(step:EpisodeAutomationStepState){
  if(step.status==='completed')return <CheckCircle2 size={14}/>;
  if(step.status==='running')return <LoaderCircle className="spin" size={14}/>;
  if(step.status==='waiting')return <CirclePause size={14}/>;
  if(step.status==='blocked'||step.status==='failed')return <AlertTriangle size={14}/>;
  if(step.status==='ready')return <Play size={14}/>;
  return <Circle size={12}/>;
}
function statusText(status:EpisodeAutomationRun['status']){
  return {
    active:'Pronto para avançar',waiting:'Aguardando',running:'Executando',
    completed:'Concluído',failed:'Falhou',cancelled:'Cancelado'
  }[status];
}

const policyLabels:Record<keyof EpisodeAutomationPolicy,string>={
  autoGenerateScript:'Gerar roteiro',
  autoApproveObjectiveGates:'Aprovar gates objetivos',
  autoGenerateVoice:'Gerar narração',
  autoCreateTranscript:'Criar transcript',
  autoCreateScenes:'Criar Scene Plan',
  autoGenerateVisualPrompts:'Gerar prompts visuais',
  autoGenerateVisualAssets:'Gerar assets visuais',
  autoBuildTimeline:'Montar timeline',
  autoCreateVideoEdit:'Criar Video Edit',
  autoRender:'Enfileirar render',
  autoRunQuality:'Executar Production QA',
  autoCreatePackage:'Criar Packaging',
  autoPublish:'Publicar automaticamente'
};

export default function EpisodeAutomationWorkspace({channel}:{channel:ManagedChannel}){
  const [state,setState]=useState<State>({runs:[],availableProjects:[]});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]='' as never;
  const [selectedProject,setSelectedProject]=useState('');

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/episode-automation?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Automation.');
      setState({
        runs:body.runs??[],
        availableProjects:body.availableProjects??[]
      });
      setSelectedProject(current=>current||(body.availableProjects?.[0]?.id??''));
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha ao carregar Automation.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  useEffect(()=>{
    if(!state.runs.some(run=>run.status==='active'||run.status==='running'))return;
    const timer=setInterval(()=>void load(true),5000);
    return()=>clearInterval(timer);
  },[state.runs.map(run=>run.id+':'+run.status+':'+run.updatedAt).join('|')]);

  async function action(payload:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/episode-automation',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha na automação.');
      setMessage(body.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha na automação.');
    }finally{setBusy('');}
  }

  async function create(mode:EpisodeAutomationMode){
    if(!selectedProject)return;
    await action({action:'create',contentProjectId:selectedProject,mode},'create:'+mode);
  }

  async function togglePolicy(run:EpisodeAutomationRun,key:keyof EpisodeAutomationPolicy,value:boolean){
    await action({
      action:'update',
      runId:run.id,
      policy:{[key]:value}
    },'policy:'+run.id+':'+key);
  }

  if(loading)return <div className="automation-loading"><LoaderCircle className="spin" size={19}/>Carregando fábrica de episódios…</div>;

  return <div className="automation-workspace">
    {message&&<div className="automation-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="automation-hero">
      <div>
        <span>EPISODE AUTOMATION CONTROL PLANE</span>
        <h2>Uma linha de produção para cada episódio.</h2>
        <p>O Control Plane reconcilia o estado real dos engines e aponta exatamente o próximo movimento. Modo autônomo executará apenas transições permitidas pela policy; gates humanos continuam explícitos.</p>
      </div>
      <Workflow size={37}/>
    </section>

    <section className="automation-create">
      <div className="automation-section-head">
        <div><span>NOVO RUN</span><h3>Coloque um Content Project na fábrica.</h3></div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={13}/>Reconciliar tudo</button>
      </div>
      {state.availableProjects.length>0?<div className="automation-create-row">
        <select value={selectedProject} onChange={e=>setSelectedProject(e.target.value)}>
          {state.availableProjects.map(project=><option key={project.id} value={project.id}>{project.title} · {project.status}</option>)}
        </select>
        <button className="button subtle" disabled={!selectedProject||busy.startsWith('create:')} onClick={()=>void create('assisted')}><ShieldCheck size={14}/>Assisted</button>
        <button className="button primary" disabled={!selectedProject||busy.startsWith('create:')} onClick={()=>void create('autonomous')}><Bot size={14}/>Autonomous</button>
      </div>:<div className="automation-empty-inline">Todos os Content Projects deste canal já possuem Automation Run.</div>}
    </section>

    <div className="automation-runs">{state.runs.map(run=><RunCard key={run.id} run={run} busy={busy} onAction={action} onPolicy={togglePolicy}/>)}</div>
    {!state.runs.length&&<div className="automation-empty"><Workflow size={28}/><h3>Nenhum episódio na fábrica.</h3><p>Crie um run a partir de um Content Project para acompanhar a produção ponta a ponta.</p></div>}
  </div>;
}

function RunCard({run,busy,onAction,onPolicy}:{
  run:EpisodeAutomationRun;
  busy:string;
  onAction:(payload:Record<string,unknown>,key:string)=>Promise<void>;
  onPolicy:(run:EpisodeAutomationRun,key:keyof EpisodeAutomationPolicy,value:boolean)=>Promise<void>;
}){
  const completed=run.steps.filter(item=>item.status==='completed'||item.status==='skipped').length;
  const total=run.steps.length||13;
  const pct=Math.round((completed/total)*100);
  const current=run.steps.find(item=>item.step===run.currentStep);
  const [showPolicy,setShowPolicy]=useState(false);
  const active=run.status!=='completed'&&run.status!=='cancelled';

  return <article className={'automation-run '+run.status}>
    <header>
      <div>
        <span>{run.mode.toUpperCase()} · {statusText(run.status)}</span>
        <h3>{current?.label??'Episódio concluído'}</h3>
        <p>{run.lastDecision}</p>
      </div>
      <b>{pct}%</b>
    </header>

    <div className="automation-progress"><i style={{width:pct+'%'}}/></div>
    <div className="automation-meta">
      <span>Episode {run.episodeId.slice(0,8)}</span>
      <span>Run {run.id.slice(0,8)}</span>
      <span>{completed}/{total} etapas</span>
      <span>Atualizado {when(run.updatedAt)}</span>
    </div>

    {run.blockers.length>0&&<div className="automation-blockers">{run.blockers.map(item=><p key={item}><AlertTriangle size={12}/>{item}</p>)}</div>}

    <div className="automation-steps">{run.steps.map(item=><div key={item.step} className={'automation-step '+item.status}>
      <div>{stepIcon(item)}<strong>{item.label}</strong></div>
      <span>{item.status}</span>
      {item.reason&&<p>{item.reason}</p>}
      {item.requiresOperator&&<em>operador</em>}
    </div>)}</div>

    {showPolicy&&<div className="automation-policy">
      <div className="automation-policy-head"><Settings2 size={14}/><strong>Policy deste episódio</strong></div>
      <div>{(Object.keys(policyLabels) as Array<keyof EpisodeAutomationPolicy>).map(key=><label key={key}>
        <input
          type="checkbox"
          checked={run.policy[key]}
          disabled={!active||busy.startsWith('policy:'+run.id)}
          onChange={e=>void onPolicy(run,key,e.target.checked)}
        />
        <span>{policyLabels[key]}</span>
      </label>)}</div>
      <p>Publicação automática permanece desligada por padrão mesmo no modo Autonomous.</p>
    </div>}

    <footer>
      <div>
        <button className="button subtle small" onClick={()=>setShowPolicy(value=>!value)}><Settings2 size={13}/>{showPolicy?'Ocultar policy':'Policy'}</button>
        {active&&<button className="button subtle small" disabled={busy==='mode:'+run.id} onClick={()=>void onAction({action:'update',runId:run.id,mode:run.mode==='autonomous'?'assisted':'autonomous'},'mode:'+run.id)}>
          {run.mode==='autonomous'?<ShieldCheck size={13}/>:<Bot size={13}/>}
          Mudar para {run.mode==='autonomous'?'Assisted':'Autonomous'}
        </button>}
      </div>
      <div>
        {active&&<button className="button subtle small" disabled={busy==='reconcile:'+run.id} onClick={()=>void onAction({action:'reconcile',runId:run.id},'reconcile:'+run.id)}><RefreshCw size={13}/>Reconciliar</button>}
        {active&&<button className="button subtle small danger" disabled={busy==='cancel:'+run.id} onClick={()=>void onAction({action:'cancel',runId:run.id},'cancel:'+run.id)}><StopCircle size={13}/>Cancelar</button>}
      </div>
    </footer>
  </article>;
}

'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Gauge, History, LoaderCircle,
  PauseCircle, PlayCircle, RefreshCw, ShieldAlert
} from 'lucide-react';
import type {
  AutopilotControl, AutopilotControlVersion, AutopilotIncident
} from '@/lib/types';

type State={
  control:AutopilotControl;
  history:AutopilotControlVersion[];
  live:{
    automationActive:number;
    automationLeased:number;
    learningScheduled:number;
    learningLeased:number;
  };
  incidents:AutopilotIncident[];
  openCriticalIncidents:number;
};

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{
    dateStyle:'short',timeStyle:'short'
  });
}

export default function AutopilotControlPlane(){
  const [state,setState]=useState<State|null>(null);
  const [reason,setReason]=useState('');
  const [automationLimit,setAutomationLimit]=useState(1);
  const [learningLimit,setLearningLimit]=useState(1);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  async function load(silent=false){
    if(!silent)setBusy('load');
    try{
      const response=await fetch('/api/autopilot-control',{cache:'no-store'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message??'Falha ao carregar Control Plane.');
      setState(body as State);
      setReason(body.control?.pauseReason??'');
      setAutomationLimit(Number(body.control?.maxConcurrentAutomationRuns??1));
      setLearningLimit(Number(body.control?.maxConcurrentLearningJobs??1));
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha ao carregar Control Plane.');
    }finally{
      if(!silent)setBusy('');
    }
  }

  useEffect(()=>{void load();},[]);

  async function action(
    payload:Record<string,unknown>,
    key:string
  ){
    setBusy(key);setMessage('');
    try{
      const response=await fetch('/api/autopilot-control',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message??'Falha no Control Plane.');
      setMessage(body.message??'Control Plane atualizado.');
      const next=(body.state??null) as State|null;
      if(next){
        setState(next);
        setReason(next.control.pauseReason);
        setAutomationLimit(next.control.maxConcurrentAutomationRuns);
        setLearningLimit(next.control.maxConcurrentLearningJobs);
      }else{
        await load(true);
      }
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Control Plane.');
    }finally{setBusy('');}
  }

  if(!state){
    return <section className="autopilot-control-plane loading">
      <LoaderCircle className="spin" size={18}/>
      <span>{message||'Carregando Control Plane…'}</span>
    </section>;
  }

  const {control,live,history}=state;
  const paused=control.status==='paused';

  return <section className={'autopilot-control-plane '+control.status}>
    <header>
      <div>
        <span>GLOBAL AUTOPILOT CONTROL PLANE</span>
        <h3>{paused?'Automação global pausada':'Automação global liberada'}</h3>
        <p>Master switch para Episode Automation e Closed Loop. Um pause impede novos leases e interrompe runs ativos no próximo checkpoint seguro.</p>
      </div>
      <div className={'autopilot-master-state '+control.status}>
        {paused?<PauseCircle size={19}/>:<PlayCircle size={19}/>}
        <strong>{control.status.toUpperCase()}</strong>
        <small>v{control.version}</small>
      </div>
    </header>

    {message&&<div className="autopilot-control-message"><CheckCircle2 size={14}/>{message}</div>}

    {paused&&<div className="autopilot-pause-banner">
      <ShieldAlert size={17}/>
      <div><strong>Kill switch ativo</strong><p>{control.pauseReason||'Sem motivo informado.'}</p></div>
    </div>}

    <div className="autopilot-live-grid">
      <div><span>Automation ativos</span><strong>{live.automationActive}</strong><small>{live.automationLeased} com lease</small></div>
      <div><span>Learning agendados</span><strong>{live.learningScheduled}</strong><small>{live.learningLeased} processando</small></div>
      <div><span>Concorrência produção</span><strong>{control.maxConcurrentAutomationRuns}</strong><small>runs simultâneos</small></div>
      <div><span>Concorrência learning</span><strong>{control.maxConcurrentLearningJobs}</strong><small>jobs simultâneos</small></div>
    </div>

    <div className="autopilot-control-grid">
      <section>
        <div className="autopilot-control-subhead"><ShieldAlert size={15}/><strong>Master switch</strong></div>
        {paused?
          <button className="button primary" disabled={Boolean(busy)} onClick={()=>{
            if(!window.confirm('Retomar o Autopilot global? Workers poderão voltar a reivindicar jobs elegíveis.'))return;
            void action({
              action:'resume',
              expectedVersion:control.version
            },'resume');
          }}>
            {busy==='resume'?<LoaderCircle className="spin" size={14}/>:<PlayCircle size={14}/>}
            Retomar Autopilot
          </button>
          :
          <>
            <label>Motivo da pausa
              <textarea rows={2} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Ex.: manutenção de provider, investigação de qualidade…"/>
            </label>
            <button className="button subtle danger" disabled={Boolean(busy)||reason.trim().length<3} onClick={()=>void action({
              action:'pause',
              expectedVersion:control.version,
              reason:reason.trim()
            },'pause')}>
              {busy==='pause'?<LoaderCircle className="spin" size={14}/>:<PauseCircle size={14}/>}
              Pausar tudo
            </button>
          </>
        }
      </section>

      <section>
        <div className="autopilot-control-subhead"><Gauge size={15}/><strong>Limites globais</strong></div>
        <div className="autopilot-limit-grid">
          <label>Episode Automation
            <input type="number" min={1} max={10} value={automationLimit} onChange={event=>setAutomationLimit(Number(event.target.value))}/>
          </label>
          <label>Closed Loop
            <input type="number" min={1} max={10} value={learningLimit} onChange={event=>setLearningLimit(Number(event.target.value))}/>
          </label>
        </div>
        <button className="button subtle" disabled={Boolean(busy)} onClick={()=>void action({
          action:'limits',
          expectedVersion:control.version,
          maxConcurrentAutomationRuns:automationLimit,
          maxConcurrentLearningJobs:learningLimit
        },'limits')}>
          {busy==='limits'?<LoaderCircle className="spin" size={14}/>:<Gauge size={14}/>}
          Salvar limites
        </button>
      </section>
    </div>

    <section className="autopilot-incidents">
      <div className="autopilot-control-subhead">
        <AlertTriangle size={15}/>
        <strong>Incident Ledger</strong>
        <span>{state.openCriticalIncidents} critical aberto(s)</span>
      </div>
      <div className="autopilot-incident-list">
        {state.incidents.slice(0,12).map(incident=><article key={incident.id} className={incident.severity+' '+incident.status}>
          <div>
            <span>{incident.area} · {incident.code}</span>
            <strong>{incident.message}</strong>
            <small>{when(incident.lastSeenAt)} · {incident.occurrences} ocorrência(s) · {incident.status}</small>
          </div>
          {incident.status==='open'&&<div>
            <button className="button subtle small" disabled={Boolean(busy)} onClick={()=>void action({
              action:'incident',incidentId:incident.id,disposition:'resolved'
            },'incident:'+incident.id)}>Resolver</button>
            <button className="button subtle small" disabled={Boolean(busy)} onClick={()=>void action({
              action:'incident',incidentId:incident.id,disposition:'ignored'
            },'ignore:'+incident.id)}>Ignorar</button>
          </div>}
        </article>)}
        {!state.incidents.length&&<div className="autopilot-no-incidents">Nenhum incidente registrado.</div>}
      </div>
    </section>

    <details className="autopilot-control-history">
      <summary><History size={14}/>Histórico do Control Plane</summary>
      <div>
        {history.slice(0,10).map(item=><article key={item.version}>
          <span>v{item.version}</span>
          <strong>{item.status.toUpperCase()}</strong>
          <p>{item.payload.pauseReason||'Autopilot liberado.'}</p>
          <small>{when(item.createdAt)} · {item.payload.updatedBy}</small>
        </article>)}
      </div>
    </details>

    {!paused&&live.automationLeased+live.learningLeased>0&&
      <div className="autopilot-running-warning"><AlertTriangle size={14}/>Existem jobs em execução. Um pause será aplicado no próximo checkpoint seguro.</div>}
    <button className="button subtle small autopilot-control-refresh" disabled={busy==='load'} onClick={()=>void load()}>
      <RefreshCw size={13}/>Atualizar estado
    </button>
  </section>;
}

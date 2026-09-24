'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BrainCircuit, CheckCircle2, CircleAlert,
  LoaderCircle, RefreshCw, Route, ShieldCheck, Sparkles
} from 'lucide-react';
import type { ManagedChannel, NextEpisodeCandidate, NextEpisodePlan } from '@/lib/types';
import { effectiveChannelAutopilot } from '@/lib/channel-autopilot-policy';

type State={
  plans:NextEpisodePlan[];
  brainVersion:number;
  episodeCount:number;
  activePlan:NextEpisodePlan|null;
};
const EMPTY:State={plans:[],brainVersion:0,episodeCount:0,activePlan:null};

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function strength(value:NextEpisodeCandidate['evidenceStrength']){
  return value==='high'?'Forte':value==='medium'?'Média':'Baixa';
}

export default function NextEpisodeStrategistWorkspace({channel}:{channel:ManagedChannel}){
  const [state,setState]=useState<State>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [notes,setNotes]=useState('');

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/next-episode?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Next Episode Strategist.');
      setState({
        plans:body.plans??[],
        brainVersion:Number(body.brainVersion??0),
        episodeCount:Number(body.episodeCount??0),
        activePlan:body.activePlan??null
      });
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Next Episode Strategist.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  async function action(payload:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/next-episode',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha no Next Episode Strategist.');
      setMessage(body.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Next Episode Strategist.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="next-episode-loading"><LoaderCircle className="spin" size={19}/>Carregando Next Episode Strategist…</div>;

  const plan=state.activePlan;
  const stale=Boolean(plan&&plan.brainVersion!==state.brainVersion);
  const autopilot=effectiveChannelAutopilot(channel);
  const autoStart=autopilot.enabled&&autopilot.startOnAcceptedNextEpisode;

  return <div className="next-episode-strategist">
    {message&&<div className="next-episode-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="next-episode-hero">
      <div>
        <span>NEXT EPISODE STRATEGIST</span>
        <h2>O próximo vídeo nasce do que o canal aprendeu.</h2>
        <p>O estrategista cruza continuidade narrativa, learnings de audiência, performance, conceitos e histórico recente. Cada recomendação precisa carregar evidências rastreáveis e passar pelo gate narrativo.</p>
      </div>
      <div className="next-episode-state">
        <BrainCircuit size={20}/>
        <strong>Brain v{state.brainVersion}</strong>
        <span>{state.episodeCount} episódio(s) registrados</span>
      </div>
    </section>

    <section className="next-episode-command">
      <div>
        <span>DECISÃO EDITORIAL</span>
        <h3>{plan?'Plano ativo v'+plan.version:'Nenhum plano ativo.'}</h3>
        <p>{plan?'Gerado a partir do Brain v'+plan.brainVersion+'.':'Gere três direções concorrentes antes de abrir um novo Content Project.'}</p>
        <div className={'next-episode-autopilot '+(autoStart?'enabled':'disabled')}>
          <span>AUTOPILOT</span>
          <strong>{autoStart?(autopilot.mode==='autonomous'?'Autonomous':'Assisted')+' · inicia após o aceite':'Desligado · aceite cria apenas o Content Project'}</strong>
        </div>
      </div>
      <div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={13}/>Atualizar</button>
        <button className="button primary" disabled={busy==='generate'||Boolean(plan&&!stale)} onClick={()=>void action({action:'generate',channelId:channel.id},'generate')}>
          {busy==='generate'?<LoaderCircle className="spin" size={14}/>:<Sparkles size={14}/>}
          {stale?'Gerar novo plano':'Gerar decisão'}
        </button>
      </div>
    </section>

    {stale&&<div className="next-episode-stale"><AlertTriangle size={15}/><span>O Channel Brain evoluiu de v{plan!.brainVersion} para v{state.brainVersion}. Gere um novo plano antes de aceitar uma proposta.</span></div>}

    {plan&&<PlanView
      plan={plan}
      stale={stale}
      busy={busy}
      notes={notes}
      onNotes={setNotes}
      autoStart={autoStart}
      automationMode={autopilot.mode}
      onAccept={(candidate)=>void action({
        action:'accept',
        planId:plan.id,
        candidateId:candidate.id,
        expectedVersion:plan.version,
        notes
      },'accept:'+candidate.id)}
    />}

    <section className="next-episode-history">
      <div className="next-episode-section-head"><div><span>HISTÓRICO</span><h3>Decisões anteriores.</h3></div></div>
      <div>{state.plans.filter(item=>item.status!=='review').map(item=><article key={item.id}>
        <div><strong>{item.status==='accepted'?'Aceito':'Substituído'} · v{item.version}</strong><span>{when(item.generatedAt)}</span></div>
        <p>{item.candidates.find(candidate=>candidate.id===item.review.acceptedCandidateId)?.workingTitle??item.candidates[0]?.workingTitle??'Plano sem título'}</p>
        {item.review.acceptedContentProjectId&&<small>Content Project {item.review.acceptedContentProjectId}</small>}
      </article>)}</div>
      {!state.plans.some(item=>item.status!=='review')&&<div className="next-episode-empty-inline">Nenhuma decisão anterior registrada.</div>}
    </section>
  </div>;
}

function PlanView({
  plan,stale,busy,notes,onNotes,onAccept,autoStart,automationMode
}:{
  plan:NextEpisodePlan;
  stale:boolean;
  busy:string;
  notes:string;
  autoStart:boolean;
  automationMode:'assisted'|'autonomous';
  onNotes:(value:string)=>void;
  onAccept:(candidate:NextEpisodeCandidate)=>void;
}){
  const evidence=useMemo(()=>new Map(plan.context.evidenceSnapshot.map(item=>[item.ref,item])),[plan]);

  return <section className="next-episode-plan">
    <header>
      <div><span>PLAN v{plan.version} · BRAIN v{plan.brainVersion}</span><h3>3 caminhos para o próximo episódio.</h3><p>{plan.recommendationRationale}</p></div>
      <Route size={27}/>
    </header>

    {plan.limitations.length>0&&<div className="next-episode-limitations">
      {plan.limitations.map(item=><p key={item}><CircleAlert size={12}/>{item}</p>)}
    </div>}

    <div className="next-episode-candidates">{plan.candidates.map((candidate,index)=>{
      const recommended=candidate.id===plan.recommendedCandidateId;
      return <article key={candidate.id} className={'next-episode-candidate '+(recommended?'recommended ':'')+(candidate.narrativeReady?'ready':'blocked')}>
        <div className="next-episode-candidate-top">
          <div><span>OPÇÃO {index+1}</span>{recommended&&<b>RECOMENDADA</b>}</div>
          <em>{candidate.narrativeReady?'Narrativa OK':'Bloqueada'} · evidência {strength(candidate.evidenceStrength)}</em>
        </div>
        <h3>{candidate.workingTitle}</h3>
        <p className="next-episode-thesis">{candidate.thesis}</p>

        <div className="next-episode-brief-grid">
          <div><span>TEMA</span><p>{candidate.theme}</p></div>
          <div><span>ÂNGULO</span><p>{candidate.angle}</p></div>
          <div><span>PROMESSA</span><p>{candidate.promise}</p></div>
          <div><span>OBJETIVO</span><p>{candidate.objective}</p></div>
          <div><span>PÚBLICO</span><p>{candidate.targetAudience}</p></div>
          <div><span>THUMBNAIL</span><p>{candidate.thumbnailConcept}</p></div>
        </div>

        {candidate.previousEpisodeConnection&&<div className="next-episode-connection"><strong>Continuidade:</strong> {candidate.previousEpisodeConnection}</div>}

        <div className="next-episode-evidence">
          <strong>Por que esta opção existe</strong>
          {candidate.evidenceRefs.map(ref=>{
            const item=evidence.get(ref);
            return <div key={ref}><span>{ref}</span><p>{item?.summary??'Evidência não encontrada no snapshot.'}</p>{item?.confidence&&<em>{item.confidence}</em>}</div>;
          })}
        </div>

        <div className="next-episode-rationale"><Sparkles size={13}/><p>{candidate.rationale}</p></div>

        {candidate.risks.length>0&&<div className="next-episode-risks"><strong>Riscos</strong>{candidate.risks.map(item=><p key={item}><AlertTriangle size={11}/>{item}</p>)}</div>}
        {candidate.blockers.length>0&&<div className="next-episode-blockers">{candidate.blockers.map(item=><span key={item}>{item}</span>)}</div>}

        <button className="button primary" disabled={stale||!candidate.narrativeReady||busy==='accept:'+candidate.id} onClick={()=>onAccept(candidate)}>
          <ShieldCheck size={14}/>{busy==='accept:'+candidate.id?'Criando…':autoStart?'Aceitar → '+(automationMode==='autonomous'?'Autopilot':'Automation'):'Aceitar → Content OS'}
        </button>
      </article>;
    })}</div>

    <label className="next-episode-notes">Nota da decisão<textarea rows={3} value={notes} onChange={e=>onNotes(e.target.value)} placeholder="Opcional: por que esta direção foi escolhida?"/></label>
  </section>;
}

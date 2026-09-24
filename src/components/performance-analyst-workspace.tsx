'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ExternalLink,
  LoaderCircle, RefreshCw, ShieldCheck, Sparkles, TrendingDown, TrendingUp
} from 'lucide-react';
import type {
  LearningLoopJob, ManagedChannel, PerformanceObservation, PerformanceReport,
  YouTubeConnection, YouTubePublishJob
} from '@/lib/types';

type State={
  observations:PerformanceObservation[];
  reports:PerformanceReport[];
  publishedVideos:YouTubePublishJob[];
  analyticsScopeGranted:boolean;
  connection:YouTubeConnection|null;
  learningLoop:{
    brainVersion:number;
    performanceLearningCount:number;
    appliedReportIds:string[];
  };
  closedLoop:{
    enabled:boolean;
    jobs:LearningLoopJob[];
    scheduled:number;
    processing:number;
    waiting:number;
    failed:number;
    completed:number;
    nextDueAt:string|null;
  };
};
const EMPTY:State={
  observations:[],reports:[],publishedVideos:[],analyticsScopeGranted:false,connection:null,
  learningLoop:{brainVersion:0,performanceLearningCount:0,appliedReportIds:[]},
  closedLoop:{
    enabled:false,jobs:[],scheduled:0,processing:0,waiting:0,failed:0,completed:0,nextDueAt:null
  }
};

const metricLabels:Record<string,string>={
  views:'Views',
  impressions:'Impressões',
  ctrPercent:'CTR',
  retentionFirstSecondsPercent:'Retenção ~5s',
  retention30Percent:'Retenção 30s',
  averageViewDurationSeconds:'AVD',
  averagePercentageViewed:'% média assistida',
  watchTimeMinutes:'Watch time',
  likes:'Likes',
  commentCount:'Comentários',
  shares:'Shares',
  subscribersGained:'Inscritos +',
  subscribersLost:'Inscritos -',
  conversions:'Conversões',
  revenue:'Receita',
  rpm:'RPM'
};
function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function number(value:number|null|undefined,metric?:string){
  if(value===null||value===undefined||!Number.isFinite(value))return '—';
  if(metric==='ctrPercent'||metric?.includes('Percent'))return value.toFixed(1)+'%';
  if(metric==='averageViewDurationSeconds')return value.toFixed(1)+'s';
  if(metric==='watchTimeMinutes')return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+' min';
  if(metric==='revenue'||metric==='rpm')return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
  return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1,notation:value>=100000?'compact':'standard'}).format(value);
}
function relationIcon(relation:'above'|'below'|'equal'|'unavailable'){
  return relation==='above'?<TrendingUp size={13}/>:relation==='below'?<TrendingDown size={13}/>:<Activity size={13}/>;
}

export default function PerformanceAnalystWorkspace({channel}:{channel:ManagedChannel}){
  const [state,setState]=useState<State>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/performance-analyst?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Performance Analyst.');
      setState({
        observations:body.observations??[],
        reports:body.reports??[],
        publishedVideos:body.publishedVideos??[],
        analyticsScopeGranted:Boolean(body.analyticsScopeGranted),
        connection:body.connection??null,
        learningLoop:{
          brainVersion:Number(body.learningLoop?.brainVersion??0),
          performanceLearningCount:Number(body.learningLoop?.performanceLearningCount??0),
          appliedReportIds:Array.isArray(body.learningLoop?.appliedReportIds)?body.learningLoop.appliedReportIds:[]
        },
        closedLoop:{
          enabled:Boolean(body.closedLoop?.enabled),
          jobs:Array.isArray(body.closedLoop?.jobs)?body.closedLoop.jobs:[],
          scheduled:Number(body.closedLoop?.scheduled??0),
          processing:Number(body.closedLoop?.processing??0),
          waiting:Number(body.closedLoop?.waiting??0),
          failed:Number(body.closedLoop?.failed??0),
          completed:Number(body.closedLoop?.completed??0),
          nextDueAt:body.closedLoop?.nextDueAt??null
        }
      });
      setNotes(prev=>{
        const next={...prev};
        for(const report of body.reports??[])if(next[report.id]===undefined)next[report.id]=report.review?.notes??'';
        return next;
      });
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Performance Analyst.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  const observationsByVideo=useMemo(()=>{
    const map=new Map<string,PerformanceObservation[]>();
    for(const observation of state.observations){
      if(!observation.externalVideoId)continue;
      const rows=map.get(observation.externalVideoId)??[];
      rows.push(observation);map.set(observation.externalVideoId,rows);
    }
    return map;
  },[state.observations]);

  async function action(payload:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/performance-analyst',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha no Performance Analyst.');
      setMessage(body.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Performance Analyst.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="performance-loading"><LoaderCircle className="spin" size={19}/>Carregando Performance Analyst…</div>;

  return <div className="performance-analyst">
    {message&&<div className="performance-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="performance-hero">
      <div>
        <span>PERFORMANCE ANALYST</span>
        <h2>Transforme desempenho em evidência, não em palpite.</h2>
        <p>O agente compara cada observação com expectativas explícitas ou histórico do próprio canal, localiza mudanças de retenção e entrega hipóteses concorrentes com um único próximo teste.</p>
      </div>
      <div className="performance-brain-state">
        <Sparkles size={18}/>
        <strong>Brain v{state.learningLoop.brainVersion}</strong>
        <span>{state.learningLoop.performanceLearningCount} learning(s) de performance</span>
      </div>
    </section>

    <section className="performance-closed-loop">
      <div className="performance-section-head">
        <div>
          <span>CLOSED LOOP INTELLIGENCE</span>
          <h3>{state.closedLoop.enabled?'Aprendizado pós-publicação ativo.':'Aprendizado automático desligado neste canal.'}</h3>
          <p>{state.closedLoop.enabled
            ?'Snapshots 24h / 72h / 7d alimentam Performance, comentários e Channel Brain sem perder os gates de evidência.'
            :'Ative o Learning Loop no Autopilot do canal para agendar snapshots automaticamente.'}</p>
        </div>
        <button className="button subtle small" disabled={!state.closedLoop.enabled||busy==='closed-loop-schedule'} onClick={()=>void action({action:'schedule-closed-loop',channelId:channel.id},'closed-loop-schedule')}>
          <RefreshCw size={13}/>{busy==='closed-loop-schedule'?'Agendando…':'Sincronizar janelas'}
        </button>
      </div>
      <div className="performance-loop-stats">
        <div><span>AGENDADOS</span><strong>{state.closedLoop.scheduled}</strong></div>
        <div><span>PROCESSANDO</span><strong>{state.closedLoop.processing}</strong></div>
        <div><span>AGUARDANDO</span><strong>{state.closedLoop.waiting}</strong></div>
        <div><span>CONCLUÍDOS</span><strong>{state.closedLoop.completed}</strong></div>
        <div><span>FALHAS</span><strong>{state.closedLoop.failed}</strong></div>
      </div>
      {state.closedLoop.nextDueAt&&<p className="performance-loop-next">Próxima janela: {when(state.closedLoop.nextDueAt)}</p>}
      {!!state.closedLoop.jobs.length&&<div className="performance-loop-jobs">{state.closedLoop.jobs.slice(0,12).map(job=><article key={job.id} className={job.status}>
        <div><strong>{job.windowHours}h · {job.stage}</strong><span>{job.status} · tentativa {job.attempts} · {when(job.dueAt)}</span>{job.lastError&&<small>{job.lastError}</small>}</div>
        {(job.status==='waiting'||job.status==='failed')&&<button className="button subtle small" disabled={busy==='closed-loop-resume:'+job.id} onClick={()=>void action({action:'resume-closed-loop',jobId:job.id},'closed-loop-resume:'+job.id)}>Retomar</button>}
      </article>)}</div>}
    </section>

    {!state.connection&&<div className="performance-blocker"><AlertTriangle size={16}/><div><strong>YouTube ainda não conectado.</strong><p>Conecte o canal na etapa anterior para importar Analytics automaticamente.</p></div></div>}
    {state.connection&&!state.analyticsScopeGranted&&<div className="performance-blocker"><AlertTriangle size={16}/><div><strong>Reconecte o YouTube uma vez.</strong><p>A conexão atual não possui o novo scope de leitura do YouTube Analytics.</p></div></div>}

    <section className="performance-videos">
      <div className="performance-section-head">
        <div><span>PUBLICADOS</span><h3>Coletar snapshot de performance.</h3><p>Cada coleta cria uma observação imutável; snapshots anteriores permanecem disponíveis para baseline.</p></div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={13}/>Atualizar</button>
      </div>
      <div className="performance-video-list">
        {state.publishedVideos.map(job=>{
          const count=job.youtubeVideoId?(observationsByVideo.get(job.youtubeVideoId)?.length??0):0;
          return <article key={job.id}>
            <div>
              <strong>{job.payload.video.title}</strong>
              <span>{job.youtubeVideoId} · {count} snapshot(s){job.completedAt?' · publicado '+when(job.completedAt):''}</span>
            </div>
            <div>
              {job.youtubeUrl&&<a className="button subtle small" href={job.youtubeUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>YouTube</a>}
              <button className="button primary small" disabled={!state.analyticsScopeGranted||busy==='collect:'+job.id} onClick={()=>void action({action:'collect-youtube',jobId:job.id},'collect:'+job.id)}>
                {busy==='collect:'+job.id?<LoaderCircle className="spin" size={13}/>:<BarChart3 size={13}/>}
                Coletar agora
              </button>
            </div>
          </article>;
        })}
        {!state.publishedVideos.length&&<div className="performance-empty-inline">Nenhum vídeo publicado pelo Publisher ainda.</div>}
      </div>
    </section>

    <section className="performance-reports">
      <div className="performance-section-head"><div><span>REPORTS</span><h3>Diagnósticos baseados em evidência.</h3></div></div>
      <div className="performance-report-list">{state.reports.map(report=>{
        const observed=state.observations.find(item=>item.id===report.observationId);
        const applied=state.learningLoop.appliedReportIds.includes(report.id);
        return <article key={report.id} className={'performance-report '+report.status}>
          <header>
            <div>
              <span>REPORT v{report.version} · {report.status.toUpperCase()}</span>
              <h3>{observed?.externalVideoId||'Observação manual'}</h3>
              <p>Observado em {when(report.observedAt)} · {observed?.sourceType??'—'}</p>
            </div>
            <div className="performance-summary">
              <b>{report.diagnoses.length}</b><small>diagnóstico(s)</small>
            </div>
          </header>

          <div className="performance-metrics">{report.comparisons
            .filter(item=>item.current!==null)
            .map(item=><div key={item.metric} className={'metric '+item.relation}>
              <span>{metricLabels[item.metric]??item.metric}</span>
              <strong>{number(item.current,item.metric)}</strong>
              <small>{relationIcon(item.relation)}{item.baseline===null?'sem baseline':item.relation+' vs '+number(item.baseline,item.metric)}</small>
            </div>)}
          </div>

          {(report.strongestSignals.length>0||report.weakestSignals.length>0)&&<div className="performance-signals">
            <div><span>SINAIS FORTES</span>{report.strongestSignals.length?report.strongestSignals.map(item=><p key={item}><TrendingUp size={12}/>{item}</p>):<p>Sem sinal positivo comparável ainda.</p>}</div>
            <div><span>SINAIS FRACOS</span>{report.weakestSignals.length?report.weakestSignals.map(item=><p key={item}><TrendingDown size={12}/>{item}</p>):<p>Sem sinal negativo comparável ainda.</p>}</div>
          </div>}

          {report.diagnoses.map(diagnosis=><section className="performance-diagnosis" key={diagnosis.id}>
            <div className="performance-diagnosis-head"><span>{diagnosis.area.toUpperCase()}</span><b>{diagnosis.confidence}</b></div>
            <h4>{diagnosis.hypothesis}</h4>
            <div><strong>Evidência</strong>{diagnosis.evidence.map(item=><p key={item}>{item}</p>)}</div>
            <div><strong>Explicação concorrente</strong><p>{diagnosis.competingExplanation}</p></div>
            <div className="next-test"><Sparkles size={13}/><p><strong>Próximo teste:</strong> {diagnosis.nextTest}</p></div>
          </section>)}

          {report.retentionEvents.length>0&&<section className="performance-retention">
            <span>RETENÇÃO · MAIORES MUDANÇAS</span>
            <div>{report.retentionEvents.map((event,index)=><em key={index} className={event.type}>
              {event.type==='drop'?'▼':'▲'} {event.fromSecond.toFixed(0)}–{event.toSecond.toFixed(0)}s · {event.deltaPercentPoints.toFixed(1)} p.p.
            </em>)}</div>
          </section>}

          {report.trafficSummary.length>0&&<section className="performance-traffic">
            <span>FONTES DE TRÁFEGO</span>
            <div>{report.trafficSummary.slice(0,8).map(item=><em key={item.source}>{item.source}<b>{item.viewSharePercent===null?'—':item.viewSharePercent.toFixed(1)+'%'}</b></em>)}</div>
          </section>}

          {report.limitations.length>0&&<section className="performance-limitations">
            <span>LIMITAÇÕES</span>
            {report.limitations.map(item=><p key={item}><AlertTriangle size={12}/>{item}</p>)}
          </section>}

          <footer>
            <div><span>HANDOFF → {report.handoff.nextAgent}</span><p>{report.handoff.question}</p></div>
            {report.status!=='approved'?<div className="performance-approve">
              <input value={notes[report.id]??''} onChange={e=>setNotes(prev=>({...prev,[report.id]:e.target.value}))} placeholder="Nota opcional do operador"/>
              <button className="button primary" disabled={busy==='approve:'+report.id} onClick={()=>void action({action:'approve',reportId:report.id,expectedVersion:report.version,notes:notes[report.id]??''},'approve:'+report.id)}><ShieldCheck size={14}/>{busy==='approve:'+report.id?'Aprovando…':'Aprovar + aprender'}</button>
            </div>:applied
              ?<div className="performance-approved"><CheckCircle2 size={15}/>Learning Loop aplicado · Brain v{state.learningLoop.brainVersion}</div>
              :<div className="performance-approve">
                <span className="performance-approved"><CheckCircle2 size={15}/>Report aprovado</span>
                <button className="button primary small" disabled={busy==='apply:'+report.id} onClick={()=>void action({action:'apply-learning-loop',reportId:report.id},'apply:'+report.id)}><Sparkles size={13}/>{busy==='apply:'+report.id?'Aplicando…':'Aplicar ao Brain'}</button>
              </div>}
          </footer>
        </article>;
      })}</div>
      {!state.reports.length&&<div className="performance-empty"><BarChart3 size={28}/><h3>Nenhum Performance Report.</h3><p>Publique um vídeo e colete o primeiro snapshot de Analytics.</p></div>}
    </section>
  </div>;
}

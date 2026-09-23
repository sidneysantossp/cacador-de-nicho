'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, BrainCircuit, CheckCircle2, LoaderCircle,
  MessageCircle, RefreshCw, ShieldCheck, Sparkles
} from 'lucide-react';
import type {
  AudienceIntelligenceReport, ManagedChannel, PerformanceReport
} from '@/lib/types';

type SampleItem={ref:string;text:string;likes:number};
type State={
  reports:AudienceIntelligenceReport[];
  eligiblePerformanceReports:PerformanceReport[];
  samples:Record<string,SampleItem[]>;
  learningLoop:{
    brainVersion:number;
    audienceLearningCount:number;
    appliedReportIds:string[];
    noEligibleLearningReportIds:string[];
  };
};
const EMPTY:State={
  reports:[],eligiblePerformanceReports:[],samples:{},
  learningLoop:{brainVersion:0,audienceLearningCount:0,appliedReportIds:[],noEligibleLearningReportIds:[]}
};

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function sentimentLabel(value:string){
  return ({positive:'Positivo',neutral:'Neutro',negative:'Negativo',mixed:'Misto'} as Record<string,string>)[value]??value;
}

export default function AudienceIntelligenceWorkspace({channel}:{channel:ManagedChannel}){
  const [state,setState]=useState<State>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/audience-intelligence?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Audience Intelligence.');
      setState({
        reports:body.reports??[],
        eligiblePerformanceReports:body.eligiblePerformanceReports??[],
        samples:body.samples??{},
        learningLoop:{
          brainVersion:Number(body.learningLoop?.brainVersion??0),
          audienceLearningCount:Number(body.learningLoop?.audienceLearningCount??0),
          appliedReportIds:Array.isArray(body.learningLoop?.appliedReportIds)?body.learningLoop.appliedReportIds:[],
          noEligibleLearningReportIds:Array.isArray(body.learningLoop?.noEligibleLearningReportIds)?body.learningLoop.noEligibleLearningReportIds:[]
        }
      });
      setNotes(prev=>{
        const next={...prev};
        for(const report of body.reports??[]){
          if(next[report.id]===undefined)next[report.id]=report.review?.notes??'';
        }
        return next;
      });
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Audience Intelligence.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  async function action(payload:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/audience-intelligence',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha na Audience Intelligence.');
      setMessage(body.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha na Audience Intelligence.');
    }finally{setBusy('');}
  }

  if(loading)return <div className="audience-loading"><LoaderCircle className="spin" size={19}/>Carregando Audience Intelligence…</div>;

  return <div className="audience-intelligence">
    {message&&<div className="audience-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="audience-hero">
      <div>
        <span>AUDIENCE INTELLIGENCE</span>
        <h2>Comentários viram sinais editoriais rastreáveis.</h2>
        <p>O sistema classifica a amostra real sem seguir instruções contidas nos comentários. Cada tema precisa apontar para comentários existentes e só temas recorrentes com confiança suficiente entram no Channel Brain.</p>
      </div>
      <div className="audience-brain-state">
        <BrainCircuit size={20}/>
        <strong>Brain v{state.learningLoop.brainVersion}</strong>
        <span>{state.learningLoop.audienceLearningCount} learning(s) de audiência</span>
      </div>
    </section>

    <section className="audience-eligible">
      <div className="audience-section-head">
        <div><span>PERFORMANCE REPORTS APROVADOS</span><h3>Amostras prontas para interpretar.</h3><p>Somente reports aprovados cuja observação contém comentários aparecem aqui.</p></div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={13}/>Atualizar</button>
      </div>
      <div className="audience-eligible-list">
        {state.eligiblePerformanceReports.map(report=><article key={report.id}>
          <div><strong>Performance Report v{report.version}</strong><span>{report.episodeId} · observado {when(report.observedAt)}</span></div>
          <button className="button primary small" disabled={busy==='generate:'+report.id} onClick={()=>void action({action:'generate',performanceReportId:report.id},'generate:'+report.id)}>
            {busy==='generate:'+report.id?<LoaderCircle className="spin" size={13}/>:<Sparkles size={13}/>}
            Analisar comentários
          </button>
        </article>)}
        {!state.eligiblePerformanceReports.length&&<div className="audience-empty-inline">Nenhuma nova amostra aprovada aguardando análise.</div>}
      </div>
    </section>

    <section className="audience-reports">
      <div className="audience-section-head"><div><span>REPORTS</span><h3>Temas, dúvidas e sentimento da amostra.</h3></div></div>

      <div className="audience-report-list">{state.reports.map(report=>{
        const sample=state.samples[report.id]??[];
        const byRef=new Map(sample.map(item=>[item.ref,item]));
        const applied=state.learningLoop.appliedReportIds.includes(report.id);
        const nothingToApply=state.learningLoop.noEligibleLearningReportIds.includes(report.id);

        return <article className={'audience-report '+report.status} key={report.id}>
          <header>
            <div><span>REPORT v{report.version} · {report.status.toUpperCase()}</span><h3>{report.externalVideoId??'Amostra de comentários'}</h3><p>{report.sampleSize} comentário(s) na amostra · {report.analyzedCommentRefs.length} classificado(s)</p></div>
            <div className="audience-summary"><b>{report.themes.length}</b><small>tema(s)</small></div>
          </header>

          <div className="audience-sentiment">
            {Object.entries(report.sentimentSampleCounts).map(([key,value])=><div key={key}><span>{sentimentLabel(key)}</span><strong>{value}</strong></div>)}
          </div>

          <div className="audience-theme-list">{report.themes.map(theme=><section key={theme.id} className={'audience-theme '+theme.confidence}>
            <div className="audience-theme-head"><span>{theme.kind.toUpperCase()}</span><b>{theme.confidence}</b></div>
            <h4>{theme.label}</h4>
            <p>{theme.insight}</p>
            <div className="audience-theme-meta"><em>{theme.commentRefs.length}/{report.sampleSize} da amostra · {theme.sampleSharePercent.toFixed(1)}%</em><em>{theme.totalLikesInEvidence} like(s) nas evidências</em></div>
            <div className="audience-evidence">
              <strong>Evidências reais</strong>
              {theme.commentRefs.slice(0,5).map(ref=>{
                const item=byRef.get(ref);
                return item?<blockquote key={ref}><span>{ref} · {item.likes} like(s)</span><p>{item.text}</p></blockquote>:null;
              })}
            </div>
            <div className="audience-next"><Sparkles size={12}/><p><strong>Próximo teste:</strong> {theme.nextAction}</p></div>
          </section>)}</div>

          {report.limitations.length>0&&<div className="audience-limitations">
            <span>LIMITAÇÕES</span>
            {report.limitations.map(item=><p key={item}><AlertTriangle size={12}/>{item}</p>)}
          </div>}

          <footer>
            <div><MessageCircle size={14}/><span>{report.provenance.sourceLabel}</span></div>
            {report.status!=='approved'?<div className="audience-approve">
              <input value={notes[report.id]??''} onChange={e=>setNotes(prev=>({...prev,[report.id]:e.target.value}))} placeholder="Nota opcional do operador"/>
              <button className="button primary" disabled={busy==='approve:'+report.id} onClick={()=>void action({action:'approve',reportId:report.id,expectedVersion:report.version,notes:notes[report.id]??''},'approve:'+report.id)}><ShieldCheck size={14}/>{busy==='approve:'+report.id?'Aprovando…':'Aprovar + aprender'}</button>
            </div>:nothingToApply
              ?<div className="audience-approved muted"><CheckCircle2 size={15}/>Aprovado · sem tema medium/high</div>
              :applied
                ?<div className="audience-approved"><CheckCircle2 size={15}/>Learning Loop aplicado · Brain v{state.learningLoop.brainVersion}</div>
                :<button className="button primary small" disabled={busy==='apply:'+report.id} onClick={()=>void action({action:'apply-learning-loop',reportId:report.id},'apply:'+report.id)}><Sparkles size={13}/>{busy==='apply:'+report.id?'Aplicando…':'Aplicar ao Brain'}</button>}
          </footer>
        </article>;
      })}</div>

      {!state.reports.length&&<div className="audience-empty"><MessageCircle size={28}/><h3>Nenhum Audience Report ainda.</h3><p>Depois que um Performance Report aprovado tiver comentários, a amostra poderá ser analisada aqui.</p></div>}
    </section>
  </div>;
}

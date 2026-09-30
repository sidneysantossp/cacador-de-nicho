'use client';

import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Gauge, Users } from 'lucide-react';
import type { FactoryControlState, FactoryOperationStatus } from '@/lib/factory-control';
import type { ResearchContext } from '@/lib/types';

const statusLabel:Record<FactoryOperationStatus,string>={
 ready:'READY',processing:'PROCESSING',blocked:'BLOCKED',review:'REVIEW',completed:'COMPLETED',failed:'FAILED'
};

function compact(value:number|null){
 if(value===null)return '—';
 return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
}
function pct(value:number|null){return value===null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';}
function money(value:number|null){return value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);}
function parseState(context?:ResearchContext):FactoryControlState|null{
 if(!context)return null;
 try{return JSON.parse(context.content) as FactoryControlState;}catch{return null;}
}

export default function FactoryControlWorkspace({context}:{context?:ResearchContext}){
 const state=parseState(context);
 if(!state)return <section className="factory-empty"><Bot size={30}/><h3>Factory Control ainda não possui snapshot.</h3><p>Assim que a operação registrar episódios e agentes, o painel aparece aqui.</p></section>;

 const activeAgents=state.agents.filter(agent=>agent.status==='active');
 const performance=new Map(state.performance.map(item=>[item.agentId,item]));
 const currentFor=(agentId:string)=>state.operations.find(item=>item.agentId===agentId&&['processing','blocked','review'].includes(item.status))
  ??state.operations.find(item=>item.agentId===agentId&&item.status==='ready');

 return <div className="factory-control">
  <section className="factory-summary">
   <div><span><Activity size={15}/> Em andamento</span><strong>{state.summary.processing}</strong></div>
   <div><span><Clock3 size={15}/> Prontos</span><strong>{state.summary.ready}</strong></div>
   <div><span><AlertTriangle size={15}/> Bloqueados</span><strong>{state.summary.blocked}</strong></div>
   <div><span><Users size={15}/> Agentes ativos</span><strong>{activeAgents.length}</strong></div>
   <div><span><CheckCircle2 size={15}/> Concluídos</span><strong>{state.summary.completed}</strong></div>
  </section>

  <section className="factory-panel">
   <div className="factory-section-head"><div><span>AGENT REGISTRY</span><h2>Quem está produzindo o quê</h2></div><small>Snapshot {new Date(state.generatedAt).toLocaleString('pt-BR')}</small></div>
   <div className="factory-agent-grid">
    {state.agents.map(agent=>{
     const perf=performance.get(agent.id);
     const current=currentFor(agent.id);
     return <article className="factory-agent-card" key={agent.id}>
      <header><div className="factory-agent-avatar"><Bot size={18}/></div><div><strong>{agent.displayName}</strong><span>{agent.signature} · {agent.role}</span></div><b className={'factory-agent-state '+agent.status}>{agent.status}</b></header>
      <div className="factory-agent-current"><span>AGORA</span>{current?<><strong>{current.videoTitle}</strong><small>{current.channelName} · {current.stageLabel} · {current.progress}%</small></>:<small>Nenhuma operação ativa.</small>}</div>
      <div className="factory-agent-metrics">
       <div><span>Vídeos atribuídos</span><strong>{perf?.attributedEpisodes??0}</strong></div>
       <div><span>Amostra publicada</span><strong>{perf?.publishedSamples??0}</strong></div>
       <div><span>Mediana views</span><strong>{compact(perf?.medianViews??null)}</strong></div>
       <div><span>CTR mediana</span><strong>{pct(perf?.medianCtrPercent??null)}</strong></div>
       <div><span>APV mediana</span><strong>{pct(perf?.medianAveragePercentageViewed??null)}</strong></div>
       <div><span>RPM mediano</span><strong>{money(perf?.medianRpm??null)}</strong></div>
      </div>
     </article>;
    })}
   </div>
  </section>

  <section className="factory-panel">
   <div className="factory-section-head"><div><span>PRODUCTION BOARD</span><h2>Status de cada vídeo</h2></div><small>{state.operations.length} operações</small></div>
   <div className="factory-table-wrap"><table className="factory-table">
    <thead><tr><th>Agente</th><th>Vídeo / canal</th><th>Etapa</th><th>Progresso</th><th>Status</th><th>Atualização</th></tr></thead>
    <tbody>{state.operations.map(item=><tr key={item.id}>
     <td><strong>{item.agentName}</strong><small>{item.agentSignature}</small></td>
     <td><strong>{item.videoTitle}</strong><small>{item.channelName}</small>{item.blocker&&<em>{item.blocker}</em>}</td>
     <td>{item.stageLabel}</td>
     <td><div className="factory-progress"><span style={{width:item.progress+'%'}}/><b>{item.progress}%</b></div></td>
     <td><span className={'factory-status '+item.status}>{statusLabel[item.status]}</span></td>
     <td><small>{new Date(item.updatedAt).toLocaleString('pt-BR')}</small></td>
    </tr>)}</tbody>
   </table></div>
  </section>

  <section className="factory-note"><Gauge size={17}/><span><strong>Leitura de performance por agente.</strong> Compare sempre com tamanho da amostra, canal, nicho e fase do canal. O painel preserva views, CTR, APV e RPM separadamente para não transformar correlação em uma nota opaca.</span></section>
 </div>;
}

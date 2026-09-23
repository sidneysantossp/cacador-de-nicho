'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, BarChart3, BrainCircuit, CheckCircle2, Clock3,
  ExternalLink, Eye, FileSearch, History, RefreshCw, Sparkles, TrendingUp
} from 'lucide-react';
import type { UniverseCompetitor, UniverseMarketIntelligence } from '@/lib/types';

type Tab='overview'|'dna'|'evidence'|'market'|'history';

const statusLabels:Record<UniverseCompetitor['status'],string>={
  'watch':'Watch',
  'heating-up':'Heating Up',
  'breakout':'Breakout',
  'pattern':'Pattern',
  'emerging-curve':'Emerging Curve',
  'structural-curve':'Structural Curve',
  'gap-found':'Gap Found',
  'production-reference':'Production Reference'
};

function compact(n:number|null){
  if(n===null)return '—';
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n);
}
function full(n:number|null){
  if(n===null)return '—';
  return new Intl.NumberFormat('pt-BR').format(n);
}
function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}

export default function ChannelDnaPage({
  competitor,
  intelligence,
  busy,
  onBack,
  onUpdateDna,
  onRefresh,
  onAnalyze
}:{
  competitor:UniverseCompetitor|null;
  intelligence?:UniverseMarketIntelligence|null;
  busy:string;
  onBack:()=>void;
  onUpdateDna:()=>Promise<boolean|undefined>;
  onRefresh:()=>Promise<boolean|undefined>;
  onAnalyze:()=>Promise<void>;
}){
  const [tab,setTab]=useState<Tab>('overview');

  const curves=useMemo(
    ()=>competitor?(intelligence?.curves??[]).filter(curve=>curve.supportingChannelIds.includes(competitor.channelId)):[],
    [competitor,intelligence]
  );
  const curveIds=useMemo(()=>new Set(curves.map(curve=>curve.id)),[curves]);
  const gaps=useMemo(
    ()=>competitor?(intelligence?.gaps??[]).filter(gap=>curveIds.has(gap.curveId)||gap.targetEvidenceChannelIds.includes(competitor.channelId)):[],
    [competitor,intelligence,curveIds]
  );

  if(!competitor)return <section className="dna-result-empty">
    <BrainCircuit size={30}/>
    <h2>Canal não encontrado.</h2>
    <p>O registro pode ter sido atualizado ou removido do Universe.</p>
    <button className="button primary" onClick={onBack}><ArrowLeft size={16}/>Voltar ao Universe</button>
  </section>;

  const dna=competitor.dna;
  if(!dna)return <section className="dna-result-empty">
    <BrainCircuit size={30}/>
    <h2>{competitor.name} ainda não possui Channel DNA.</h2>
    <p>Gere o DNA primeiro para abrir a página completa de resultados.</p>
    <div className="dna-result-actions">
      <button className="button subtle" onClick={onBack}><ArrowLeft size={16}/>Voltar</button>
      <button className="button primary" disabled={!!busy} onClick={()=>void onUpdateDna()}><Sparkles size={16}/>Gerar DNA</button>
    </div>
  </section>;

  const tabs:Array<{id:Tab;label:string;icon:React.ReactNode}>=[
    {id:'overview',label:'Visão geral',icon:<Eye size={15}/>},
    {id:'dna',label:'DNA',icon:<BrainCircuit size={15}/>},
    {id:'evidence',label:'Evidências',icon:<FileSearch size={15}/>},
    {id:'market',label:'Curves & Gaps',icon:<TrendingUp size={15}/>},
    {id:'history',label:'Histórico',icon:<History size={15}/>}
  ];

  return <div className="dna-result-page">
    <div className="dna-result-back">
      <button onClick={onBack}><ArrowLeft size={16}/>Competitor Universe</button>
      <span>CHANNEL DNA / COMPETITOR INTELLIGENCE</span>
    </div>

    <section className="dna-result-hero">
      <div className="dna-result-identity">
        {competitor.avatar?<img src={competitor.avatar} alt=""/>:<span>{competitor.name.slice(0,2).toUpperCase()}</span>}
        <div>
          <div className="dna-result-title-line">
            <h1>{competitor.name}</h1>
            <span className="dna-result-ready">DNA READY</span>
          </div>
          <p>{competitor.handle||competitor.channelId}</p>
          <div className="dna-result-chips">
            <em>{dna.primaryNiche}</em>
            <em>{dna.subniche}</em>
            <em>{dna.formatSignature}</em>
            <em className="status">{statusLabels[competitor.status]}</em>
          </div>
        </div>
      </div>
      <div className="dna-result-actions">
        <button className="button subtle" disabled={!!busy} onClick={()=>void onRefresh()}><RefreshCw size={15}/>Atualizar dados</button>
        <button className="button subtle" disabled={!!busy} onClick={()=>void onUpdateDna()}><Sparkles size={15}/>Atualizar DNA</button>
        <button className="button subtle" disabled={!!busy} onClick={()=>void onAnalyze()}><BrainCircuit size={15}/>Abrir Anatomia</button>
        <a className="button primary" href={competitor.url} target="_blank" rel="noreferrer">YouTube <ArrowUpRight size={15}/></a>
      </div>
    </section>

    <section className="dna-result-kpis">
      <div><span>INSCRITOS</span><strong>{compact(competitor.subscribers)}</strong><small>{full(competitor.subscribers)}</small></div>
      <div><span>VÍDEOS</span><strong>{competitor.videoCount}</strong><small>{competitor.recentVideoCount} na amostra</small></div>
      <div><span>MEDIANA RECENTE</span><strong>{compact(competitor.recentMedianViews)}</strong><small>{full(competitor.recentMedianViews)} views</small></div>
      <div><span>MÉDIA RECENTE</span><strong>{compact(competitor.recentAverageViews)}</strong><small>{full(competitor.recentAverageViews)} views</small></div>
      <div><span>BREAKOUT</span><strong>{competitor.breakoutRatio!==null?`${competitor.breakoutRatio.toFixed(1)}×`:'—'}</strong><small>melhor vídeo / inscritos</small></div>
      <div><span>SINAIS</span><strong>{competitor.signalDetails?.length??competitor.signals.length}</strong><small>{competitor.monitoringTier} monitoring</small></div>
    </section>

    <nav className="dna-result-tabs" aria-label="Seções do Channel DNA">
      {tabs.map(item=><button key={item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.icon}{item.label}{item.id==='market'&&(curves.length+gaps.length)>0&&<b>{curves.length+gaps.length}</b>}</button>)}
    </nav>

    {tab==='overview'&&<div className="dna-result-content">
      <section className="dna-result-summary">
        <span>RESUMO EXECUTIVO</span>
        <h2>O que define este canal.</h2>
        <p>{dna.summary}</p>
        <div className="dna-result-summary-meta">
          <span><Clock3 size={14}/>DNA gerado em {when(dna.generatedAt)}</span>
          {dna.provenance&&<span><CheckCircle2 size={14}/>{dna.provenance.generatedBy}{dna.provenance.model?` · ${dna.provenance.model}`:''} · schema v{dna.provenance.schemaVersion}</span>}
        </div>
      </section>

      <div className="dna-result-two-col">
        <section className="dna-result-card accent">
          <span>INTENÇÃO DA AUDIÊNCIA</span>
          <h3>Por que alguém escolhe assistir.</h3>
          <p>{dna.audienceIntent}</p>
        </section>
        <section className="dna-result-card purple">
          <span>PROMESSA EDITORIAL</span>
          <h3>O contrato que o canal repete.</h3>
          <p>{dna.editorialPromise}</p>
        </section>
      </div>

      <div className="dna-result-two-col">
        <ListCard title="PILARES DE CONTEÚDO" items={dna.contentPillars}/>
        <ListCard title="MECANISMOS DE CURIOSIDADE" items={dna.curiosityMechanisms}/>
      </div>

      {competitor.strongestRecentVideo&&<section className="dna-result-best-video">
        <div className="dna-result-best-thumb" style={{backgroundImage:`url("${competitor.strongestRecentVideo.thumbnail}")`}}/>
        <div>
          <span>MELHOR VÍDEO DA AMOSTRA</span>
          <h3>{competitor.strongestRecentVideo.title}</h3>
          <p>{compact(competitor.strongestRecentVideo.views)} visualizações · publicado em {new Date(competitor.strongestRecentVideo.publishedAt).toLocaleDateString('pt-BR')}</p>
          <a href={competitor.strongestRecentVideo.url} target="_blank" rel="noreferrer">Abrir vídeo <ExternalLink size={14}/></a>
        </div>
      </section>}
    </div>}

    {tab==='dna'&&<div className="dna-result-content">
      <div className="dna-result-two-col">
        <TagCard title="PILARES DE CONTEÚDO" items={dna.contentPillars}/>
        <TagCard title="ENTIDADES RECORRENTES" items={dna.recurringEntities}/>
      </div>
      <NumberedCard title="PADRÕES DE TÍTULOS" items={dna.titlePatterns}/>
      <div className="dna-result-two-col">
        <NumberedCard title="MECANISMOS DE CURIOSIDADE" items={dna.curiosityMechanisms}/>
        <TagCard title="DRIVERS EMOCIONAIS" items={dna.emotionalDrivers}/>
      </div>
      <NumberedCard title="SINAIS DE DIFERENCIAÇÃO" items={dna.differentiationSignals}/>
      <section className="dna-result-card warning">
        <span>LIMITAÇÕES / O QUE NÃO PODEMOS CONCLUIR</span>
        <h3>Fronteiras da análise.</h3>
        <ul>{dna.limitations.map(item=><li key={item}>{item}</li>)}</ul>
      </section>
      {dna.provenance&&<section className="dna-result-audit">
        <span>PROCEDÊNCIA / AUDITORIA</span>
        <div>
          <strong>{dna.provenance.generatedBy}</strong><small>gerado por</small>
          <strong>{dna.provenance.model??'—'}</strong><small>modelo</small>
          <strong>v{dna.provenance.schemaVersion}</strong><small>schema</small>
          <strong>{dna.provenance.sourceVideoCount}</strong><small>vídeos usados</small>
          <strong>{dna.provenance.sourceSignalCount}</strong><small>sinais usados</small>
          <strong>{when(dna.provenance.observedAt)}</strong><small>snapshot</small>
        </div>
      </section>}
    </div>}

    {tab==='evidence'&&<div className="dna-result-content">
      <section className="dna-result-card">
        <span>SINAIS OBSERVADOS</span>
        <h3>Evidência antes da interpretação.</h3>
        <div className="dna-result-signals">{(competitor.signalDetails??[]).map(signal=><article key={signal.title}>
          <div><b>{signal.strength}</b><span>{signal.title}</span></div>
          <p>{signal.evidence}</p>
          <small>{when(signal.observedAt)}</small>
        </article>)}</div>
      </section>

      <section className="dna-result-card">
        <span>UPLOADS DA AMOSTRA</span>
        <h3>{competitor.recentUploads.length} vídeos usados para observar o canal.</h3>
        <div className="dna-result-video-table">
          {competitor.recentUploads.map((video,index)=><a key={video.id} href={video.url} target="_blank" rel="noreferrer">
            <b>{String(index+1).padStart(2,'0')}</b>
            <div><strong>{video.title}</strong><small>{new Date(video.publishedAt).toLocaleDateString('pt-BR')} · {video.duration}</small></div>
            <span>{compact(video.views)} views</span>
            <ArrowUpRight size={15}/>
          </a>)}
        </div>
      </section>
    </div>}

    {tab==='market'&&<div className="dna-result-content">
      <section className="dna-result-market-head">
        <div><span>MARKET INTELLIGENCE</span><h2>Como este DNA participa do mapa de mercado.</h2></div>
        <div><strong>{curves.length}</strong><small>curvas relacionadas</small><strong>{gaps.length}</strong><small>gaps relacionados</small></div>
      </section>

      {!curves.length&&!gaps.length&&<section className="dna-result-card"><h3>Ainda não há Curves & Gaps relacionados.</h3><p>O DNA está persistido, mas ainda não participou de uma inteligência de mercado consolidada.</p></section>}

      {curves.map(curve=><section className="dna-result-curve" key={curve.id}>
        <div className="dna-result-curve-head"><div><span>CURVE · {curve.classification.toUpperCase()}</span><h3>{curve.name}</h3></div><strong>{curve.independentCreators} criador(es)</strong></div>
        <p>{curve.thesis}</p>
        <div className="dna-result-two-col compact">
          <div><span>MECANISMO</span><ol>{curve.mechanismSteps.map(step=><li key={step}>{step}</li>)}</ol></div>
          <div><span>VARIÁVEIS TRANSFERÍVEIS</span><div className="dna-result-tags">{curve.transferableVariables.map(item=><em key={item}>{item}</em>)}</div></div>
        </div>
      </section>)}

      {gaps.map(gap=><section className="dna-result-gap" key={gap.id}>
        <div><span>GAP · {gap.demandStatus.toUpperCase()} · SATURAÇÃO {gap.sampleSaturation.toUpperCase()}</span><h3>{gap.title}</h3><p>{gap.rationale}</p></div>
        <dl><dt>Preserva</dt><dd>{gap.preservedMechanism}</dd><dt>Muda</dt><dd>{gap.changedVariable}</dd><dt>Target</dt><dd>{gap.targetSpace}</dd></dl>
        <div className="dna-result-tests"><span>PRIMEIROS TESTES</span><ol>{gap.firstTests.map(item=><li key={item}>{item}</li>)}</ol></div>
      </section>)}
    </div>}

    {tab==='history'&&<div className="dna-result-content">
      <section className="dna-result-card">
        <span>HISTÓRICO DE SNAPSHOTS</span>
        <h3>Evolução observada do canal.</h3>
        <div className="dna-result-snapshots">{[...(competitor.snapshots??[])].reverse().map((snapshot,index)=><article key={snapshot.observedAt}>
          <div className="dna-result-snapshot-index">{String(index+1).padStart(2,'0')}</div>
          <div><strong>{when(snapshot.observedAt)}</strong><small>snapshot</small></div>
          <div><strong>{compact(snapshot.subscribers)}</strong><small>inscritos</small></div>
          <div><strong>{snapshot.videoCount}</strong><small>vídeos</small></div>
          <div><strong>{compact(snapshot.recentMedianViews)}</strong><small>mediana</small></div>
          <div><strong>{snapshot.uploadsLast30d}</strong><small>uploads 30d</small></div>
        </article>)}</div>
      </section>
    </div>}
  </div>;
}

function TagCard({title,items}:{title:string;items:string[]}){
  return <section className="dna-result-card"><span>{title}</span><div className="dna-result-tags">{items.map(item=><em key={item}>{item}</em>)}</div></section>;
}
function ListCard({title,items}:{title:string;items:string[]}){
  return <section className="dna-result-card"><span>{title}</span><ul>{items.map(item=><li key={item}>{item}</li>)}</ul></section>;
}
function NumberedCard({title,items}:{title:string;items:string[]}){
  return <section className="dna-result-card"><span>{title}</span><ol className="dna-result-numbered">{items.map(item=><li key={item}>{item}</li>)}</ol></section>;
}

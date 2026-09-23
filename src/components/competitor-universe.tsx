'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, BrainCircuit, FileUp, Flame, Globe2, Layers3, RefreshCw, Search, Sparkles, TrendingUp, UsersRound, Video, X } from 'lucide-react';
import type { UniverseCompetitor, UniverseCompetitorStatus } from '@/lib/types';

function compact(value:number|null){
  if(value===null)return '—';
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
}
function relativeDate(value:string){
  const hours=Math.max(0,Math.floor((Date.now()-Date.parse(value))/3600000));
  if(hours<24)return `${Math.max(1,hours)}h`;
  const days=Math.floor(hours/24);
  return `${days}d`;
}
const statusMeta:Record<UniverseCompetitorStatus,{label:string;className:string;rank:number}>={
  'production-reference':{label:'Production Reference',className:'production',rank:8},
  'gap-found':{label:'Gap Found',className:'gap',rank:7},
  'structural-curve':{label:'Structural Curve',className:'structural',rank:6},
  'emerging-curve':{label:'Emerging Curve',className:'emerging',rank:5},
  'pattern':{label:'Pattern',className:'pattern',rank:4},
  'breakout':{label:'Breakout',className:'breakout',rank:3},
  'heating-up':{label:'Heating Up',className:'heating',rank:2},
  'watch':{label:'Watch',className:'watch',rank:1}
};

function extractInputs(text:string){
  const found:string[]=[];
  for(const rawLine of text.split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line)continue;
    const url=line.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/UC[\w-]+|user\/[\w.-]+|@[\w.-]+)/i)?.[0];
    if(url){found.push(url.replace(/[),;"']+$/,''));continue;}
    const channelId=line.match(/\bUC[\w-]{20,}\b/)?.[0];
    if(channelId){found.push(channelId);continue;}
    const handle=line.match(/(?:^|[\s,;"])@[\w.-]{2,}/)?.[0]?.trim().replace(/^[,;"]+/,'');
    if(handle){found.push(handle);}
  }
  return [...new Set(found)];
}

function CompetitorCard({
  competitor,
  busy,
  onRefresh,
  onAnalyze
}:{
  competitor:UniverseCompetitor;
  busy:string;
  onRefresh:(ids:string[])=>Promise<boolean|undefined>;
  onAnalyze:(competitor:UniverseCompetitor)=>Promise<void>;
}){
  const status=statusMeta[competitor.status];
  const best=competitor.strongestRecentVideo;
  return <article className={`universe-card status-${status.className}`}>
    <div className="universe-card-head">
      <div className="universe-identity">
        {competitor.avatar?<img src={competitor.avatar} alt="" className="universe-avatar"/>:<span className="universe-avatar placeholder">{competitor.name.slice(0,2).toUpperCase()}</span>}
        <div><h3>{competitor.name}</h3><p>{competitor.handle||competitor.channelId}</p></div>
      </div>
      <span className={`universe-status ${status.className}`}>{status.label}</span>
    </div>

    <div className="universe-meta">
      <span>{competitor.country||'—'}</span><span>{competitor.language?.toUpperCase()||'LANG —'}</span><span>{competitor.format}</span>
    </div>

    <div className="universe-metrics">
      <div><small>INSCRITOS</small><strong>{compact(competitor.subscribers)}</strong></div>
      <div><small>VÍDEOS</small><strong>{compact(competitor.videoCount)}</strong></div>
      <div><small>MÉDIA RECENTE</small><strong>{compact(competitor.recentAverageViews)}</strong></div>
      <div><small>30 DIAS</small><strong>{competitor.uploadsLast30d}</strong></div>
    </div>

    {best?<a className="universe-best-video" href={best.url} target="_blank" rel="noreferrer">
      {best.thumbnail&&<img src={best.thumbnail} alt=""/>}
      <div><span>MELHOR VÍDEO DA AMOSTRA</span><strong>{best.title}</strong><p>{compact(best.views)} views · {relativeDate(best.publishedAt)}{competitor.breakoutRatio!==null?` · ${competitor.breakoutRatio.toFixed(1)}× inscritos`:''}</p></div>
    </a>:<div className="universe-best-video empty"><Video size={20}/><span>Nenhum upload público carregado nesta rodada.</span></div>}

    <div className="universe-intel-block dna">
      <span>CHANNEL DNA</span>
      <div className="universe-tags">{competitor.dnaTags.length?competitor.dnaTags.slice(0,5).map(tag=><em key={tag}>{tag}</em>):<em>DNA pendente</em>}</div>
    </div>

    <div className="universe-intel-block signal">
      <span>CURRENT SIGNAL</span>
      <p>{competitor.signals[0]??'Nenhum sinal anormal sustentado pela amostra recente.'}</p>
      {competitor.signals.length>1&&<small>+{competitor.signals.length-1} sinal(is) observado(s)</small>}
    </div>

    <div className="universe-intel-block gap">
      <span>GAP</span>
      <p>{competitor.gapSummary??'Gap Engine ainda não executado para este concorrente.'}</p>
    </div>

    <div className="universe-card-actions">
      <button className="button subtle small" disabled={!!busy} onClick={()=>void onAnalyze(competitor)}><BrainCircuit size={14}/>Anatomia</button>
      <button className="button subtle small" disabled={!!busy} onClick={()=>void onRefresh([competitor.id])}><RefreshCw size={14}/>Atualizar</button>
      <a className="button subtle small" href={competitor.url} target="_blank" rel="noreferrer">YouTube <ArrowUpRight size={14}/></a>
    </div>
  </article>;
}

export default function CompetitorUniverse({
  competitors,
  mode,
  busy,
  onImport,
  onRefresh,
  onAnalyze
}:{
  competitors:UniverseCompetitor[];
  mode:'demo'|'live';
  busy:string;
  onImport:(inputs:string[])=>Promise<void>;
  onRefresh:(ids:string[])=>Promise<boolean|undefined>;
  onAnalyze:(competitor:UniverseCompetitor)=>Promise<void>;
}){
  const [query,setQuery]=useState('');
  const [cluster,setCluster]=useState('Todos');
  const [status,setStatus]=useState('Todos');
  const [showImport,setShowImport]=useState(false);
  const [importText,setImportText]=useState('');
  const parsed=useMemo(()=>extractInputs(importText),[importText]);
  const clusters=useMemo(()=>[...new Set(competitors.map(item=>item.cluster||'A classificar'))].sort(),[competitors]);
  const visible=useMemo(()=>competitors
    .filter(item=>(cluster==='Todos'||item.cluster===cluster)&&(status==='Todos'||item.status===status)&&(`${item.name} ${item.handle} ${item.cluster} ${item.subniche} ${item.description}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a,b)=>statusMeta[b.status].rank-statusMeta[a.status].rank||(b.breakoutRatio??0)-(a.breakoutRatio??0)),[competitors,cluster,status,query]);
  const grouped=useMemo(()=>{
    const map=new Map<string,UniverseCompetitor[]>();
    for(const item of visible){
      const key=item.cluster||'A classificar';
      map.set(key,[...(map.get(key)??[]),item]);
    }
    return [...map.entries()].sort((a,b)=>b[1].length-a[1].length);
  },[visible]);
  const now=Date.now();
  const newVideos24h=competitors.reduce((sum,item)=>sum+item.recentUploads.filter(video=>now-Date.parse(video.publishedAt)<=86400000).length,0);
  const signals=competitors.filter(item=>item.signals.length>0).length;
  const breakout=competitors.filter(item=>item.status==='breakout').length;
  const heating=competitors.filter(item=>item.status==='heating-up').length;
  const gaps=competitors.filter(item=>!!item.gapSummary).length;

  return <div className="universe-page">
    <section className="universe-hero">
      <div>
        <span className="eyebrow">COMPETITOR UNIVERSE / MARKET INTELLIGENCE</span>
        <h2>Veja o mercado como um <span>mapa de oportunidades.</span></h2>
        <p>Concorrentes conhecidos são monitorados como evidência de mercado. O objetivo não é copiar canais: é detectar sinais, curvas e lacunas que merecem virar produção.</p>
      </div>
      <div className="universe-hero-actions">
        <button className="button subtle" disabled={mode==='demo'||!!busy||!competitors.length} onClick={()=>void onRefresh([])}><RefreshCw size={16}/>{busy==='universeRefresh'?'Atualizando…':'Atualizar atrasados'}</button>
        <button className="button primary" disabled={mode==='demo'||!!busy} onClick={()=>setShowImport(true)}><FileUp size={16}/>Importar concorrentes</button>
      </div>
    </section>

    <section className="universe-summary">
      <div><UsersRound size={18}/><span>MONITORADOS</span><strong>{competitors.length}</strong></div>
      <div><Video size={18}/><span>NOVOS VÍDEOS 24H</span><strong>{newVideos24h}</strong></div>
      <div><Sparkles size={18}/><span>COM SINAL</span><strong>{signals}</strong></div>
      <div><TrendingUp size={18}/><span>BREAKOUT</span><strong>{breakout}</strong></div>
      <div><Flame size={18}/><span>HEATING UP</span><strong>{heating}</strong></div>
      <div><Layers3 size={18}/><span>GAPS REGISTRADOS</span><strong>{gaps}</strong></div>
    </section>

    <div className="universe-filterbar">
      <label><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar concorrente, nicho, formato…"/></label>
      <select value={cluster} onChange={e=>setCluster(e.target.value)}><option>Todos</option>{clusters.map(item=><option key={item}>{item}</option>)}</select>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option>Todos</option>{Object.entries(statusMeta).map(([key,value])=><option value={key} key={key}>{value.label}</option>)}</select>
      <span>{visible.length} de {competitors.length}</span>
    </div>

    {!competitors.length?<section className="universe-empty">
      <Globe2 size={32}/><h3>Seu Competitor Universe está vazio.</h3><p>Importe URLs, @handles ou channelIds. O onboarding inicial não usa search.list e cria os primeiros cards a partir dos uploads públicos recentes.</p>
      <button className="button primary" disabled={mode==='demo'} onClick={()=>setShowImport(true)}><FileUp size={16}/>Importar primeiros canais</button>
    </section>:grouped.map(([name,items])=><section className="universe-cluster" key={name}>
      <div className="universe-cluster-head">
        <div><span className="eyebrow">CLUSTER</span><h2>{name}</h2></div>
        <p>{items.length} canal(is) · {items.filter(item=>item.signals.length).length} com sinal · {items.filter(item=>item.status==='breakout').length} breakout</p>
      </div>
      <div className="universe-grid">{items.map(item=><CompetitorCard key={item.id} competitor={item} busy={busy} onRefresh={onRefresh} onAnalyze={onAnalyze}/>)}</div>
    </section>)}

    {showImport&&<div className="universe-import-overlay" role="presentation">
      <section className="universe-import-panel">
        <button className="universe-import-close" onClick={()=>setShowImport(false)} aria-label="Fechar"><X size={18}/></button>
        <span className="eyebrow">IMPORT COMPETITORS</span>
        <h2>Construa seu universo conhecido.</h2>
        <p>Cole uma lista ou carregue CSV/TXT. Nesta fase aceitamos URL com <strong>@handle</strong>, URL <strong>/channel/UC…</strong>, <strong>@handle</strong> ou <strong>channelId</strong>. Nomes soltos não gastam search.list: ficam de fora até serem identificados.</p>
        <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder={"https://youtube.com/@channel-one\n@channel-two\nUCxxxxxxxxxxxxxxxxxxxxxx"}/>
        <div className="universe-import-file">
          <label className="button subtle"><FileUp size={15}/>Carregar CSV/TXT<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={async e=>{const file=e.target.files?.[0];if(file)setImportText(await file.text());}}/></label>
          <span>{parsed.length} canal(is) reconhecido(s)</span>
        </div>
        <div className="universe-import-actions">
          <button className="button subtle" onClick={()=>setShowImport(false)}>Cancelar</button>
          <button className="button primary" disabled={!parsed.length||!!busy} onClick={async()=>{await onImport(parsed);setShowImport(false);setImportText('');}}><FileUp size={15}/>{busy==='universeImport'?'Importando…':`Importar ${parsed.length}`}</button>
        </div>
      </section>
    </div>}
  </div>;
}

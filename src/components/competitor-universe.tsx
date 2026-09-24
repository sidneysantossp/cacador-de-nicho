'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, BrainCircuit, FileUp, Globe2, Layers3, RefreshCw, Search, Sparkles, TrendingUp, UsersRound, Video, X } from 'lucide-react';
import type { UniverseCompetitor, UniverseCompetitorStatus, UniverseImportQueueSummary, UniverseMarketIntelligence } from '@/lib/types';

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
  onAnalyze,
  onIntelligence,
  onOpenDna
}:{
  competitor:UniverseCompetitor;
  busy:string;
  onRefresh:(ids:string[])=>Promise<boolean|undefined>;
  onAnalyze:(competitor:UniverseCompetitor)=>Promise<void>;
  onIntelligence:(ids:string[])=>Promise<boolean|undefined>;
  onOpenDna:(competitor:UniverseCompetitor)=>void;
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
      <span>CHANNEL DNA {competitor.dna?'· READY':'· PENDENTE'}</span>
      {competitor.dna&&<p className="universe-dna-summary">{competitor.dna.editorialPromise}</p>}
      <div className="universe-tags">{competitor.dnaTags.length?competitor.dnaTags.slice(0,5).map(tag=><em key={tag}>{tag}</em>):<em>DNA pendente</em>}</div>
      {competitor.dna&&<small>{competitor.dna.audienceIntent}</small>}
    </div>

    <div className="universe-intel-block signal">
      <span>CURRENT SIGNAL</span>
      {competitor.signalDetails?.[0]?<>
        <strong className="universe-signal-title">{competitor.signalDetails[0].title}</strong>
        <p>{competitor.signalDetails[0].evidence}</p>
      </>:<p>{competitor.signals[0]??'Nenhum sinal anormal sustentado pela amostra recente.'}</p>}
      {(competitor.signalDetails?.length??competitor.signals.length)>1&&<small>+{(competitor.signalDetails?.length??competitor.signals.length)-1} sinal(is) observado(s)</small>}
    </div>

    <div className="universe-intel-block gap">
      <span>GAP</span>
      <p>{competitor.gapSummary??'Gap Engine ainda não executado para este concorrente.'}</p>
    </div>

    <div className="universe-card-actions">
      {competitor.dna&&<button className="button subtle small" onClick={()=>onOpenDna(competitor)}><BrainCircuit size={14}/>Ver DNA</button>}
      <button className="button subtle small" disabled={!!busy} onClick={()=>void onIntelligence([competitor.id])}><Sparkles size={14}/>{competitor.dna?'Atualizar DNA':'Gerar DNA'}</button>
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
  onAnalyze,
  onIntelligence,
  intelligence,
  onCurves,
  queue,
  onQueue,
  onCycle,
  onOpenDna
}:{
  competitors:UniverseCompetitor[];
  mode:'demo'|'live';
  busy:string;
  onImport:(inputs:string[])=>Promise<void>;
  onRefresh:(ids:string[])=>Promise<boolean|undefined>;
  onAnalyze:(competitor:UniverseCompetitor)=>Promise<void>;
  onIntelligence:(ids:string[])=>Promise<boolean|undefined>;
  intelligence?:UniverseMarketIntelligence|null;
  onCurves:()=>Promise<boolean|undefined>;
  queue?:UniverseImportQueueSummary|null;
  onQueue:()=>Promise<boolean|undefined>;
  onCycle:()=>Promise<boolean|undefined>;
  onOpenDna:(competitor:UniverseCompetitor)=>void;
}){
  const [query,setQuery]=useState('');
  const [cluster,setCluster]=useState('Todos');
  const [status,setStatus]=useState('Todos');
  const [showImport,setShowImport]=useState(false);
  const [importText,setImportText]=useState('');
  const [section,setSection]=useState<'competitors'|'curves'|'gaps'>('competitors');
  const parsed=useMemo(()=>extractInputs(importText),[importText]);
  const rawEntries=useMemo(()=>importText.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).length,[importText]);
  const duplicateEntries=Math.max(0,rawEntries-parsed.length);
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
  const dnaReady=competitors.filter(item=>!!item.dna).length;
  const dnaPending=Math.max(0,competitors.length-dnaReady);
  const dnaProgressPct=competitors.length?Math.round((dnaReady/competitors.length)*100):0;
  const gaps=intelligence?.gaps.length??0;
  const curves=intelligence?.curves.length??0;
  const competitorName=(channelId:string)=>competitors.find(item=>item.channelId===channelId)?.name??channelId;

  return <div className="universe-page">
    <section className="universe-hero">
      <div>
        <span className="eyebrow">COMPETITOR UNIVERSE / MARKET INTELLIGENCE</span>
        <h2>Veja o mercado como um <span>mapa de oportunidades.</span></h2>
        <p>Concorrentes conhecidos são monitorados como evidência de mercado. O objetivo não é copiar canais: é detectar sinais, curvas e lacunas que merecem virar produção.</p>
      </div>
      <div className="universe-hero-actions">
        <button className="button subtle" disabled={mode==='demo'||!!busy||!competitors.length} onClick={()=>void onRefresh([])}><RefreshCw size={16}/>{busy==='universeRefresh'?'Atualizando…':'Atualizar atrasados'}</button>
        <button className="button subtle" disabled={mode==='demo'||!!busy||!competitors.length||dnaPending===0} onClick={()=>void onIntelligence([])}><Sparkles size={16}/>{busy==='universeIntelligence'?'Analisando…':dnaPending===0?'DNA completo':'Gerar próximo lote DNA'}</button>
        <button className="button subtle" disabled={mode==='demo'||!!busy||!competitors.length} onClick={()=>void onCycle()}><RefreshCw size={16}/>{busy==='universeCycle'?'Executando ciclo…':'Executar ciclo completo'}</button>
        <button className="button subtle" disabled={mode==='demo'||!!busy||dnaReady<2} onClick={()=>void onCurves()}><Layers3 size={16}/>{busy==='universeCurves'?'Extraindo…':'Extrair curvas'}</button>
        <button className="button primary" disabled={mode==='demo'||!!busy} onClick={()=>setShowImport(true)}><FileUp size={16}/>Importar concorrentes</button>
      </div>
    </section>

    <section className="universe-summary">
      <div><UsersRound size={18}/><span>MONITORADOS</span><strong>{competitors.length}</strong></div>
      <div><Video size={18}/><span>NOVOS VÍDEOS 24H</span><strong>{newVideos24h}</strong></div>
      <div><Sparkles size={18}/><span>COM SINAL</span><strong>{signals}</strong></div>
      <div><TrendingUp size={18}/><span>BREAKOUT</span><strong>{breakout}</strong></div>
      <div><BrainCircuit size={18}/><span>DNA PRONTO</span><strong>{dnaReady}</strong></div>
      <div><Layers3 size={18}/><span>GAPS REGISTRADOS</span><strong>{gaps}</strong></div>
    </section>

    {competitors.length>0&&<section className="universe-bootstrap">
      <div className="universe-bootstrap-head">
        <div>
          <span className="eyebrow">CHANNEL DNA / PIPELINE</span>
          <h3>{dnaReady} de {competitors.length} concorrentes com DNA persistido</h3>
          <p>{dnaPending} pendente(s) · lotes de até 5 · prioridade por status, sinais fortes, breakout e atividade recente</p>
        </div>
        <button className="button primary small" disabled={mode==='demo'||!!busy||dnaPending===0} onClick={()=>void onIntelligence([])}>
          <Sparkles size={15}/>{busy==='universeIntelligence'?'Gerando lote…':dnaPending===0?'DNA concluído':'Gerar próximo lote'}
        </button>
      </div>
      <div className="universe-bootstrap-bar"><span style={{width:`${dnaProgressPct}%`}}/></div>
      <small>{dnaProgressPct}% concluído. Canais já analisados não entram novamente nos lotes automáticos; “Atualizar DNA” continua disponível individualmente.</small>
    </section>}

    {queue&&queue.total>0&&<section className="universe-bootstrap">
      <div className="universe-bootstrap-head">
        <div>
          <span className="eyebrow">BOOTSTRAP DO UNIVERSE</span>
          <h3>{queue.completed} de {queue.total} concorrentes processados</h3>
          <p>{queue.pending} pendentes · {queue.processing} em processamento · {queue.failed} com falha · {queue.retryable} elegíveis para retry</p>
        </div>
        <button className="button primary small" disabled={mode==='demo'||!!busy||queue.completed>=queue.total} onClick={()=>void onQueue()}>
          <RefreshCw size={15}/>{busy==='universeQueue'?'Processando lote…':'Processar próximo lote'}
        </button>
      </div>
      <div className="universe-bootstrap-bar"><span style={{width:`${queue.progressPct}%`}}/></div>
      <small>{queue.progressPct}% concluído. Cada lote resolve até 25 canais sem usar search.list.</small>
    </section>}

    <div className="universe-tabs">
      <button className={section==='competitors'?'active':''} onClick={()=>setSection('competitors')}>Competitors <span>{competitors.length}</span></button>
      <button className={section==='curves'?'active':''} onClick={()=>setSection('curves')}>Curves <span>{curves}</span></button>
      <button className={section==='gaps'?'active':''} onClick={()=>setSection('gaps')}>Gaps <span>{gaps}</span></button>
    </div>

    {section==='competitors'&&<>
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
      <div className="universe-grid">{items.map(item=><CompetitorCard key={item.id} competitor={item} busy={busy} onRefresh={onRefresh} onAnalyze={onAnalyze} onIntelligence={onIntelligence} onOpenDna={onOpenDna}/>)}</div>
    </section>)}

    </>}

    {section==='curves'&&<section className="universe-derived-view">
      <div className="section-heading"><div><h2>Curvas detectadas <span className="count-pill">{curves}</span></h2><p>Mecanismos repetíveis comparados entre criadores independentes. A classificação é recalculada pelo backend, não pela IA.</p></div></div>
      {!intelligence?.curves.length?<div className="universe-empty"><Layers3 size={30}/><h3>Nenhuma curva extraída ainda.</h3><p>Gere Channel DNA em pelo menos dois concorrentes e execute “Extrair curvas”. Curvas com 3+ criadores independentes podem atingir classificação estrutural.</p></div>:<div className="universe-market-grid">{intelligence.curves.map(curve=><article className="universe-curve-card" key={curve.id}>
        <div className="universe-derived-head"><span className={`universe-status ${curve.classification==='structural'?'structural':curve.classification==='emerging'?'emerging':'watch'}`}>{curve.classification}</span><strong>{curve.independentCreators} criador(es)</strong></div>
        <h3>{curve.name}</h3>
        <p>{curve.thesis}</p>
        <div className="universe-derived-block"><span>MECANISMO</span><ol>{curve.mechanismSteps.map(step=><li key={step}>{step}</li>)}</ol></div>
        <div className="universe-derived-block"><span>EVIDÊNCIA</span><p>{curve.supportingChannelIds.map(competitorName).join(' · ')}</p>{curve.evidence.slice(0,3).map(item=><small key={item}>{item}</small>)}</div>
        <div className="universe-tags">{curve.clusters.map(item=><em key={item}>{item}</em>)}</div>
        <div className="universe-derived-block"><span>VARIÁVEIS TRANSFERÍVEIS</span><p>{curve.transferableVariables.join(' · ')}</p></div>
      </article>)}</div>}
      {intelligence?.limitations?.length?<div className="info-strip"><Globe2 size={18}/><span>{intelligence.limitations[0]}</span></div>:null}
    </section>}

    {section==='gaps'&&<section className="universe-derived-view">
      <div className="section-heading"><div><h2>Gaps derivados <span className="count-pill">{gaps}</span></h2><p>Transferências que preservam uma curva observada e mudam uma variável. Sem evidência no target, o status permanece hypothesis.</p></div></div>
      {!intelligence?.gaps.length?<div className="universe-empty"><Sparkles size={30}/><h3>Nenhum gap derivado ainda.</h3><p>Os gaps aparecem depois que o Universe encontra curvas comparáveis e existe base suficiente para testar transferências sem confundir criatividade com demanda.</p></div>:<div className="universe-market-grid">{intelligence.gaps.map(gap=>{
        const curve=intelligence.curves.find(item=>item.id===gap.curveId);
        return <article className="universe-gap-card" key={gap.id}>
          <div className="universe-derived-head"><span className={`tag ${gap.demandStatus==='observed'?'green':gap.demandStatus==='partial'?'blue':'orange'}`}>{gap.demandStatus}</span><strong>Saturação da amostra: {gap.sampleSaturation}</strong></div>
          <span className="eyebrow">FROM {curve?.name??'CURVE'}</span>
          <h3>{gap.title}</h3>
          <p>{gap.rationale}</p>
          <dl><dt>Preserva</dt><dd>{gap.preservedMechanism}</dd><dt>Muda</dt><dd>{gap.changedVariable}</dd><dt>Target</dt><dd>{gap.targetSpace}</dd></dl>
          {gap.demandEvidence.length>0&&<div className="universe-derived-block"><span>EVIDÊNCIA DO TARGET</span>{gap.demandEvidence.slice(0,4).map(item=><small key={item}>{item}</small>)}</div>}
          <div className="universe-derived-block tests"><span>PRIMEIROS TESTES</span><ol>{gap.firstTests.map(title=><li key={title}>{title}</li>)}</ol></div>
          {gap.risks.length>0&&<div className="universe-derived-block"><span>RISCOS</span><p>{gap.risks.slice(0,3).join(' · ')}</p></div>}
        </article>;
      })}</div>}
    </section>}


    {showImport&&<div className="universe-import-overlay" role="presentation">
      <section className="universe-import-panel">
        <button className="universe-import-close" onClick={()=>setShowImport(false)} aria-label="Fechar"><X size={18}/></button>
        <span className="eyebrow">IMPORT COMPETITORS</span>
        <h2>Construa seu universo conhecido.</h2>
        <p>Cole uma lista ou carregue um ou vários arquivos CSV/TXT. Duplicados são removidos antes da importação. Nesta fase aceitamos URL com <strong>@handle</strong>, URL <strong>/channel/UC…</strong>, <strong>@handle</strong> ou <strong>channelId</strong>. Nomes soltos não gastam search.list: ficam de fora até serem identificados.</p>
        <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder={"https://youtube.com/@channel-one\n@channel-two\nUCxxxxxxxxxxxxxxxxxxxxxx"}/>
        <div className="universe-import-file">
          <label className="button subtle"><FileUp size={15}/>Carregar CSV/TXT<input type="file" multiple accept=".csv,.txt,text/csv,text/plain" onChange={async e=>{
            const files=[...(e.target.files??[])];
            if(!files.length)return;
            const chunks=await Promise.all(files.map(file=>file.text()));
            setImportText(prev=>[prev,...chunks].filter(Boolean).join('\n'));
            e.currentTarget.value='';
          }}/></label>
          <span>{rawEntries} entrada(s) · {parsed.length} único(s){duplicateEntries>0?` · ${duplicateEntries} duplicada(s)`:''}</span>
        </div>
        <div className="universe-import-actions">
          <button className="button subtle" onClick={()=>setShowImport(false)}>Cancelar</button>
          <button className="button primary" disabled={!parsed.length||!!busy} onClick={async()=>{await onImport(parsed);setShowImport(false);setImportText('');}}><FileUp size={15}/>{busy==='universeImport'?'Importando…':`Importar ${parsed.length}`}</button>
        </div>
      </section>
    </div>}
  </div>;
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import type { ManagedChannel } from '@/lib/types';

type EvidenceItem={
  id:string;
  kind:'video'|'channel';
  title:string;
  channelTitle:string;
  url:string;
  views:number|null;
  subscribers:number|null;
  outlierScore:number|null;
  publishedAt:string|null;
  score:number|null;
  sourceTool:string;
};

type EvidencePack={
  id:string;
  channelId:string;
  channelName:string;
  profileKey:string;
  generatedAt:string;
  items:EvidenceItem[];
  conclusions:string[];
  limitations:string[];
};function compact(value:number|null){
  if(value===null)return 'n/d';
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
}
function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}

export default function NexLevEvidenceWorkspace({channel}:{channel:ManagedChannel}){
  const [pack,setPack]=useState<EvidencePack|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const load=useCallback(async()=>{
    const response=await fetch('/api/nexlev-evidence?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.message??'Falha ao carregar Evidence Pack.');
    setPack(body.latest??null);
  },[channel.id]);

  useEffect(()=>{
    let cancelled=false;
    void load().catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Falha ao carregar NexLev.');});
    return()=>{cancelled=true;};
  },[load]);  async function refresh(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/nexlev-evidence',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'refresh',channelId:channel.id})
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message??'Falha ao atualizar NexLev.');
      setPack(body.pack);
      setMessage(body.message??'Evidence Pack atualizado.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha ao atualizar NexLev.');
    }finally{setBusy(false);}
  }

  return <div className="brain-content">
    <section className="brain-section-head">
      <div>
        <span>NEXLEV / MARKET EVIDENCE</span>
        <h2>Fresh Winners conectados ao cérebro do canal.</h2>
        <p>Os sinais abaixo entram no Next Episode Strategist como evidência de mercado, sem substituir learnings de audiência e performance.</p>
      </div>
      <button className="button primary" disabled={busy} onClick={()=>void refresh()}>
        <RefreshCw size={15}/>{busy?'Atualizando…':'Atualizar NexLev'}
      </button>
    </section>    {message&&<div className="brain-message"><Search size={16}/><span>{message}</span></div>}
    {!pack&&<div className="brain-empty-inline">Nenhum Evidence Pack persistido para este canal.</div>}
    {pack&&<>
      <section className="panel">
        <div className="brain-section-head">
          <div>
            <span>{pack.profileKey}</span>
            <h2>{pack.items.length} sinais preservados</h2>
            <p>Gerado em {when(pack.generatedAt)}. O histórico permanece no Supabase para comparação entre episódios.</p>
          </div>
        </div>
        <ul className="evidence-list">
          {pack.conclusions.map(item=><li key={item}>{item}</li>)}
        </ul>
      </section>
      <div className="brain-grid two">
        {pack.items.slice(0,12).map(item=><article className="panel" key={item.id}>
          <span className="eyebrow">{item.kind==='video'?'VÍDEO OUTLIER':'CANAL EMERGENTE'}</span>
          <h3>{item.title}</h3>
          <p>{item.channelTitle}</p>
          <div className="brain-meta">
            <em>{compact(item.views)} views</em>
            <em>{compact(item.subscribers)} inscritos</em>
            <em>outlier {item.outlierScore?.toFixed(2)??'n/d'}</em>
          </div>
          <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
            Abrir no YouTube <ExternalLink size={13}/>
          </a>
        </article>)}
      </div>
      <section className="panel">
        <span className="eyebrow">LIMITAÇÕES</span>
        <ul className="evidence-list">{pack.limitations.map(item=><li key={item}>{item}</li>)}</ul>
      </section>
    </>}
  </div>;
}

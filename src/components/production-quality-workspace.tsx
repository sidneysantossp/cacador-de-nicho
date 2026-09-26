'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw,
  ShieldCheck, Sparkles, XCircle
} from 'lucide-react';
import type {
  ManagedChannel, ProductionQualityCheck, ProductionQualityCheckCode,
  ProductionQualityReport, RenderJob
} from '@/lib/types';

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function seconds(value:number|null){
  return value===null?'—':value.toFixed(3)+'s';
}
function percent(value:number|null){
  return value===null?'—':(value*100).toFixed(2)+'%';
}
function statusRank(status:ProductionQualityCheck['status']){
  return status==='blocker'?0:status==='manual-review'?1:status==='warning'?2:3;
}

export default function ProductionQualityWorkspace({channel}:{channel:ManagedChannel}){
  const [reports,setReports]=useState<ProductionQualityReport[]>([]);
  const [renders,setRenders]=useState<RenderJob[]>([]);
  const [confirmations,setConfirmations]=useState<Record<string,ProductionQualityCheckCode[]>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const reportByRender=useMemo(()=>new Map(reports.map(report=>[report.renderJobId,report])),[reports]);

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/production-quality?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Production QA.');
      const nextReports=(body.reports??[]) as ProductionQualityReport[];
      setReports(nextReports);
      setRenders((body.renders??[]) as RenderJob[]);
      setConfirmations(prev=>{
        const next={...prev};
        for(const report of nextReports){
          if(next[report.id]===undefined)next[report.id]=[...(report.review.overrides??[])];
        }
        return next;
      });
      setNotes(prev=>{
        const next={...prev};
        for(const report of nextReports){
          if(next[report.id]===undefined)next[report.id]=report.review.notes??'';
        }
        return next;
      });
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Production QA.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  async function action(body:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/production-quality',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha no Production QA.');
      setMessage(result.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Production QA.');
    }finally{setBusy('');}
  }

  function toggle(reportId:string,code:ProductionQualityCheckCode){
    setConfirmations(prev=>{
      const current=prev[reportId]??[];
      return {
        ...prev,
        [reportId]:current.includes(code)
          ?current.filter(item=>item!==code)
          :[...current,code]
      };
    });
  }

  if(loading)return <div className="quality-loading"><Sparkles className="spin" size={20}/>Carregando Production QA…</div>;

  return <div className="quality-engine">
    {message&&<div className="quality-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="quality-hero">
      <div>
        <span>PRODUCTION QUALITY CONTROL</span>
        <h2>O gate final antes de packaging e publicação.</h2>
        <p>O QA cruza o manifest congelado com o MP4 real, metadados de assets e contexto de produção. O que não pode ser provado automaticamente fica explícito como revisão manual.</p>
      </div>
      <ShieldCheck size={35}/>
    </section>

    <section className="quality-queue">
      <div className="quality-section-head">
        <div><span>COMPLETED RENDERS</span><h3>Fila de inspeção.</h3><p>Cada render possui um relatório versionado e imutavelmente ligado à versão do Video Edit.</p></div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={14}/>Atualizar</button>
      </div>

      {!renders.length&&<div className="quality-empty"><ShieldCheck size={28}/><h3>Nenhum render concluído para inspecionar.</h3><p>Finalize um render na etapa anterior para iniciar o QA.</p></div>}

      <div className="quality-render-list">{renders.map(render=>{
        const report=reportByRender.get(render.id);
        return <article key={render.id} className="quality-render-card">
          <div>
            <span className="quality-render-id">RENDER {render.id.slice(0,8)}</span>
            <strong>{render.payload.preset??'source'} · edit v{render.videoEditVersion}</strong>
            <small>{when(render.completedAt??render.updatedAt)} · {render.outputBytes?Math.round(render.outputBytes/1024)+' KB':'output pronto'}</small>
          </div>
          <div className="quality-render-actions">
            {report
              ?<span className={'quality-gate '+report.status}>{report.status==='approved'?'RELEASE APPROVED':report.status.toUpperCase()}</span>
              :<span className="quality-gate pending">AWAITING QA</span>}
            {render.outputSignedUrl&&<a className="button subtle small" href={render.outputSignedUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>MP4</a>}
            <button className="button primary small" disabled={busy==='run:'+render.id} onClick={()=>void action({action:'run',renderJobId:render.id},'run:'+render.id)}>
              {busy==='run:'+render.id?<LoaderCircle className="spin" size={13}/>:<ShieldCheck size={13}/>}
              {report?'Reexecutar QA':'Executar QA'}
            </button>
          </div>
        </article>;
      })}</div>
    </section>

    <section className="quality-reports">
      <div className="quality-section-head"><div><span>QUALITY REPORTS</span><h3>Gates e evidências.</h3></div></div>

      <div className="quality-report-list">{reports.map(report=>{
        const ordered=[...report.checks].sort((a,b)=>statusRank(a.status)-statusRank(b.status));
        const manual=ordered.filter(check=>check.status==='manual-review');
        const selected=confirmations[report.id]??[];
        const blockers=report.summary.blockers;
        const manualReady=manual.every(check=>selected.includes(check.code));
        const canApprove=blockers===0&&manualReady&&report.status!=='approved';

        return <article key={report.id} className={'quality-report '+report.status}>
          <header>
            <div>
              <span>QA v{report.version} · {report.renderCompilerVersion}</span>
              <h3>Render {report.renderJobId.slice(0,8)}</h3>
              <p>Checked {when(report.checkedAt)}</p>
            </div>
            <div className="quality-summary">
              <b className="pass">{report.summary.pass} pass</b>
              <b className="warning">{report.summary.warnings} warnings</b>
              <b className="manual">{report.summary.manualReview} manual</b>
              <b className="blocker">{report.summary.blockers} blockers</b>
            </div>
          </header>

          <div className="quality-technical">
            <span>{report.technical.videoCodec??'no video'} · {report.technical.width??'—'}×{report.technical.height??'—'} · {report.technical.fps??'—'} fps</span>
            <span>{report.technical.audioCodec??'no audio'} · {report.technical.sampleRate??'—'} Hz</span>
            <span>{seconds(report.technical.durationSeconds)}</span>
            <span>black {percent(report.technical.blackRatio)}</span>
            <span>silence {percent(report.technical.silenceRatio)}</span>
            <span>peak {report.technical.maxVolumeDb===null?'—':report.technical.maxVolumeDb.toFixed(2)+' dB'}</span>
          </div>

          {report.technicalMode==='chapter-v2'&&Boolean(report.chapterTechnical?.length)&&<section className="quality-chapters">
            <div className="quality-chapter-head">
              <div>
                <span>CHAPTER QA</span>
                <strong>{report.chapterTechnical!.length} capítulo(s) analisados</strong>
              </div>
              <em>{report.chapterTechnical!.filter(item=>item.cacheHit).length} cache hit(s)</em>
            </div>
            <div className="quality-chapter-list">{report.chapterTechnical!.map(chapter=><article key={chapter.chapterId} className={chapter.decodeOk?'pass':'blocker'}>
              <div>
                <strong>{String(chapter.sequence).padStart(2,'0')} · {chapter.label}</strong>
                <span>{seconds(chapter.durationSeconds)} · {chapter.cacheHit?'CACHE HIT':'ANALISADO'}</span>
              </div>
              <div>
                <span>{chapter.videoCodec??'no video'} · {chapter.width??'—'}×{chapter.height??'—'} · {chapter.fps??'—'} fps</span>
                <span>black {percent(chapter.blackRatio)}</span>
              </div>
              <div>
                <b>{chapter.decodeOk?'decode ok':'decode failed'}</b>
                <small>{chapter.analysisSeconds===null?'—':chapter.analysisSeconds.toFixed(1)+'s'}</small>
              </div>
              {chapter.error&&<p>{chapter.error}</p>}
            </article>)}</div>
          </section>}

          <div className="quality-check-list">{ordered.map(check=><section key={check.id} className={'quality-check '+check.status}>
            <div className="quality-check-icon">
              {check.status==='pass'?<CheckCircle2 size={17}/>:
               check.status==='blocker'?<XCircle size={17}/>:
               <AlertTriangle size={17}/>}
            </div>
            <div className="quality-check-body">
              <div><span>{check.category}</span><strong>{check.title}</strong></div>
              <p>{check.summary}</p>
              {!!check.evidence.length&&<ul>{check.evidence.map((evidence,index)=><li key={index}>{evidence}</li>)}</ul>}
              {check.status==='manual-review'&&report.status!=='approved'&&<label className="quality-confirm">
                <input type="checkbox" checked={selected.includes(check.code)} onChange={()=>toggle(report.id,check.code)}/>
                <span>Revisei manualmente e confirmo este item.</span>
              </label>}
              {check.status==='manual-review'&&report.status==='approved'&&<div className="quality-confirmed"><CheckCircle2 size={13}/>Confirmado pelo operador</div>}
            </div>
          </section>)}</div>

          <footer>
            <label className="quality-notes"><span>NOTAS DO OPERADOR</span><textarea rows={4} disabled={report.status==='approved'} value={notes[report.id]??''} onChange={e=>setNotes(prev=>({...prev,[report.id]:e.target.value}))}/></label>
            <div className="quality-release">
              {report.status==='approved'
                ?<div className="quality-approved"><ShieldCheck size={20}/><div><strong>Release gate aprovado</strong><span>{report.review.approvedAt?when(report.review.approvedAt):'Aprovado pelo operador'}</span></div></div>
                :<>
                  <div className="quality-release-state">
                    {blockers>0?<><XCircle size={16}/><span>Corrija {blockers} blocker(s) e reexecute o QA.</span></>:
                     !manualReady?<><AlertTriangle size={16}/><span>Confirme {manual.filter(check=>!selected.includes(check.code)).length} revisão(ões) manual(is).</span></>:
                     <><CheckCircle2 size={16}/><span>Todos os gates obrigatórios estão prontos.</span></>}
                  </div>
                  <button className="button primary" disabled={!canApprove||busy==='approve:'+report.id} onClick={()=>void action({
                    action:'approve',
                    reportId:report.id,
                    expectedVersion:report.version,
                    notes:notes[report.id]??'',
                    overrides:selected
                  },'approve:'+report.id)}><ShieldCheck size={15}/>{busy==='approve:'+report.id?'Aprovando…':'Aprovar release gate'}</button>
                </>}
            </div>
          </footer>
        </article>;
      })}</div>

      {!reports.length&&renders.length>0&&<div className="quality-empty"><ShieldCheck size={28}/><h3>Nenhum QA executado.</h3><p>Escolha um render concluído acima para gerar o primeiro relatório.</p></div>}
    </section>
  </div>;
}

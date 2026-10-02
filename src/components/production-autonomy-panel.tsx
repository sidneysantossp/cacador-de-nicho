'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ProductionAutonomyAssessment } from '@/lib/production-autonomy-policy';

type SubjectType='universe-gap'|'opportunity-report'|'next-episode';
type Props={subjectType:SubjectType;subjectId:string;candidateId?:string;mode?:'live'|'demo';children?: (approved:boolean)=>ReactNode};
type ResponseShape={assessment:ProductionAutonomyAssessment|null;summary?:{status:string;score:number;reasons:string[]}|null;message?:string};

export default function ProductionAutonomyPanel({subjectType,subjectId,candidateId,mode='live',children}:Props){
  const [data,setData]=useState<ResponseShape>({assessment:null});
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const query=new URLSearchParams({subjectType,subjectId}); if(candidateId)query.set('candidateId',candidateId);
  const refresh=useCallback(async()=>{
    if(mode==='demo')return;
    try{const response=await fetch('/api/production-autonomy?'+query.toString(),{cache:'no-store'});const body=await response.json() as ResponseShape;if(!response.ok)throw new Error(body.message??'Não foi possível carregar o Production Autonomy Fit.');setData(body);setError('');}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar o gate.');}
  },[mode,subjectType,subjectId,candidateId]);
  useEffect(()=>{void refresh();},[refresh]);
  const evaluate=async()=>{
    setBusy(true);setError('');
    try{const response=await fetch('/api/production-autonomy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subjectType,subjectId,candidateId})});const body=await response.json() as ResponseShape;if(!response.ok)throw new Error(body.message??'A avaliação não pôde ser iniciada.');setData(body);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'A avaliação falhou.');}
    finally{setBusy(false);}
  };
  const assessment=data.assessment; const approved=assessment?.status==='approved';
  return <div className="production-autonomy-panel">
    <div className="production-autonomy-heading"><strong>Production Autonomy Fit</strong><span className={'tag '+(approved?'green':assessment?.status==='rejected'?'orange':'blue')}>{assessment?.status??'não avaliado'}</span></div>
    {assessment&&<><div className="production-autonomy-score"><b>{assessment.score}</b>/100 · Visual Supply Coverage {assessment.coverage.supplyPercent}%</div><div className="production-autonomy-metrics">Owned {assessment.coverage.ownedPercent}% · Stock {assessment.coverage.stockPercent}% · Generation {assessment.coverage.generationPercent}% · Unresolved {assessment.coverage.unresolvedPercent}%</div><ul>{assessment.reasons.slice(0,4).map(reason=><li key={reason.code}>{reason.message}</li>)}</ul></>}
    {!assessment&&<p>O mercado continua sendo o gate de oportunidade. Este painel mede apenas a capacidade de fabricar a oportunidade validada.</p>}
    {error&&<p className="error-text">{error}</p>}
    {mode!=='demo'&&<button className="button subtle small" disabled={busy} onClick={()=>void evaluate()}>{busy?'Avaliando…':assessment?'Reavaliar Production Autonomy Fit':'Avaliar Production Autonomy Fit'}</button>}
    {children?.(approved)}
  </div>;
}

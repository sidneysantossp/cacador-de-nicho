import 'server-only';

import type { ManagedChannel, UniverseCompetitor, UniverseImportQueueSummary, UniverseMarketIntelligence } from '@/lib/types';
import { checked, db, list, put, settings } from './db';
import { collectUniverseCompetitor } from './youtube';
import { analyzeUniverseCompetitorDNA, analyzeUniverseCurvesAndGaps } from './ai';
import { selectUniverseDnaBatch, universeCompetitorDue, UNIVERSE_STATUS_RANK } from '@/lib/universe-policy';
import { resolveUniverseGapEvidence, selectUniverseCurveEvidence, selectUniverseDnaBootstrapBatch, selectUniverseGapValidationDnaBatch, universeCurveClassification, universeGapDemandStatus, universeKey } from '@/lib/universe-market';

function isCompetitor(value:unknown):value is UniverseCompetitor{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='competitor';
}

async function mapLimit<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>){
  const output=new Array<R>(items.length);
  let cursor=0;
  async function worker(){
    while(cursor<items.length){
      const index=cursor++;
      output[index]=await work(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return output;
}

export async function universeState(){
  const records=await list<ManagedChannel|UniverseCompetitor>('radar_managed_channels',1000);
  return records.filter(isCompetitor);
}

type UniverseQueueRow={
  id:string;
  input:string;
  status:'pending'|'processing'|'completed'|'failed';
  attempts:number;
  last_error:string|null;
  created_at:string;
  updated_at:string;
};

function mergeCompetitorSnapshot(snapshot:UniverseCompetitor,prior?:UniverseCompetitor):UniverseCompetitor{
  if(!prior)return snapshot;
  return {
    ...snapshot,
    importedAt:prior.importedAt,
    subniche:prior.subniche,
    monitoringTier:prior.monitoringTier,
    status:['pattern','emerging-curve','structural-curve','gap-found','production-reference'].includes(prior.status)?prior.status:snapshot.status,
    snapshots:[...(snapshot.snapshots??[]),...(prior.snapshots??[])].filter((item,index,array)=>array.findIndex(other=>other.observedAt===item.observedAt)===index).slice(0,30),
    dna:prior.dna,
    dnaTags:prior.dnaTags.length?prior.dnaTags:snapshot.dnaTags,
    gapSummary:prior.gapSummary
  };
}

export async function universeQueueSummary():Promise<UniverseImportQueueSummary>{
  const rows=checked(await db().from('radar_universe_queue').select('status,attempts')) as Array<Pick<UniverseQueueRow,'status'|'attempts'>>;
  const count=(status:UniverseQueueRow['status'])=>rows.filter(row=>row.status===status).length;
  const completed=count('completed');
  const total=rows.length;
  return {
    total,
    pending:count('pending'),
    processing:count('processing'),
    completed,
    failed:count('failed'),
    retryable:rows.filter(row=>row.status==='failed'&&row.attempts<3).length,
    progressPct:total?Math.round((completed/total)*100):0
  };
}

export async function processUniverseImportQueue(maxItems=25){
  const rows=checked(await db().rpc('claim_radar_universe_queue',{
    p_limit:Math.max(1,Math.min(maxItems,50))
  })) as UniverseQueueRow[];

  if(!rows.length)return {processed:0,succeeded:0,failed:0,summary:await universeQueueSummary()};

  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));

  const results=await mapLimit(rows,4,async row=>{
    try{
      const snapshot=await collectUniverseCompetitor(row.input);
      const merged=mergeCompetitorSnapshot(snapshot,byChannel.get(snapshot.channelId));
      await put('radar_managed_channels',merged.id,merged);
      byChannel.set(merged.channelId,merged);
      checked(await db().from('radar_universe_queue')
        .update({status:'completed',last_error:null,updated_at:new Date().toISOString()})
        .eq('id',row.id));
      return {ok:true as const,id:row.id,name:merged.name};
    }catch(error){
      const message=(error instanceof Error?error.message:'Falha não identificada.').slice(0,1000);
      checked(await db().from('radar_universe_queue')
        .update({status:'failed',last_error:message,updated_at:new Date().toISOString()})
        .eq('id',row.id));
      return {ok:false as const,id:row.id,error:message};
    }
  });

  return {
    processed:results.length,
    succeeded:results.filter(result=>result.ok).length,
    failed:results.filter(result=>!result.ok).length,
    summary:await universeQueueSummary()
  };
}

export async function importUniverseCompetitors(inputs:string[]){
  const clean=[...new Set(inputs.map(input=>input.trim()).filter(Boolean))].slice(0,25);
  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));
  const results=await mapLimit(clean,4,async input=>{
    try{
      const snapshot=await collectUniverseCompetitor(input);
      const prior=byChannel.get(snapshot.channelId);
      const merged=mergeCompetitorSnapshot(snapshot,prior);
      await put('radar_managed_channels',merged.id,merged);
      return {ok:true as const,input,name:merged.name,id:merged.id};
    }catch(error){
      return {ok:false as const,input,error:error instanceof Error?error.message:'Falha não identificada.'};
    }
  });
  const imported=results.filter(result=>result.ok).length;
  const failed=results.length-imported;
  return {
    imported,
    failed,
    total:results.length,
    failures:results.filter((result):result is Extract<(typeof results)[number],{ok:false}>=>!result.ok).slice(0,10)
  };
}

export async function refreshUniverseCompetitors(ids?:string[],maxItems=25){
  const all=await universeState();
  const wanted=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :all
      .filter(item=>universeCompetitorDue(item))
      .sort((a,b)=>Date.parse(a.lastMonitoredAt)-Date.parse(b.lastMonitoredAt))
      .slice(0,maxItems);
  const results=await mapLimit(wanted.slice(0,maxItems),4,async competitor=>{
    try{
      const updated=await collectUniverseCompetitor(competitor.channelId,competitor);
      await put('radar_managed_channels',updated.id,updated);
      return {ok:true as const,id:updated.id,name:updated.name};
    }catch(error){
      return {ok:false as const,id:competitor.id,name:competitor.name,error:error instanceof Error?error.message:'Falha não identificada.'};
    }
  });
  const refreshed=results.filter(result=>result.ok).length;
  return {refreshed,failed:results.length-refreshed,total:results.length};
}
export async function runUniverseIntelligence(ids?:string[]){
  const all=await universeState();
  const selected=(ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId)).slice(0,5)
    :selectUniverseDnaBatch(all,5)
  );
  if(!selected.length){
    const ready=all.filter(item=>!!item.dna).length;
    return {
      analyzed:0,
      updated:[],
      total:all.length,
      ready,
      remaining:Math.max(0,all.length-ready),
      message:all.length&&ready===all.length
        ?'Channel DNA já concluído para todos os concorrentes.'
        :'Nenhum concorrente disponível para Channel DNA.'
    };
  }

  const config=await settings();
  const results=await analyzeUniverseCompetitorDNA(selected);
  const byChannel=new Map(results.map(result=>[result.channelId,result.dna]));
  const updated:string[]=[];
  for(const competitor of selected){
    const dna=byChannel.get(competitor.channelId);
    if(!dna)continue;
    const dnaTags=[
      dna.primaryNiche,
      dna.subniche,
      dna.formatSignature,
      ...dna.curiosityMechanisms.slice(0,2)
    ].filter(Boolean).slice(0,5);
    const next:UniverseCompetitor={
      ...competitor,
      cluster:dna.primaryNiche||competitor.cluster,
      subniche:dna.subniche||competitor.subniche,
      format:dna.formatSignature||competitor.format,
      dna:{
        ...dna,
        provenance:{
          schemaVersion:1,
          generatedBy:'platform',
          model:config.analysisModel,
          sourceVideoCount:Math.min(20,competitor.recentUploads.length),
          sourceSignalCount:competitor.signalDetails?.length??competitor.signals.length,
          observedAt:competitor.lastMonitoredAt
        }
      },
      dnaTags,
      updatedAt:new Date().toISOString()
    };
    await put('radar_managed_channels',next.id,next);
    updated.push(next.name);
  }
  const after=await universeState();
  const ready=after.filter(item=>!!item.dna).length;
  const remaining=Math.max(0,after.length-ready);
  return {
    analyzed:updated.length,
    updated,
    total:after.length,
    ready,
    remaining,
    message:updated.length
      ?`Channel DNA atualizado para ${updated.length} concorrente(s): ${updated.join(', ')}. Progresso: ${ready}/${after.length}; ${remaining} pendente(s).`
      :'A análise não devolveu DNA utilizável para os concorrentes selecionados.'
  };
}


export async function runUniverseDnaBootstrap(maxCompetitors=15,timeBudgetMs=120_000){
  const cap=Math.max(1,Math.min(maxCompetitors,25));
  const budget=Math.max(30_000,Math.min(timeBudgetMs,180_000));
  const startedAt=Date.now();
  const attempted=new Set<string>();
  const updated:string[]=[];
  const market=await universeMarketIntelligenceState();
  let batches=0;
  let attemptedChannels=0;
  let targetedAttempts=0;

  while(attemptedChannels<cap&&Date.now()-startedAt<budget){
    const all=await universeState();
    const eligible=all.filter(item=>!attempted.has(item.id)&&!attempted.has(item.channelId));
    const targetedIds=new Set(selectUniverseGapValidationDnaBatch(eligible,market,2).map(item=>item.id));
    const selected=selectUniverseDnaBootstrapBatch(
      eligible,
      market,
      Math.min(5,cap-attemptedChannels),
      2
    );
    if(!selected.length)break;

    attemptedChannels+=selected.length;
    targetedAttempts+=selected.filter(item=>targetedIds.has(item.id)).length;
    for(const competitor of selected){
      attempted.add(competitor.id);
      attempted.add(competitor.channelId);
    }

    const result=await runUniverseIntelligence(selected.map(item=>item.id));
    batches++;
    updated.push(...result.updated);
  }

  const after=await universeState();
  const ready=after.filter(item=>!!item.dna).length;
  const remaining=Math.max(0,after.length-ready);
  return {
    analyzed:updated.length,
    updated,
    batches,
    attempted:attemptedChannels,
    targetedAttempts,
    total:after.length,
    ready,
    remaining,
    timeBudgetReached:remaining>0&&Date.now()-startedAt>=budget,
    message:updated.length
      ?`Channel DNA bootstrap: ${updated.length} concorrente(s) analisado(s) em ${batches} lote(s). Progresso: ${ready}/${after.length}; ${remaining} pendente(s).`
      :remaining===0
        ?'Channel DNA já concluído para todos os concorrentes.'
        :'Nenhum concorrente adicional produziu DNA utilizável nesta execução.'
  };
}


function isUniverseMarketIntelligence(value:unknown):value is UniverseMarketIntelligence{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='universe-market-intelligence';
}

export async function universeMarketIntelligenceState(){
  const analyses=await list<unknown>('radar_analyses',300);
  return analyses.find(isUniverseMarketIntelligence)??null;
}

export async function shouldRefreshUniverseMarketIntelligence(){
  const competitors=await universeState();
  const withDna=competitors.filter(item=>!!item.dna);
  if(withDna.length<3)return false;
  const current=await universeMarketIntelligenceState();
  if(!current)return true;
  return withDna.some(item=>Date.parse(item.dna?.generatedAt??'')>Date.parse(current.generatedAt));
}

export async function runUniverseMarketIntelligence():Promise<UniverseMarketIntelligence>{
  const all=await universeState();
  const sample=selectUniverseCurveEvidence(all,40,8);
  if(sample.length<2)throw new Error('O Universe precisa de Channel DNA em pelo menos 2 concorrentes antes de extrair curvas.');

  const raw=await analyzeUniverseCurvesAndGaps(sample);
  const validIds=new Set(sample.map(item=>item.channelId));
  const byId=new Map(sample.map(item=>[item.channelId,item]));

  const curves=raw.curves.flatMap((candidate,index)=>{
    const support=[...new Set(candidate.supportingChannelIds.filter(id=>validIds.has(id)))];
    if(!support.length)return [];
    const classification=universeCurveClassification(support);
    const key=universeKey(candidate.key||candidate.name||`curve-${index+1}`);
    const clusters=[...new Set(support.map(id=>byId.get(id)?.cluster).filter((value):value is string=>!!value))];
    return [{
      id:`universe-curve:${key}`,
      key,
      name:candidate.name,
      thesis:candidate.thesis,
      mechanismSteps:candidate.mechanismSteps,
      supportingChannelIds:support,
      independentCreators:new Set(support).size,
      classification,
      clusters,
      evidence:candidate.evidence,
      counterEvidence:candidate.counterEvidence,
      recurringTitlePatterns:candidate.recurringTitlePatterns,
      transferableVariables:candidate.transferableVariables,
      limitations:candidate.limitations
    }];
  });

  const curveByKey=new Map(curves.map(curve=>[curve.key,curve]));
  const gaps=raw.gaps.flatMap((candidate,index)=>{
    const key=universeKey(candidate.curveKey);
    const curve=curveByKey.get(key);
    if(!curve)return [];
    const resolvedEvidence=resolveUniverseGapEvidence(
      sample,
      candidate,
      candidate.targetEvidenceChannelIds.filter(id=>validIds.has(id))
    );
    const targetIds=resolvedEvidence.channelIds;
    const demandStatus=universeGapDemandStatus(curve.classification,targetIds);
    return [{
      id:`universe-gap:${curve.key}:${universeKey(candidate.targetSpace||candidate.title||String(index+1))}`,
      curveId:curve.id,
      title:candidate.title,
      targetSpace:candidate.targetSpace,
      preservedMechanism:candidate.preservedMechanism,
      changedVariable:candidate.changedVariable,
      demandStatus,
      targetEvidenceChannelIds:targetIds,
      demandEvidence:[...candidate.demandEvidence,...resolvedEvidence.evidence].slice(0,8),
      sampleSaturation:candidate.sampleSaturation,
      rationale:candidate.rationale,
      risks:candidate.risks,
      firstTests:candidate.firstTests
    }];
  });

  const report:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:new Date().toISOString(),
    sourceCompetitorIds:sample.map(item=>item.channelId),
    dnaCount:all.filter(item=>!!item.dna).length,
    curves,
    gaps,
    limitations:[
      ...raw.limitations,
      'Classificações de curva são recalculadas no backend por criadores independentes: 1=hypothesis, 2=emerging, 3+=structural.',
      'Saturação descreve apenas a amostra do Competitor Universe analisada; não representa todo o YouTube.',
      'Gaps sem evidência explícita no targetSpace permanecem hypothesis, mesmo quando a curva de origem é estrutural.'
    ]
  };

  await put('radar_analyses',report.id,report);

  for(const competitor of sample){
    const supported=curves.filter(curve=>curve.supportingChannelIds.includes(competitor.channelId));
    const strongest=supported.sort((a,b)=>{
      const rank={hypothesis:1,emerging:2,structural:3};
      return rank[b.classification]-rank[a.classification];
    })[0];
    if(!strongest)continue;
    const desired=strongest.classification==='structural'?'structural-curve':strongest.classification==='emerging'?'emerging-curve':competitor.status;
    if(UNIVERSE_STATUS_RANK[desired]>UNIVERSE_STATUS_RANK[competitor.status]){
      await put('radar_managed_channels',competitor.id,{...competitor,status:desired,updatedAt:new Date().toISOString()});
    }
  }

  return report;
}

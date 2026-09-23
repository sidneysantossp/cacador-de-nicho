import 'server-only';

import type { ManagedChannel, UniverseCompetitor, UniverseMarketIntelligence } from '@/lib/types';
import { list, put } from './db';
import { collectUniverseCompetitor } from './youtube';
import { analyzeUniverseCompetitorDNA, analyzeUniverseCurvesAndGaps } from './ai';
import { compareUniverseDnaPriority, universeCompetitorDue, UNIVERSE_STATUS_RANK } from '@/lib/universe-policy';
import { selectUniverseCurveEvidence, universeCurveClassification, universeGapDemandStatus, universeKey } from '@/lib/universe-market';

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

export async function importUniverseCompetitors(inputs:string[]){
  const clean=[...new Set(inputs.map(input=>input.trim()).filter(Boolean))].slice(0,25);
  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));
  const results=await mapLimit(clean,4,async input=>{
    try{
      const snapshot=await collectUniverseCompetitor(input);
      const prior=byChannel.get(snapshot.channelId);
      const merged=prior?{
        ...snapshot,
        importedAt:prior.importedAt,
        subniche:prior.subniche,
        monitoringTier:prior.monitoringTier,
        status:['pattern','emerging-curve','structural-curve','gap-found','production-reference'].includes(prior.status)?prior.status:snapshot.status,
        snapshots:[...(snapshot.snapshots??[]),...(prior.snapshots??[])].filter((item,index,array)=>array.findIndex(other=>other.observedAt===item.observedAt)===index).slice(0,30),
        dna:prior.dna,
        dnaTags:prior.dnaTags.length?prior.dnaTags:snapshot.dnaTags,
        gapSummary:prior.gapSummary
      }:snapshot;
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
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :[...all].sort(compareUniverseDnaPriority)
  ).slice(0,5);
  if(!selected.length)return {analyzed:0,updated:[],message:'Nenhum concorrente disponível para Channel DNA.'};

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
      dna,
      dnaTags,
      updatedAt:new Date().toISOString()
    };
    await put('radar_managed_channels',next.id,next);
    updated.push(next.name);
  }
  return {
    analyzed:updated.length,
    updated,
    message:updated.length
      ?`Channel DNA atualizado para ${updated.length} concorrente(s): ${updated.join(', ')}.`
      :'A análise não devolveu DNA utilizável para os concorrentes selecionados.'
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
    const targetIds=[...new Set(candidate.targetEvidenceChannelIds.filter(id=>validIds.has(id)))];
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
      demandEvidence:candidate.demandEvidence,
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

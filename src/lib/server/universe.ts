import 'server-only';

import type { ManagedChannel, UniverseCompetitor } from '@/lib/types';
import { list, put } from './db';
import { collectUniverseCompetitor } from './youtube';
import { analyzeUniverseCompetitorDNA } from './ai';

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

export async function refreshUniverseCompetitors(ids?:string[]){
  const all=await universeState();
  const now=Date.now();
  const cadenceHours:Record<UniverseCompetitor['monitoringTier'],number>={
    hot:6,
    active:24,
    stable:72,
    dormant:168
  };
  const wanted=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :all
      .filter(item=>now-Date.parse(item.lastMonitoredAt)>=cadenceHours[item.monitoringTier]*3600000)
      .sort((a,b)=>Date.parse(a.lastMonitoredAt)-Date.parse(b.lastMonitoredAt))
      .slice(0,25);
  const results=await mapLimit(wanted.slice(0,25),4,async competitor=>{
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
  const statusRank:Record<UniverseCompetitor['status'],number>={
    'production-reference':8,
    'gap-found':7,
    'structural-curve':6,
    'emerging-curve':5,
    'pattern':4,
    'breakout':3,
    'heating-up':2,
    'watch':1
  };
  const selected=(ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :[...all].sort((a,b)=>{
      const missingA=a.dna?1:0,missingB=b.dna?1:0;
      if(missingA!==missingB)return missingA-missingB;
      if(statusRank[b.status]!==statusRank[a.status])return statusRank[b.status]-statusRank[a.status];
      return Date.parse(a.dna?.generatedAt??a.importedAt)-Date.parse(b.dna?.generatedAt??b.importedAt);
    })
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

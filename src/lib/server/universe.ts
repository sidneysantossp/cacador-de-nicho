import 'server-only';

import type { ManagedChannel, UniverseCompetitor } from '@/lib/types';
import { list, put } from './db';
import { collectUniverseCompetitor } from './youtube';

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
      const merged=prior?await collectUniverseCompetitor(snapshot.channelId,prior):snapshot;
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
  const wanted=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :[...all].sort((a,b)=>Date.parse(a.lastMonitoredAt)-Date.parse(b.lastMonitoredAt)).slice(0,25);
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

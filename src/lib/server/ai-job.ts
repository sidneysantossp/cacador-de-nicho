import 'server-only';
import {checked,db,put} from './db';
import {HttpError} from './auth';

type JobKind='analyze'|'script'|'channel-study'|'opportunity-report'|'universe-intelligence'|'universe-curves'|'universe-queue';

const DETAIL_KEYS=[
 'analyzed','updated','total','ready','remaining','batches','attempted','targetedAttempts',
 'failedBatches','errors','timeBudgetReached','message','succeeded','failed','completed',
 'pending','processing','retryable','terminalFailed','resolved','progressPct'
] as const;

function compactDetails(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const source=value as Record<string,unknown>;
 const details:Record<string,unknown>={};
 for(const key of DETAIL_KEYS){
  if(source[key]!==undefined)details[key]=source[key];
 }
 for(const key of ['bootstrap','intelligence','evidence','queue'] as const){
  const nested=compactDetails(source[key]);
  if(nested&&Object.keys(nested).length)details[key]=nested;
 }
 return Object.keys(details).length?details:undefined;
}

function completionMessage(kind:JobKind,result:unknown){
 if(kind==='universe-queue'&&result&&typeof result==='object'){
  const source=result as Record<string,unknown>;
  const intelligence=source.intelligence;
  if(intelligence&&typeof intelligence==='object'&&!Array.isArray(intelligence)){
   const message=(intelligence as Record<string,unknown>).message;
   if(typeof message==='string'&&message.trim())return message.slice(0,600);
  }
  if(typeof source.message==='string'&&source.message.trim())return source.message.slice(0,600);
 }
 return 'Entrega registrada. Consulte as fontes e limitações.';
}

export async function runAiJob<T>(kind:JobKind,item:string,work:()=>Promise<T>):Promise<T>{
 const key=`${kind}:${item}:${Math.floor(Date.now()/300000)}`;
 const token=crypto.randomUUID();
 const acquired=checked(await db().rpc('claim_radar_job',{job_key:key,lease_token:token}));
 if(!acquired)throw new HttpError('Outra tarefa está em execução ou esta solicitação já foi processada. Consulte Atividade.',409);
 const run={id:key,type:kind==='analyze'?'Análise editorial':kind==='channel-study'?'Análise profunda de canal':kind==='opportunity-report'?'Opportunity Report':kind==='universe-intelligence'?'Universe Intelligence':kind==='universe-curves'?'Universe Curves & Gaps':kind==='universe-queue'?'Universe Bootstrap':'Rascunho de roteiro',startedAt:new Date().toISOString(),status:'running' as const,message:'Pesquisa e agentes em execução.'};
 try{
  await put('radar_runs',key,run);
  const result=await work();
  await put('radar_runs',key,{
   ...run,
   status:'completed',
   message:completionMessage(kind,result),
   details:compactDetails(result)
  });
  checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:true}));
  return result;
 }catch(e){
  const detail=e instanceof Error?e.message:'Falha não identificada.';
  await put('radar_runs',key,{...run,status:'failed',message:`Falha: ${detail.slice(0,600)}`});
  checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:false}));
  throw e;
 }
}

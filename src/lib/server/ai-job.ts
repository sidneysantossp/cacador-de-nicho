import 'server-only';
import {checked,db,put} from './db';
import {HttpError} from './auth';
export async function runAiJob(kind:'analyze'|'script'|'channel-study'|'opportunity-report'|'universe-intelligence'|'universe-curves',item:string,work:()=>Promise<unknown>){
 const key=`${kind}:${item}:${Math.floor(Date.now()/300000)}`;
 const token=crypto.randomUUID();
 const acquired=checked(await db().rpc('claim_radar_job',{job_key:key,lease_token:token}));
 if(!acquired)throw new HttpError('Outra tarefa está em execução ou esta solicitação já foi processada. Consulte Atividade.',409);
 const run={id:key,type:kind==='analyze'?'Análise editorial':kind==='channel-study'?'Análise profunda de canal':kind==='opportunity-report'?'Opportunity Report':kind==='universe-intelligence'?'Universe Intelligence':kind==='universe-curves'?'Universe Curves & Gaps':'Rascunho de roteiro',startedAt:new Date().toISOString(),status:'running',message:'Pesquisa e agentes em execução.'};
 try{await put('radar_runs',key,run);await work();await put('radar_runs',key,{...run,status:'completed',message:'Entrega registrada. Consulte as fontes e limitações.'});checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:true}));}
 catch(e){const detail=e instanceof Error?e.message:'Falha não identificada.';await put('radar_runs',key,{...run,status:'failed',message:`Falha: ${detail.slice(0,600)}`});checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:false}));throw e;}
}

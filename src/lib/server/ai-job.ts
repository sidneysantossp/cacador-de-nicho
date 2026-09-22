import 'server-only';
import {checked,db,put} from './db';
import {HttpError} from './auth';
export async function runAiJob(kind:'analyze'|'script'|'channel-study',item:string,work:()=>Promise<unknown>){
 const key=`${kind}:${item}:${Math.floor(Date.now()/300000)}`;
 const token=crypto.randomUUID();
 const acquired=checked(await db().rpc('claim_radar_job',{job_key:key,lease_token:token}));
 if(!acquired)throw new HttpError('Outra tarefa está em execução ou esta solicitação já foi processada. Consulte Atividade.',409);
 const run={id:key,type:kind==='analyze'?'Análise editorial':kind==='channel-study'?'Análise profunda de canal':'Rascunho de roteiro',startedAt:new Date().toISOString(),status:'running',message:'Pesquisa e agentes em execução.'};
 try{await put('radar_runs',key,run);await work();await put('radar_runs',key,{...run,status:'completed',message:'Entrega registrada. Consulte as fontes e limitações.'});checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:true}));}
 catch(e){await put('radar_runs',key,{...run,status:'failed',message:'A tarefa não foi concluída. Verifique as conexões antes de tentar novamente.'});checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:false}));throw e;}
}

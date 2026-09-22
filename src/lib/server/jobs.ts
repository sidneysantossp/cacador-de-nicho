import 'server-only';
import { checked, cleanup, db, list, policyApproved, put, settings } from './db';
import { scan } from './youtube';
import { analyze } from './ai';
import { providerAvailable } from './providers';
import type { Channel, Run } from '@/lib/types';

export async function runRadar(cron=false){
  const config=await settings();
  await cleanup();
  if(cron&&!config.enabled)return 'Monitoramento automático desativado.';

  const key=cron
    ?`daily:${new Date().toISOString().slice(0,10)}`
    :`manual:${Date.now()}:${crypto.randomUUID().slice(0,8)}`;
  const token=crypto.randomUUID();

  // Cron keeps the persistent lease. Manual discovery is intentionally not subject
  // to the database's daily job cap; the UI already prevents duplicate clicks in
  // the same request and opportunity research must remain repeatable.
  if(cron){
    const acquired=checked(await db().rpc('claim_radar_job',{job_key:key,lease_token:token}));
    if(!acquired)return 'A rotina diária já está concluída ou em execução.';
  }

  const startedAt=new Date().toISOString();
  const run:Run={
    id:key,
    type:cron?'Rotina diária':'Pesquisa manual',
    status:'running',
    startedAt,
    message:'Descoberta ampla de oportunidades em execução.'
  };
  await put('radar_runs',key,run);

  try{
    const count=await scan(config);
    if(config.autoAnalyze&&policyApproved()&&await providerAvailable('openai')){
      const candidates=(await list<Channel>('radar_channels',1000))
        .filter(c=>!c.analysis)
        .slice(0,config.maxAnalysesPerRun);
      for(const c of candidates)await analyze(c);
    }
    const message=`Rodada concluída: ${count} canais/sinais foram capturados para investigação. Critérios configurados priorizam sinais, mas não eliminam oportunidades.`;
    await put('radar_runs',key,{...run,status:'completed',message});
    if(cron)checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:true}));
    return message;
  }catch(error){
    await put('radar_runs',key,{
      ...run,
      status:'failed',
      message:error instanceof Error?error.message.slice(0,300):'Rodada interrompida.'
    });
    if(cron)checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:false}));
    throw error;
  }
}

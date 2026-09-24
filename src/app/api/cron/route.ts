import { authConfigured, equal, errorResponse, HttpError } from '@/lib/server/auth';
import { runRadar } from '@/lib/server/jobs';
import { processUniverseImportQueue, runUniverseIntelligence, runUniverseMarketIntelligence, universeQueueSummary } from '@/lib/server/universe';

export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

function authorize(request:Request){
  if(
    !authConfigured()||
    !process.env.CRON_SECRET||
    process.env.CRON_SECRET.length<32||
    !equal(request.headers.get('authorization')??'',`Bearer ${process.env.CRON_SECRET}`)
  )throw new HttpError('Acesso não autorizado.',401);
}

export async function GET(request:Request){
  try{
    authorize(request);
    const url=new URL(request.url);
    const scope=url.pathname.endsWith('/universe')?'universe':url.searchParams.get('scope')??'radar';
    if(scope==='universe'){
      const bootstrap=await processUniverseImportQueue(25);
      const intelligence=await runUniverseIntelligence();
      const queue=await universeQueueSummary();
      return Response.json({scope,bootstrap,intelligence,queue});
    }
    if(scope==='market'){
      const result=await runUniverseMarketIntelligence();
      return Response.json({scope,result});
    }
    if(scope!=='radar')throw new HttpError('Escopo de rotina inválido.',400);
    return Response.json({scope,message:await runRadar(true)});
  }catch(e){
    return errorResponse(e);
  }
}

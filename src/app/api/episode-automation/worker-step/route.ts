import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { advanceClaimedEpisodeAutomationRun } from '@/lib/server/episode-automation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const schema=z.object({
  runId:z.string().uuid(),
  workerToken:z.string().uuid()
}).strict();

function requireWorker(request:Request){
  const expected=(process.env.AUTOMATION_WORKER_SECRET??'').trim();
  if(expected.length<32)throw new HttpError('Automation Worker secret não configurado.',503);
  const supplied=(request.headers.get('x-automation-worker-secret')??'').trim();
  const a=createHash('sha256').update(expected).digest();
  const b=createHash('sha256').update(supplied).digest();
  if(!supplied||a.length!==b.length||!timingSafeEqual(a,b)){
    throw new HttpError('Automation Worker não autorizado.',401);
  }
}

export async function POST(request:Request){
  try{
    requireWorker(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Episode Automation.',503);
    if(Number(request.headers.get('content-length')??0)>5000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Payload do Automation Worker inválido.',400);
    const run=await advanceClaimedEpisodeAutomationRun(parsed.data.runId,parsed.data.workerToken);
    return Response.json({
      ok:true,
      runId:run.id,
      status:run.status,
      currentStep:run.currentStep,
      holdStep:run.holdStep??null,
      lastDecision:run.lastDecision
    });
  }catch(error){return errorResponse(error);}
}

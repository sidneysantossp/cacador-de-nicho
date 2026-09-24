import { z } from 'zod';
import { HttpError, errorResponse } from '@/lib/server/auth';
import { dbConfigured, db } from '@/lib/server/db';
import {
  processClaimedLearningLoopJob, scheduleClosedLoopJobs
} from '@/lib/server/closed-loop-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const schema=z.object({workerToken:z.string().uuid()}).strict();

function configuredSecret(){
  return (process.env.LEARNING_LOOP_WORKER_SECRET??'').trim();
}

export async function POST(request:Request){
  try{
    const secret=configuredSecret();
    if(secret.length<32)throw new HttpError('Closed Loop Worker ainda não está configurado.',503);
    if(request.headers.get('x-learning-loop-worker-secret')!==secret){
      throw new HttpError('Closed Loop Worker não autorizado.',401);
    }
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Closed Loop Intelligence.',503);

    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Payload do Closed Loop Worker inválido.',400);

    const scheduled=await scheduleClosedLoopJobs();
    const claim=await db().rpc('claim_learning_loop_job',{
      p_worker_token:parsed.data.workerToken,
      p_lease_seconds:900
    });
    if(claim.error)throw new HttpError('Falha ao reivindicar Closed Loop job.',502);
    if(!claim.data){
      return Response.json({idle:true,scheduled});
    }

    const job=await processClaimedLearningLoopJob(
      String(claim.data),
      parsed.data.workerToken
    );
    return Response.json({idle:false,scheduled,job});
  }catch(error){return errorResponse(error);}
}

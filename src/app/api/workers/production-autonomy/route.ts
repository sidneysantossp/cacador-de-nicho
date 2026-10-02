import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { claimProductionAutonomyJob, processClaimedProductionAutonomyJob } from '@/lib/server/production-autonomy';

export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=300;
function requireWorker(request:Request){
  const expected=(process.env.PRODUCTION_AUTONOMY_WORKER_SECRET??'').trim(); const supplied=(request.headers.get('x-production-autonomy-worker-secret')??'').trim();
  if(expected.length<32||!supplied)throw new HttpError('Production Autonomy Worker não configurado.',503);
  const a=createHash('sha256').update(expected).digest(); const b=createHash('sha256').update(supplied).digest();
  if(!timingSafeEqual(a,b))throw new HttpError('Production Autonomy Worker não autorizado.',401);
}
export async function POST(request:Request){
  try{requireWorker(request);if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Production Autonomy Worker.',503);const job=await claimProductionAutonomyJob(randomUUID());if(!job)return Response.json({ok:true,status:'idle'});const assessment=await processClaimedProductionAutonomyJob(job);return Response.json({ok:true,status:'completed',assessmentId:assessment.id});}catch(error){return errorResponse(error);}
}

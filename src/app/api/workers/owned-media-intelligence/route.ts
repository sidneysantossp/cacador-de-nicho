import { z } from 'zod';
import { equal, errorResponse, HttpError } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import { analyzeOwnedMediaAsset } from '@/lib/server/owned-media-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=900;

const schema=z.object({
  jobId:z.string().uuid(),
  workerToken:z.string().uuid()
}).strict();

function requireWorker(request:Request){
  const expected=(process.env.OWNED_VISUAL_WORKER_SECRET||process.env.AUTOMATION_WORKER_SECRET||'').trim();
  const actual=(request.headers.get('x-owned-visual-worker-secret')||'').trim();
  if(expected.length<32||!actual||!equal(actual,expected))throw new HttpError('Worker não autorizado.',401);
}

export async function POST(request:Request){
  try{
    requireWorker(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar o worker visual.',503);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Job visual inválido.',400);

    const job=checked(await db().from('radar_owned_media_analysis_jobs')
      .select('id,asset_id,status,worker_token,lease_until')
      .eq('id',parsed.data.jobId)
      .maybeSingle());
    if(!job)throw new HttpError('Job visual não encontrado.',404);
    if(job.status!=='processing'||String(job.worker_token)!==parsed.data.workerToken){
      throw new HttpError('Lease do job visual não pertence a este worker.',409);
    }
    if(job.lease_until&&new Date(String(job.lease_until)).getTime()<Date.now()){
      throw new HttpError('Lease do job visual expirou.',409);
    }

    try{
      const analysis=await analyzeOwnedMediaAsset(String(job.asset_id));
      checked(await db().from('radar_owned_media_analysis_jobs').update({
        status:'completed',
        worker_token:null,
        lease_until:null,
        last_error:null,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq('id',job.id));
      return Response.json({
        message:'Visual Intelligence OWNED concluída.',
        jobId:job.id,
        assetId:job.asset_id,
        segmentCount:analysis.segments.length,
        status:'completed'
      });
    }catch(error){
      const message=error instanceof Error?error.message:'Falha desconhecida.';
      await db().from('radar_owned_media_analysis_jobs').update({
        status:'failed',
        worker_token:null,
        lease_until:null,
        last_error:message.slice(0,4000),
        updated_at:new Date().toISOString()
      }).eq('id',job.id);
      throw error;
    }
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { equal, errorResponse, HttpError } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import { analyzeOwnedMediaAsset, loadOwnedMediaIntelligence, rebuildOwnedMediaVisualMetadata } from '@/lib/server/owned-media-intelligence';
import { ownedVisualRetryPolicy } from '@/lib/owned-media-worker-policy';

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
      .select('id,asset_id,status,worker_token,lease_until,attempts')
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
      const existing=await loadOwnedMediaIntelligence(String(job.asset_id));
      const analysis=existing.status==='completed'&&existing.segments.length
        ?await rebuildOwnedMediaVisualMetadata(String(job.asset_id))
        :await analyzeOwnedMediaAsset(String(job.asset_id));
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
      const status=error instanceof HttpError?error.status:500;
      const attempts=Math.max(1,Number(job.attempts??1));
      const retry=ownedVisualRetryPolicy({status,message,attempts});
      if(retry.retry){
        const delaySeconds=retry.delaySeconds;
        const availableAt=new Date(Date.now()+delaySeconds*1000).toISOString();
        checked(await db().from('radar_owned_media_analysis_jobs').update({
          status:'queued',
          worker_token:null,
          lease_until:null,
          available_at:availableAt,
          last_error:message.slice(0,4000),
          completed_at:null,
          updated_at:new Date().toISOString()
        }).eq('id',job.id));
        return Response.json({
          message:'Falha transitória; nova tentativa agendada.',
          jobId:job.id,
          assetId:job.asset_id,
          status:'retry_scheduled',
          attempt:attempts,
          retryAfterSeconds:delaySeconds,
          storagePressure:retry.storagePressure,
          availableAt
        });
      }
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

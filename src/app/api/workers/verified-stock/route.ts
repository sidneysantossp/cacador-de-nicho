import { z } from 'zod';
import { equal, errorResponse, HttpError } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import { resolveVerifiedStockMediaForScene } from '@/lib/server/stock-media';
import { ownedVisualRetryPolicy } from '@/lib/owned-media-worker-policy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=900;

const schema=z.object({
  jobId:z.string().uuid(),
  workerToken:z.string().uuid()
}).strict();

function requireWorker(request:Request){
  const expected=(
    process.env.VERIFIED_STOCK_WORKER_SECRET||
    process.env.AUTOMATION_WORKER_SECRET||
    ''
  ).trim();
  const actual=(request.headers.get('x-verified-stock-worker-secret')||'').trim();
  if(expected.length<32||!actual||!equal(actual,expected)){
    throw new HttpError('Worker stock não autorizado.',401);
  }
}

export async function POST(request:Request){
  try{
    requireWorker(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar o worker stock.',503);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Job stock inválido.',400);

    const job=checked(await db().from('radar_verified_stock_jobs')
      .select('id,visual_prompt_set_id,scene_id,status,worker_token,lease_until,attempts,query,desired_duration_seconds,orientation,providers,max_candidates_per_provider')
      .eq('id',parsed.data.jobId)
      .maybeSingle());
    if(!job)throw new HttpError('Job stock não encontrado.',404);
    if(job.status!=='processing'||String(job.worker_token)!==parsed.data.workerToken){
      throw new HttpError('Lease do job stock não pertence a este worker.',409);
    }
    if(job.lease_until&&new Date(String(job.lease_until)).getTime()<Date.now()){
      throw new HttpError('Lease do job stock expirou.',409);
    }

    const selected=checked(await db().from('radar_scene_assets')
      .select('id,source_type,provider')
      .eq('visual_prompt_set_id',String(job.visual_prompt_set_id))
      .eq('scene_id',String(job.scene_id))
      .eq('selected',true)
      .eq('status','ready')
      .maybeSingle());

    if(selected){
      const result={
        status:'skipped',
        reason:'selected-ready',
        assetId:String(selected.id),
        sourceType:String(selected.source_type??''),
        provider:selected.provider?String(selected.provider):null
      };
      checked(await db().from('radar_verified_stock_jobs').update({
        status:'completed',
        worker_token:null,
        lease_until:null,
        result,
        last_error:null,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq('id',job.id));
      return Response.json({
        message:'Cena já estava resolvida; job stock encerrado.',
        jobId:job.id,
        status:'completed',
        result
      });
    }

    try{
      const providers=(Array.isArray(job.providers)?job.providers:[])
        .filter((item):item is 'pexels'|'pixabay'|'unsplash'|'vecteezy'=>
          item==='pexels'||item==='pixabay'||item==='unsplash'||item==='vecteezy'
        );
      const result=await resolveVerifiedStockMediaForScene({
        promptSetId:String(job.visual_prompt_set_id),
        sceneId:String(job.scene_id),
        query:String(job.query),
        desiredDurationSeconds:Number(job.desired_duration_seconds),
        orientation:job.orientation as 'landscape'|'portrait'|'any',
        providers,
        maxCandidatesPerProvider:Number(job.max_candidates_per_provider)
      });

      checked(await db().from('radar_verified_stock_jobs').update({
        status:'completed',
        worker_token:null,
        lease_until:null,
        result,
        last_error:null,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq('id',job.id));

      return Response.json({
        message:result.status==='matched'
          ?'Fallback stock verificado concluiu com match.'
          :'Fallback stock verificado concluiu sem match forte.',
        jobId:job.id,
        status:'completed',
        result
      });
    }catch(error){
      const message=error instanceof Error?error.message:'Falha desconhecida.';
      const status=error instanceof HttpError?error.status:500;
      const attempts=Math.max(1,Number(job.attempts??1));
      const retry=ownedVisualRetryPolicy({status,message,attempts});
      if(retry.retry){
        const availableAt=new Date(Date.now()+retry.delaySeconds*1000).toISOString();
        checked(await db().from('radar_verified_stock_jobs').update({
          status:'queued',
          worker_token:null,
          lease_until:null,
          available_at:availableAt,
          last_error:message.slice(0,4000),
          completed_at:null,
          updated_at:new Date().toISOString()
        }).eq('id',job.id));
        return Response.json({
          message:'Falha stock transitória; nova tentativa agendada.',
          jobId:job.id,
          status:'retry_scheduled',
          attempt:attempts,
          retryAfterSeconds:retry.delaySeconds,
          storagePressure:retry.storagePressure,
          availableAt
        });
      }

      checked(await db().from('radar_verified_stock_jobs').update({
        status:'failed',
        worker_token:null,
        lease_until:null,
        last_error:message.slice(0,4000),
        updated_at:new Date().toISOString()
      }).eq('id',job.id));
      throw error;
    }
  }catch(error){
    return errorResponse(error);
  }
}

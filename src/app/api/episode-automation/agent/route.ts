import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  advanceEpisodeAutomationRun,
  reconcileEpisodeAutomationRun,
  resumeEpisodeAutomationRun
} from '@/lib/server/episode-automation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const querySchema=z.object({
  action:z.enum(['reconcile','advance','resume']),
  runId:z.string().uuid()
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Episode Automation.',503);

    const url=new URL(request.url);
    const parsed=querySchema.safeParse({
      action:url.searchParams.get('action'),
      runId:url.searchParams.get('runId')
    });
    if(!parsed.success)throw new HttpError('Revise action e runId do Agent Automation.',400);

    const {action,runId}=parsed.data;
    const run=action==='advance'
      ?await advanceEpisodeAutomationRun(runId)
      :action==='resume'
        ?await resumeEpisodeAutomationRun(runId)
        :await reconcileEpisodeAutomationRun(runId);

    return Response.json({
      message:action==='advance'
        ?'Uma transição segura foi executada.'
        :action==='resume'
          ?'Hold removido. O run pode tentar a etapa novamente.'
          :'Estado reconciliado com os engines.',
      run
    });
  }catch(error){
    return errorResponse(error);
  }
}

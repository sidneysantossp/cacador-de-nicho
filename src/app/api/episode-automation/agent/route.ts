import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  advanceEpisodeAutomationRun,
  armOperatorFactoryAutomationRun,
  drainEpisodeAutomationRun,
  reconcileEpisodeAutomationRun,
  resumeEpisodeAutomationRun
} from '@/lib/server/episode-automation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const querySchema=z.object({
  action:z.enum(['reconcile','advance','resume','armFactory','drain']),
  runId:z.string().uuid(),
  target:z.enum(['master','package','publish']).optional(),
  maxTransitions:z.coerce.number().int().min(1).max(100).optional(),
  maxDurationMs:z.coerce.number().int().min(5000).max(280000).optional()
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Episode Automation.',503);

    const url=new URL(request.url);
    const parsed=querySchema.safeParse({
      action:url.searchParams.get('action'),
      runId:url.searchParams.get('runId'),
      target:url.searchParams.get('target')??undefined,
      maxTransitions:url.searchParams.get('maxTransitions')??undefined,
      maxDurationMs:url.searchParams.get('maxDurationMs')??undefined
    });
    if(!parsed.success)throw new HttpError('Revise action e runId do Agent Automation.',400);

    const {action,runId}=parsed.data;
    if(action==='drain'){
      const result=await drainEpisodeAutomationRun({
        runId,
        target:parsed.data.target,
        maxTransitions:parsed.data.maxTransitions,
        maxDurationMs:parsed.data.maxDurationMs
      });
      return Response.json({
        message:result.targetReached
          ?'Golden Path atingiu o alvo '+result.target+'.'
          :'Golden Path drenado até '+result.stopReason+'.',
        ...result
      });
    }

    const run=action==='advance'
      ?await advanceEpisodeAutomationRun(runId)
      :action==='armFactory'
        ?await armOperatorFactoryAutomationRun(runId)
        :action==='resume'
          ?await resumeEpisodeAutomationRun(runId)
          :await reconcileEpisodeAutomationRun(runId);

    return Response.json({
      message:action==='advance'
        ?'Uma transição segura foi executada.'
        :action==='armFactory'
          ?'Golden Path armado para operação pelo ChatGPT até o master aprovado.'
          :action==='resume'
            ?'Hold removido. O run pode tentar a etapa novamente.'
            :'Estado reconciliado com os engines.',
      run
    });
  }catch(error){
    return errorResponse(error);
  }
}

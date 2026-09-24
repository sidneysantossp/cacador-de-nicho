import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  advanceEpisodeAutomationRun, cancelEpisodeAutomationRun, createEpisodeAutomationRun,
  episodeAutomationChannelState, listEpisodeAutomationEvents,
  loadEpisodeAutomationRun, reconcileEpisodeAutomationRun, resumeEpisodeAutomationRun,
  updateEpisodeAutomationRun
} from '@/lib/server/episode-automation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const policySchema=z.object({
  autoGenerateScript:z.boolean().optional(),
  autoApproveObjectiveGates:z.boolean().optional(),
  autoGenerateVoice:z.boolean().optional(),
  autoCreateTranscript:z.boolean().optional(),
  autoCreateScenes:z.boolean().optional(),
  autoGenerateVisualPrompts:z.boolean().optional(),
  autoGenerateVisualAssets:z.boolean().optional(),
  autoBuildTimeline:z.boolean().optional(),
  autoCreateVideoEdit:z.boolean().optional(),
  autoRender:z.boolean().optional(),
  autoRunQuality:z.boolean().optional(),
  autoCreatePackage:z.boolean().optional(),
  autoPublish:z.boolean().optional()
}).strict();

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('create'),
    contentProjectId:z.string().uuid(),
    mode:z.enum(['assisted','autonomous'])
  }).strict(),
  z.object({action:z.literal('reconcile'),runId:z.string().uuid()}).strict(),
  z.object({action:z.literal('advance'),runId:z.string().uuid()}).strict(),
  z.object({action:z.literal('resume'),runId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('update'),
    runId:z.string().uuid(),
    mode:z.enum(['assisted','autonomous']).optional(),
    policy:policySchema.optional()
  }).strict(),
  z.object({action:z.literal('cancel'),runId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Episode Automation.',503);
    const url=new URL(request.url);
    const runId=url.searchParams.get('runId')?.trim();
    if(runId){
      if(!z.string().uuid().safeParse(runId).success)throw new HttpError('Automation Run inválido.',400);
      const run=await loadEpisodeAutomationRun(runId);
      if(!run)throw new HttpError('Automation Run não encontrado.',404);
      return Response.json({
        run:await reconcileEpisodeAutomationRun(runId),
        events:await listEpisodeAutomationEvents(runId,150)
      },{headers:{'Cache-Control':'no-store'}});
    }

    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await episodeAutomationChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Episode Automation.',503);
    if(Number(request.headers.get('content-length')??0)>30000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do Episode Automation.',400);
    const body=parsed.data;

    if(body.action==='create'){
      const run=await createEpisodeAutomationRun(body);
      return Response.json({message:'Automation Run criado e reconciliado.',run});
    }
    if(body.action==='reconcile'){
      const run=await reconcileEpisodeAutomationRun(body.runId);
      return Response.json({message:'Estado reconciliado com os engines.',run});
    }
    if(body.action==='advance'){
      const run=await advanceEpisodeAutomationRun(body.runId);
      return Response.json({message:'Uma transição segura foi executada.',run});
    }
    if(body.action==='resume'){
      const run=await resumeEpisodeAutomationRun(body.runId);
      return Response.json({message:'Hold removido. O run pode tentar a etapa novamente.',run});
    }
    if(body.action==='update'){
      const run=await updateEpisodeAutomationRun(body);
      return Response.json({message:'Política de automação atualizada.',run});
    }
    const run=await cancelEpisodeAutomationRun(body.runId);
    return Response.json({message:'Automation Run cancelado.',run});
  }catch(error){return errorResponse(error);}
}

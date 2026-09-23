import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createScenePlanFromTranscript, listScenePlans, loadScenePlan,
  loadScenePlanHistory, saveScenePlan
} from '@/lib/server/scene-timecode';
import { scenePlanPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),transcriptId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    plan:scenePlanPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Scene Timecode Protocol.',503);
    const url=new URL(request.url);
    const planId=url.searchParams.get('planId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(planId){
      if(!z.string().uuid().safeParse(planId).success)throw new HttpError('Scene Plan inválido.',400);
      const [plan,history]=await Promise.all([
        loadScenePlan(planId),
        loadScenePlanHistory(planId,20)
      ]);
      if(!plan)throw new HttpError('Scene Plan não encontrado.',404);
      return Response.json({plan,history},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({plans:await listScenePlans(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Scene Timecode Protocol.',503);
    if(Number(request.headers.get('content-length')??0)>600000)throw new HttpError('Scene Plan muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Scene Timecode Protocol.',400);
    const body=parsed.data;

    const plan=body.action==='create'
      ?await createScenePlanFromTranscript(body.transcriptId)
      :await saveScenePlan(body.plan,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='create'
        ?'Scene Plan criado a partir do transcript aprovado.'
        :body.status==='approved'
          ?'Scene Plan aprovado e episódio movido para produção.'
          :'Scene Plan salvo.',
      plan,
      history:await loadScenePlanHistory(plan.id,20)
    });
  }catch(e){return errorResponse(e);}
}

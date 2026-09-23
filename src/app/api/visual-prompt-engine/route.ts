import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createVisualPromptSet, generateVisualPromptDrafts, listVisualPromptSets,
  loadVisualPromptSet, loadVisualPromptSetHistory, saveVisualPromptSet
} from '@/lib/server/visual-prompt-engine';
import { listScenePlans, loadScenePlan } from '@/lib/server/scene-timecode';
import { loadProductionDna } from '@/lib/server/production-dna';
import { visualPromptSetPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),scenePlanId:z.string().uuid()}).strict(),
  z.object({action:z.literal('generate'),setId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    promptSet:visualPromptSetPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Prompt Engine.',503);
    const url=new URL(request.url);
    const setId=url.searchParams.get('setId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(setId){
      if(!z.string().uuid().safeParse(setId).success)throw new HttpError('Visual Prompt Set inválido.',400);
      const [promptSet,history]=await Promise.all([
        loadVisualPromptSet(setId),
        loadVisualPromptSetHistory(setId,20)
      ]);
      if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
      const [scenePlan,productionDna]=await Promise.all([
        loadScenePlan(promptSet.scenePlanId),
        loadProductionDna(promptSet.channelId)
      ]);
      return Response.json({promptSet,history,scenePlan,productionDna},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [promptSets,scenePlans]=await Promise.all([
      listVisualPromptSets(channelId),
      listScenePlans(channelId)
    ]);
    return Response.json({
      promptSets,
      scenePlans:scenePlans.filter(item=>item.status==='approved')
    },{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Prompt Engine.',503);
    if(Number(request.headers.get('content-length')??0)>1000000)throw new HttpError('Visual Prompt Set muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Visual Prompt Engine.',400);
    const body=parsed.data;

    let promptSet;
    if(body.action==='create')promptSet=await createVisualPromptSet(body.scenePlanId);
    else if(body.action==='generate')promptSet=await generateVisualPromptDrafts(body.setId);
    else promptSet=await saveVisualPromptSet(body.promptSet,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='create'
        ?'Visual Prompt Set criado.'
        :body.action==='generate'
          ?'Direções visuais atualizadas sem alterar os timecodes.'
          :body.status==='approved'
            ?'Visual Prompt Set aprovado.'
            :'Visual Prompt Set salvo.',
      promptSet,
      history:await loadVisualPromptSetHistory(promptSet.id,20)
    });
  }catch(e){return errorResponse(e);}
}

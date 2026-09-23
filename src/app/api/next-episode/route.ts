import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  acceptNextEpisodeCandidate, generateNextEpisodePlan,
  loadNextEpisodePlan, loadNextEpisodePlanHistory, nextEpisodeChannelState
} from '@/lib/server/next-episode';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('generate'),
    channelId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('accept'),
    planId:z.string().uuid(),
    candidateId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    notes:z.string().max(5000).default('')
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Next Episode Strategist.',503);
    const url=new URL(request.url);
    const planId=url.searchParams.get('planId')?.trim();
    if(planId){
      if(!z.string().uuid().safeParse(planId).success)throw new HttpError('Next Episode Plan inválido.',400);
      const plan=await loadNextEpisodePlan(planId);
      if(!plan)throw new HttpError('Next Episode Plan não encontrado.',404);
      return Response.json({
        plan,
        history:await loadNextEpisodePlanHistory(planId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await nextEpisodeChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Next Episode Strategist.',503);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do Next Episode Strategist.',400);
    const body=parsed.data;

    if(body.action==='generate'){
      const result=await generateNextEpisodePlan(body.channelId);
      return Response.json({
        message:result.created
          ?'Next Episode Plan gerado com evidências do Channel Brain.'
          :'O Brain não mudou; o plano ativo existente foi reutilizado.',
        ...result
      });
    }

    const result=await acceptNextEpisodeCandidate(body);
    return Response.json({
      message:result.alreadyAccepted
        ?'Este plano já havia sido aceito.'
        :'Próximo episódio criado e enviado ao Content OS como brief.',
      ...result
    });
  }catch(error){return errorResponse(error);}
}

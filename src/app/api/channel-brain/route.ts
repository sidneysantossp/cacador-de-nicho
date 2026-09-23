import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadChannelBrain, loadChannelBrainHistory, saveChannelBrain } from '@/lib/server/channel-brain';
import { channelBrainPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const saveSchema=z.object({
  expectedVersion:z.number().int().min(0).max(100000).nullable(),
  brain:channelBrainPayloadSchema
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Channel Brain.',503);
    const channelId=new URL(request.url).searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [brain,history]=await Promise.all([
      loadChannelBrain(channelId),
      loadChannelBrainHistory(channelId,20)
    ]);
    return Response.json({brain,history},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Channel Brain.',503);
    if(Number(request.headers.get('content-length')??0)>120000)throw new HttpError('Channel Brain muito extenso.',413);
    const parsed=saveSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Channel Brain e tente novamente.',400);
    const brain=await saveChannelBrain(parsed.data.brain,parsed.data.expectedVersion);
    const history=await loadChannelBrainHistory(brain.channelId,20);
    return Response.json({message:`Channel Brain salvo como versão ${brain.version}.`,brain,history});
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { listLinkedYouTubeChannels, validateLinkedYouTubeChannel } from '@/lib/server/youtube-oauth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('validate'),youtubeChannelId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para listar canais YouTube conectados.',503);
    return Response.json({
      channels:await listLinkedYouTubeChannels()
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para validar canais YouTube.',503);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a ação do canal YouTube.',400);
    return Response.json({
      message:'Conexão YouTube validada.',
      channel:await validateLinkedYouTubeChannel(parsed.data.youtubeChannelId)
    });
  }catch(error){return errorResponse(error);}
}

import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  cancelYouTubePublication, queueYouTubePublication,
  retryYouTubePublication, youtubePublisherChannelState
} from '@/lib/server/youtube-publisher';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('queue'),packageId:z.string().uuid()}).strict(),
  z.object({action:z.literal('cancel'),jobId:z.string().uuid()}).strict(),
  z.object({action:z.literal('retry'),jobId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar YouTube Publisher.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await youtubePublisherChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar YouTube Publisher.',503);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a ação de publicação.',400);
    const body=parsed.data;
    if(body.action==='queue'){
      return Response.json({
        message:'Publicação enfileirada para o YouTube.',
        job:await queueYouTubePublication(body.packageId)
      });
    }
    if(body.action==='cancel'){
      return Response.json({
        message:'Publicação cancelada.',
        job:await cancelYouTubePublication(body.jobId)
      });
    }
    return Response.json({
      message:'Publicação reenfileirada.',
      job:await retryYouTubePublication(body.jobId)
    });
  }catch(error){return errorResponse(error);}
}

import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  disconnectYouTube, loadYouTubeConnection, validateYouTubeConnection
} from '@/lib/server/youtube-oauth';
import { youtubeOAuthConfig } from '@/lib/server/youtube-secrets';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('validate'),channelId:z.string().uuid()}).strict(),
  z.object({action:z.literal('disconnect'),channelId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar YouTube Connection.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const config=youtubeOAuthConfig();
    return Response.json({
      configured:config.configured,
      missing:config.missing,
      connection:await loadYouTubeConnection(channelId)
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar YouTube Connection.',503);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a ação da conexão YouTube.',400);
    const body=parsed.data;
    const connection=body.action==='validate'
      ?await validateYouTubeConnection(body.channelId)
      :await disconnectYouTube(body.channelId);
    return Response.json({
      message:body.action==='validate'?'Conexão YouTube validada.':'Conexão YouTube desconectada.',
      connection
    });
  }catch(error){return errorResponse(error);}
}

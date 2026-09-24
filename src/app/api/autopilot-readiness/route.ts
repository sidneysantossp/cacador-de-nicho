import { z } from 'zod';
import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadAutopilotReadiness } from '@/lib/server/autopilot-readiness';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
 try{
  if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
  if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Autopilot Readiness.',503);
  const url=new URL(request.url);
  const channelId=url.searchParams.get('channelId')?.trim();
  if(!channelId||!z.string().uuid().safeParse(channelId).success){
   throw new HttpError('Canal inválido.',400);
  }
  return Response.json(await loadAutopilotReadiness(channelId),{
   headers:{'Cache-Control':'no-store'}
  });
 }catch(error){return errorResponse(error);}
}

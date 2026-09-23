import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import { youtubeAuthorizationUrl } from '@/lib/server/youtube-oauth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!/^[0-9a-f-]{36}$/i.test(channelId))throw new HttpError('Canal inválido.',400);
    const authorization=youtubeAuthorizationUrl(channelId);
    return Response.redirect(authorization.url,302);
  }catch(error){return errorResponse(error);}
}

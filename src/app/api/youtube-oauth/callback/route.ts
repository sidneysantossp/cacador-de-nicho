import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import {
  exchangeYouTubeAuthorizationCode, fetchOwnYouTubeChannel,
  saveYouTubeConnection, verifyYouTubeOAuthState
} from '@/lib/server/youtube-oauth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Sessão da operação expirada durante OAuth.',401);
    const url=new URL(request.url);
    const oauthError=url.searchParams.get('error');
    if(oauthError)throw new HttpError('Autorização do YouTube não concluída: '+oauthError+'.',400);
    const code=url.searchParams.get('code')?.trim();
    const state=url.searchParams.get('state')?.trim();
    if(!code||!state)throw new HttpError('Callback OAuth incompleto.',400);

    const statePayload=verifyYouTubeOAuthState(state);
    const tokens=await exchangeYouTubeAuthorizationCode(code);
    if(!tokens.refresh_token){
      throw new HttpError('O Google não retornou refresh token. Reconecte o canal e confirme o consentimento.',409);
    }
    const own=await fetchOwnYouTubeChannel(tokens.access_token!);
    const scopes=(tokens.scope??'').split(/\s+/).map(value=>value.trim()).filter(Boolean);
    await saveYouTubeConnection({
      channelId:statePayload.channelId,
      refreshToken:tokens.refresh_token,
      scopes,
      ...own
    });

    const redirect=new URL('/',request.url);
    redirect.searchParams.set('youtube','connected');
    redirect.searchParams.set('channelId',statePayload.channelId);
    return Response.redirect(redirect,302);
  }catch(error){return errorResponse(error);}
}

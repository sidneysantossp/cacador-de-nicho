import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import { exchangeNexLevCode, saveNexLevConnection, verifyNexLevState } from '@/lib/server/nexlev';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function cookie(request:Request,name:string){
  return request.headers.get('cookie')
    ?.split(';').map(item=>item.trim())
    .find(item=>item.startsWith(name+'='))
    ?.slice(name.length+1);
}

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Sessão da operação expirada durante OAuth do NexLev.',401);
    const url=new URL(request.url);
    const oauthError=url.searchParams.get('error');
    if(oauthError)throw new HttpError('Autorização NexLev não concluída: '+oauthError+'.',400);
    const code=url.searchParams.get('code')?.trim();
    const state=url.searchParams.get('state')?.trim();
    const verifierRaw=cookie(request,'nexlev_pkce');
    if(!code||!state||!verifierRaw)throw new HttpError('Callback OAuth NexLev incompleto.',400);

    const payload=verifyNexLevState(state);
    const verifier=decodeURIComponent(verifierRaw);
    const token=await exchangeNexLevCode({
      code,
      clientId:payload.clientId,
      redirectUri:payload.redirectUri,
      verifier
    });
    await saveNexLevConnection({
      clientId:payload.clientId,
      redirectUri:payload.redirectUri,
      accessToken:token.access_token!,
      refreshToken:token.refresh_token,
      expiresIn:token.expires_in,
      scope:token.scope
    });

    const redirect=new URL('/',payload.redirectUri);
    redirect.searchParams.set('nexlev','connected');
    const response=Response.redirect(redirect,302);
    response.headers.append(
      'Set-Cookie',
      'nexlev_pkce=; HttpOnly; SameSite=Lax; Path=/api/nexlev-oauth; Max-Age=0'+
      (process.env.NODE_ENV==='production'?'; Secure':'')
    );
    return response;
  }catch(error){return errorResponse(error);}
}

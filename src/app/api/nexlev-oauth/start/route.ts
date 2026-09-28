import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import { createPkce, nexLevAuthorizationUrl, registerNexLevClient } from '@/lib/server/nexlev';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function first(value:string|null){return value?.split(',')[0]?.trim()||'';}
function publicOrigin(request:Request){
  const proto=first(request.headers.get('x-forwarded-proto'));
  const host=first(request.headers.get('x-forwarded-host'))||request.headers.get('host')?.trim()||'';
  if(proto&&host&&(proto==='http'||proto==='https'))return proto+'://'+host;
  return new URL(request.url).origin;
}

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para conectar o NexLev.',401);
    const redirectUri=publicOrigin(request)+'/api/nexlev-oauth/callback';
    const client=await registerNexLevClient(redirectUri);
    const pkce=createPkce();
    const authorization=nexLevAuthorizationUrl({
      clientId:client.clientId,
      redirectUri,
      challenge:pkce.challenge
    });
    const response=new Response(null,{status:302,headers:{Location:authorization.url}});
    response.headers.append(
      'Set-Cookie',
      'nexlev_pkce='+encodeURIComponent(pkce.verifier)+
      '; HttpOnly; SameSite=Lax; Path=/api/nexlev-oauth; Max-Age=600'+
      (process.env.NODE_ENV==='production'?'; Secure':'')
    );
    return response;
  }catch(error){return errorResponse(error);}
}

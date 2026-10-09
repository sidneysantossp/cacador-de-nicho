import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const cookieName = 'niche_session';
export const agentOperatorHeader = 'x-cacadores-agent-secret';

const agentOperatorPaths=[
  '/api/actions',
  '/api/audience-intelligence',
  '/api/asset-factory',
  '/api/audio-library',
  '/api/autopilot-readiness',
  '/api/channel-brain',
  '/api/content-os',
  '/api/database-backup',
  '/api/episode-automation',
  '/api/external-import',
  '/api/media-library',
  '/api/nexlev-evidence',
  '/api/nexlev-intelligence',
  '/api/narrative',
  '/api/next-episode',
  '/api/operator-analysis',
  '/api/owned-media',
  '/api/performance-analyst',
  '/api/production-dna',
  '/api/production-autonomy',
  '/api/production-quality',
  '/api/publication-package',
  '/api/radar',
  '/api/render-engine',
  '/api/render-engine/events',
  '/api/scene-timecode',
  '/api/script-engine',
  '/api/stock-media',
  '/api/timeline-engine',
  '/api/transcription-engine',
  '/api/video-editor',
  '/api/visual-intelligence',
  '/api/visual-prompt-engine',
  '/api/voice-engine',
  '/api/youtube-channels',
  '/api/youtube-connection',
  '/api/youtube-publisher',
  '/api/youtube-publisher/events'
] as const;

export const authConfigured = () =>
  (process.env.APP_PASSWORD?.length ?? 0) >= 16 &&
  (process.env.SESSION_SECRET?.length ?? 0) >= 32;

export const agentOperatorConfigured = () =>
  (process.env.AGENT_OPERATOR_SECRET?.trim().length ?? 0) >= 32;

export function equal(a:string,b:string){
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}

export function createSession(now=Date.now()){
  const payload=`${now+12*3600000}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${createHmac('sha256',process.env.SESSION_SECRET!+':'+process.env.APP_PASSWORD!).update(payload).digest('hex')}`;
}

export function validSession(token:string|undefined,now=Date.now()){
  if(!authConfigured()||!token)return false;
  const parts=token.split('.');
  if(parts.length!==3||!/^\d+$/.test(parts[0])||Number(parts[0])<=now||Number(parts[0])>now+12*3600000)return false;
  return equal(
    parts[2],
    createHmac('sha256',process.env.SESSION_SECRET!+':'+process.env.APP_PASSWORD!)
      .update(parts.slice(0,2).join('.')).digest('hex')
  );
}

function browserSession(request:Request){
  const token=request.headers.get('cookie')
    ?.split(';')
    .map(x=>x.trim())
    .find(x=>x.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length+1);
  return validSession(token);
}

function agentPathAllowed(request:Request){
  let pathname='';
  try{pathname=new URL(request.url).pathname;}catch{return false;}
  return agentOperatorPaths.some(prefix=>pathname===prefix||pathname.startsWith(prefix+'/'));
}

export function agentAuthenticated(request:Request){
  const expected=process.env.AGENT_OPERATOR_SECRET?.trim()??'';
  const supplied=request.headers.get(agentOperatorHeader)?.trim()??'';
  if(expected.length<32||!supplied||!agentPathAllowed(request))return false;
  return equal(supplied,expected);
}

export function authenticated(request:Request){
  return agentAuthenticated(request)||browserSession(request);
}

export function sessionCookie(value:string,maxAge=43200){
  return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;
}

function firstForwarded(value:string|null){
  return value?.split(',')[0]?.trim()||null;
}

export function sameOrigin(request:Request){
  const origin=request.headers.get('origin');
  if(!origin)return false;

  const directOrigin=new URL(request.url).origin;
  if(origin===directOrigin)return true;

  const proto=firstForwarded(request.headers.get('x-forwarded-proto'));
  const host=firstForwarded(request.headers.get('x-forwarded-host'))??request.headers.get('host')?.trim()??null;
  if(!proto||!host||(proto!=='http'&&proto!=='https'))return false;

  try{
    return origin===new URL(`${proto}://${host}`).origin;
  }catch{
    return false;
  }
}

export function requireOperator(request:Request){
  if(agentAuthenticated(request)){
    const pathname=(()=>{try{return new URL(request.url).pathname;}catch{return 'unknown';}})();
    console.info(JSON.stringify({
      event:'agent-operator-api',
      method:request.method,
      path:pathname
    }));
    return;
  }
  if(!sameOrigin(request))throw new HttpError('Origem da solicitação inválida.',403);
  if(!browserSession(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
}

export class HttpError extends Error{
  constructor(message:string,public status=400){super(message);}
}

export function errorResponse(error:unknown){
  return Response.json(
    {message:error instanceof HttpError?error.message:'Não foi possível concluir. Verifique as integrações e tente novamente.'},
    {status:error instanceof HttpError?error.status:500}
  );
}

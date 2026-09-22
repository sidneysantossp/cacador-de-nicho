import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
export const cookieName = 'niche_session';
export const authConfigured = () => (process.env.APP_PASSWORD?.length ?? 0) >= 16 && (process.env.SESSION_SECRET?.length ?? 0) >= 32;
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
export function createSession(now = Date.now()) { const payload = `${now + 12*3600000}.${randomBytes(16).toString('hex')}`; return `${payload}.${createHmac('sha256',process.env.SESSION_SECRET!+':'+process.env.APP_PASSWORD!).update(payload).digest('hex')}`; }
export function validSession(token: string | undefined, now = Date.now()) { if (!authConfigured() || !token) return false; const parts=token.split('.'); if(parts.length!==3 || !/^\d+$/.test(parts[0]) || Number(parts[0])<=now || Number(parts[0])>now+12*3600000) return false; return equal(parts[2],createHmac('sha256',process.env.SESSION_SECRET!+':'+process.env.APP_PASSWORD!).update(parts.slice(0,2).join('.')).digest('hex')); }
export function authenticated(request: Request) { const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1); return validSession(token); }
export function sameOrigin(request: Request) { const origin=request.headers.get('origin'); return !!origin && origin===new URL(request.url).origin; }
export function requireOperator(request: Request) { if(!sameOrigin(request)) throw new HttpError('Origem da solicitação inválida.',403); if(!authenticated(request)) throw new HttpError('Entre com a senha da operação para continuar.',401); }
export class HttpError extends Error { constructor(message:string,public status=400){super(message);} }
export function errorResponse(error:unknown) { return Response.json({message:error instanceof HttpError?error.message:'Não foi possível concluir. Verifique as integrações e tente novamente.'},{status:error instanceof HttpError?error.status:500}); }

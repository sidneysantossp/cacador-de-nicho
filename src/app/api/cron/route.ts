import { authConfigured, equal, errorResponse, HttpError } from '@/lib/server/auth';
import { runRadar } from '@/lib/server/jobs';
export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(!authConfigured()||!process.env.CRON_SECRET||process.env.CRON_SECRET.length<32||!equal(request.headers.get('authorization')??'',`Bearer ${process.env.CRON_SECRET}`))throw new HttpError('Acesso não autorizado.',401);return Response.json({message:await runRadar(true)});}catch(e){return errorResponse(e);}}

import { demoData } from '@/lib/demo';
import { authenticated, authConfigured, errorResponse } from '@/lib/server/auth';
import { dbConfigured, loadRadar, policyApproved } from '@/lib/server/db';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const auth=authenticated(request);const integrations=[{id:'youtube',name:'YouTube Data API',configured:!!process.env.YOUTUBE_API_KEY,detail:'Descoberta e estatísticas públicas.'},{id:'supabase',name:'Supabase',configured:dbConfigured(),detail:'Memória privada da operação.'},{id:'openai',name:'OpenAI',configured:!!process.env.OPENAI_API_KEY,detail:'Pesquisa assistida e propostas.'}];const flags={authenticated:auth,authConfigured:authConfigured(),policyApproved:policyApproved(),integrations};return Response.json(auth&&dbConfigured()?{...await loadRadar(),...flags,mode:'live'}:{...demoData,...flags,mode:'demo'},{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}

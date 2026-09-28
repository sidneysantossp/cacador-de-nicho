import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { disconnectNexLev, nexLevConnectionStatus, validateNexLevConnection } from '@/lib/server/nexlev';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de conectar o NexLev.',503);
    return Response.json({connection:await nexLevConnectionStatus()});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de alterar o NexLev.',503);
    const body=await request.json().catch(()=>({})) as {action?:unknown};
    if(body.action==='validate'){
      return Response.json({message:'Conexão NexLev validada.',connection:await validateNexLevConnection()});
    }
    if(body.action==='disconnect'){
      return Response.json({message:'Conexão NexLev removida.',connection:await disconnectNexLev()});
    }
    throw new HttpError('Ação NexLev inválida.',400);
  }catch(error){return errorResponse(error);}
}

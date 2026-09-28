import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { callNexLevTool, listNexLevTools } from '@/lib/server/nexlev';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

export async function GET(request:Request){
  try{
    requireOperator(request);
    const tools=await listNexLevTools();
    return Response.json({tools});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    const body=await request.json().catch(()=>({})) as {tool?:unknown;arguments?:unknown};
    const tool=typeof body.tool==='string'?body.tool.trim():'';
    const args=body.arguments&&typeof body.arguments==='object'&&!Array.isArray(body.arguments)
      ?body.arguments as Record<string,unknown>
      :{};
    if(!tool)throw new HttpError('Informe a ferramenta NexLev.',400);
    const tools=await listNexLevTools();
    if(!tools.some(item=>item.name===tool))throw new HttpError('Ferramenta NexLev não disponível nesta conta.',404);
    const result=await callNexLevTool(tool,args);
    return Response.json({tool,result});
  }catch(error){return errorResponse(error);}
}

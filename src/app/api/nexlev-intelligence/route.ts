import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { callNexLevTool, listNexLevTools, nexLevConnectionStatus } from '@/lib/server/nexlev';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const callSchema=z.object({
  action:z.literal('call'),
  tool:z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  arguments:z.record(z.string(),z.unknown()).optional().default({})
}).strict();

export async function GET(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de usar NexLev Intelligence.',503);
    const [connection,tools]=await Promise.all([
      nexLevConnectionStatus(),
      listNexLevTools()
    ]);
    return Response.json({
      connection,
      tools:tools.map(tool=>({
        name:tool.name,
        description:tool.description,
        inputSchema:tool.inputSchema
      }))
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de usar NexLev Intelligence.',503);
    if(Number(request.headers.get('content-length')??0)>50000)throw new HttpError('Solicitação NexLev muito extensa.',413);
    const parsed=callSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a ferramenta e os argumentos NexLev.',400);

    const tools=await listNexLevTools();
    if(!tools.some(tool=>tool.name===parsed.data.tool)){
      throw new HttpError('A ferramenta NexLev solicitada não está disponível nesta conta.',404);
    }
    const result=await callNexLevTool(parsed.data.tool,parsed.data.arguments);
    return Response.json({tool:parsed.data.tool,result});
  }catch(error){return errorResponse(error);}
}

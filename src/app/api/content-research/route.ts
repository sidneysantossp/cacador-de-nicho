import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { generateContentResearchForProject } from '@/lib/server/content-research-ai';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const schema=z.object({
  projectId:z.string().uuid()
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o banco para usar Research Pack.',503);
    if(Number(request.headers.get('content-length')??0)>5000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Content Project inválido para pesquisa.',400);
    const project=await generateContentResearchForProject(parsed.data.projectId);
    const supported=project.research.factChecks.filter(item=>item.status==='supported').length;
    return Response.json({
      message:'Research Pack processado explicitamente pelo operador.',
      projectId:project.id,
      version:project.version,
      status:project.status,
      sources:project.research.sources.length,
      factChecks:project.research.factChecks.length,
      supportedClaims:supported,
      hasResearchPack:Boolean(project.research.pack)
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return errorResponse(error);
  }
}

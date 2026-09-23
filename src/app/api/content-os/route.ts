import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadContentProject, loadContentProjectHistory, loadContentProjects, saveContentProject } from '@/lib/server/content-os';
import { contentProjectPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const saveSchema=z.object({
  expectedVersion:z.number().int().min(0).max(100000).nullable(),
  project:contentProjectPayloadSchema
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Content OS.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    const projectId=url.searchParams.get('projectId')?.trim();

    if(projectId){
      if(!z.string().uuid().safeParse(projectId).success)throw new HttpError('Content Project inválido.',400);
      const [project,history]=await Promise.all([
        loadContentProject(projectId),
        loadContentProjectHistory(projectId,20)
      ]);
      if(!project)throw new HttpError('Content Project não encontrado.',404);
      return Response.json({project,history},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({projects:await loadContentProjects(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Content OS.',503);
    if(Number(request.headers.get('content-length')??0)>240000)throw new HttpError('Content Project muito extenso.',413);
    const parsed=saveSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Content Project e tente novamente.',400);
    const project=await saveContentProject(parsed.data.project,parsed.data.expectedVersion);
    const history=await loadContentProjectHistory(project.id,20);
    return Response.json({message:`Content Project salvo como versão ${project.version}.`,project,history});
  }catch(e){return errorResponse(e);}
}

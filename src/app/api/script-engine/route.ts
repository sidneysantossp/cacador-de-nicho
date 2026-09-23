import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  generateScriptForProject, loadEpisodeScript, loadEpisodeScriptHistory,
  loadEpisodeScripts, regenerateScriptSection, saveEpisodeScript
} from '@/lib/server/episode-script';
import { episodeScriptPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('generate'),projectId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    script:episodeScriptPayloadSchema
  }).strict(),
  z.object({
    action:z.literal('regenerateSection'),
    scriptId:z.string().uuid(),
    sectionId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Script Engine.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    const scriptId=url.searchParams.get('scriptId')?.trim();

    if(scriptId){
      if(!z.string().uuid().safeParse(scriptId).success)throw new HttpError('Roteiro inválido.',400);
      const [script,history]=await Promise.all([
        loadEpisodeScript(scriptId),
        loadEpisodeScriptHistory(scriptId,20)
      ]);
      if(!script)throw new HttpError('Roteiro não encontrado.',404);
      return Response.json({script,history},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({scripts:await loadEpisodeScripts(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Script Engine.',503);
    if(Number(request.headers.get('content-length')??0)>280000)throw new HttpError('Roteiro muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Script Engine e tente novamente.',400);
    const body=parsed.data;

    let script;
    if(body.action==='generate')script=await generateScriptForProject(body.projectId);
    else if(body.action==='regenerateSection')script=await regenerateScriptSection(body.scriptId,body.sectionId);
    else script=await saveEpisodeScript(body.script,body.status,body.expectedVersion);

    const history=await loadEpisodeScriptHistory(script.id,20);
    return Response.json({
      message:body.action==='generate'?'Roteiro gerado e salvo como draft.':body.action==='regenerateSection'?'Trecho regenerado e salvo como nova versão.':body.status==='approved'?'Roteiro aprovado.':'Roteiro salvo.',
      script,
      history
    });
  }catch(e){return errorResponse(e);}
}

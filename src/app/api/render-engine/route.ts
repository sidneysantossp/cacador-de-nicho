import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  cancelRenderJob, createRenderJob, loadRenderJob,
  renderEngineChannelState, retryRenderChapter, retryRenderJob
} from '@/lib/server/render-engine';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('create'),
    videoEditId:z.string().uuid(),
    preset:z.enum(['source','hd-1080p30','draft-720p30']).optional(),
    crf:z.number().int().min(18).max(30).optional(),
    audioBitrateKbps:z.number().int().min(96).max(320).optional()
  }).strict(),
  z.object({action:z.literal('cancel'),jobId:z.string().uuid()}).strict(),
  z.object({action:z.literal('retry'),jobId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('retry-chapter'),
    jobId:z.string().uuid(),
    chapterId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Render Engine.',503);
    const url=new URL(request.url);
    const jobId=url.searchParams.get('jobId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(jobId){
      if(!z.string().uuid().safeParse(jobId).success)throw new HttpError('Render job inválido.',400);
      const job=await loadRenderJob(jobId);
      if(!job)throw new HttpError('Render job não encontrado.',404);
      return Response.json({job},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await renderEngineChannelState(channelId),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Render Engine.',503);
    if(Number(request.headers.get('content-length')??0)>20000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Render Engine.',400);
    const body=parsed.data;

    if(body.action==='create'){
      const job=await createRenderJob(body);
      return Response.json({message:'Render enfileirado.',job});
    }
    if(body.action==='cancel'){
      const job=await cancelRenderJob(body.jobId);
      return Response.json({message:'Render cancelado.',job});
    }
    if(body.action==='retry-chapter'){
      const job=await retryRenderChapter(body.jobId,body.chapterId);
      return Response.json({
        message:'Novo master enfileirado. Capítulos concluídos serão reutilizados e apenas o capítulo pendente será renderizado novamente.',
        job
      });
    }

    const job=await retryRenderJob(body.jobId);
    return Response.json({
      message:'Render reenfileirado com reaproveitamento automático dos capítulos concluídos.',
      job
    });
  }catch(e){return errorResponse(e);}
}

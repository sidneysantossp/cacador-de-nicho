import { z } from 'zod';
import { longFormJsonLimit } from '@/lib/long-form-capacity';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createVideoEditFromTimeline, loadVideoEdit, loadVideoEditHistory,
  loadVideoEditWorkspace, refreshVideoEditFromTimeline, saveVideoEdit, videoEditorChannelState
} from '@/lib/server/video-editor';
import { videoEditPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),timelineId:z.string().uuid()}).strict(),
  z.object({action:z.literal('refresh'),timelineId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    videoEdit:videoEditPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Video Editor.',503);
    const url=new URL(request.url);
    const videoEditId=url.searchParams.get('videoEditId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(videoEditId){
      if(!z.string().uuid().safeParse(videoEditId).success)throw new HttpError('Video Edit inválido.',400);
      const videoEdit=await loadVideoEdit(videoEditId);
      if(!videoEdit)throw new HttpError('Video Edit não encontrado.',404);
      const [history,workspace]=await Promise.all([
        loadVideoEditHistory(videoEditId,20),
        loadVideoEditWorkspace(videoEdit)
      ]);
      return Response.json({videoEdit,history,...workspace},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await videoEditorChannelState(channelId),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Video Editor.',503);
    if(Number(request.headers.get('content-length')??0)>longFormJsonLimit('videoEdit'))throw new HttpError('Projeto de edição muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Video Editor.',400);
    const body=parsed.data;

    const videoEdit=body.action==='create'
      ?await createVideoEditFromTimeline(body.timelineId)
      :body.action==='refresh'
        ?await refreshVideoEditFromTimeline(body.timelineId)
        :await saveVideoEdit(body.videoEdit,body.status,body.expectedVersion);

    const [history,workspace]=await Promise.all([
      loadVideoEditHistory(videoEdit.id,20),
      loadVideoEditWorkspace(videoEdit)
    ]);

    return Response.json({
      message:body.action==='create'
        ?'Video Edit criado a partir da Timeline aprovada.'
        :body.action==='refresh'
          ?'Video Edit reconstruído a partir da Timeline atual e voltou para draft.'
          :body.status==='approved'
          ?'Video Edit aprovado para render.'
          :'Video Edit salvo.',
      videoEdit,
      history,
      ...workspace
    });
  }catch(e){return errorResponse(e);}
}

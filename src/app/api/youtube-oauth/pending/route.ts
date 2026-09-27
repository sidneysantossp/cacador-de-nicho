import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  cancelPendingYouTubeLink, confirmPendingYouTubeLink, loadPendingYouTubeLink
} from '@/lib/server/youtube-oauth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('confirm'),pendingId:z.string().uuid()}).strict(),
  z.object({action:z.literal('cancel'),pendingId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para confirmar canais YouTube.',503);
    const id=new URL(request.url).searchParams.get('id')?.trim();
    if(!id||!z.string().uuid().safeParse(id).success)throw new HttpError('Confirmação OAuth inválida.',400);
    const pending=await loadPendingYouTubeLink(id);
    if(!pending)throw new HttpError('Confirmação de canal YouTube não encontrada.',404);
    return Response.json({pending},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para confirmar canais YouTube.',503);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a confirmação do canal YouTube.',400);
    if(parsed.data.action==='cancel'){
      await cancelPendingYouTubeLink(parsed.data.pendingId);
      return Response.json({message:'Conexão descartada. Nenhum vínculo foi alterado.'});
    }
    const channel=await confirmPendingYouTubeLink(parsed.data.pendingId);
    return Response.json({message:'Canal YouTube vinculado ao projeto.',channel});
  }catch(error){return errorResponse(error);}
}

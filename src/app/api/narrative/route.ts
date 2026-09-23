import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadNarrativeBundle, saveChannelConcept, saveChannelEpisode, saveContentArc } from '@/lib/server/narrative';
import { channelConceptSchema, channelEpisodeSchema, contentArcSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('arc'),arc:contentArcSchema}).strict(),
  z.object({action:z.literal('episode'),episode:channelEpisodeSchema}).strict(),
  z.object({action:z.literal('concept'),concept:channelConceptSchema}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Narrative Intelligence.',503);
    const channelId=new URL(request.url).searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await loadNarrativeBundle(channelId),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Narrative Intelligence.',503);
    if(Number(request.headers.get('content-length')??0)>120000)throw new HttpError('Solicitação narrativa muito extensa.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos da narrativa e tente novamente.',400);
    const body=parsed.data;
    if(body.action==='arc')await saveContentArc(body.arc);
    else if(body.action==='episode')await saveChannelEpisode(body.episode);
    else await saveChannelConcept(body.concept);
    const channelId=body.action==='arc'?body.arc.channelId:body.action==='episode'?body.episode.channelId:body.concept.channelId;
    return Response.json({message:'Narrativa atualizada.',bundle:await loadNarrativeBundle(channelId)});
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  latestNexLevEvidencePack, listNexLevEvidencePacks, refreshNexLevEvidencePack
} from '@/lib/server/nexlev-evidence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const postSchema=z.object({
  channelId:z.string().trim().min(1).max(120),
  action:z.literal('refresh').default('refresh')
}).strict();export async function GET(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de usar evidências NexLev.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim()??'';
    if(!channelId)throw new HttpError('Informe channelId.',400);
    const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit')??20)||20,100));
    const [latest,history]=await Promise.all([
      latestNexLevEvidencePack(channelId),
      listNexLevEvidencePacks(channelId,limit)
    ]);
    return Response.json({latest,history},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes de usar evidências NexLev.',503);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Informe um channelId válido.',400);
    const pack=await refreshNexLevEvidencePack(parsed.data.channelId);
    return Response.json({pack,message:'Evidence Pack NexLev atualizado.'});
  }catch(error){return errorResponse(error);}
}

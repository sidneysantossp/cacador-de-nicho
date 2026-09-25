import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { bestVisualSegment } from '@/lib/server/visual-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const exactMatchSchema=z.object({
  exactLocation:z.string().trim().min(1).max(240).optional(),
  landmarkAliases:z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  shotTypes:z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  cameraMotion:z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  timeOfDay:z.array(z.string().trim().min(1).max(80)).max(8).optional()
}).strict();

const matchSchema=z.object({
  assetId:z.string().uuid(),
  query:z.string().trim().min(3).max(1200),
  desiredDurationSeconds:z.number().positive().max(120),
  exactMatch:exactMatchSchema.optional()
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar o matcher visual.',503);
    if(Number(request.headers.get('content-length')??0)>12000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=matchSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os critérios do pareamento visual.',400);
    const match=await bestVisualSegment(parsed.data);
    return Response.json({
      message:match?'Trecho visual compatível encontrado.':'Nenhum trecho passou pelos gates de local/viewpoint.',
      match
    });
  }catch(e){return errorResponse(e);}
}

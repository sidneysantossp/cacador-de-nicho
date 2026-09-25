import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  analyzeOwnedMediaAsset, loadOwnedMediaIntelligence, matchOwnedMediaSegments
} from '@/lib/server/owned-media-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=900;

const analyzeSchema=z.object({
  action:z.literal('analyze'),
  assetId:z.string().uuid()
}).strict();

const matchSchema=z.object({
  action:z.literal('match'),
  query:z.string().trim().min(3).max(1200),
  desiredDurationSeconds:z.number().positive().max(120),
  limit:z.number().int().min(1).max(20).optional(),
  country:z.string().trim().max(120).optional(),
  city:z.string().trim().max(120).optional(),
  scene:z.string().trim().max(120).optional(),
  timeOfDay:z.string().trim().max(120).optional()
}).strict();

const schema=z.discriminatedUnion('action',[analyzeSchema,matchSchema]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Intelligence.',503);
    const assetId=new URL(request.url).searchParams.get('assetId')?.trim()??'';
    if(!z.string().uuid().safeParse(assetId).success)throw new HttpError('Asset OWNED inválido.',400);
    return Response.json(
      {analysis:await loadOwnedMediaIntelligence(assetId)},
      {headers:{'Cache-Control':'no-store'}}
    );
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Intelligence.',503);
    if(Number(request.headers.get('content-length')??0)>20000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados da análise visual.',400);

    if(parsed.data.action==='analyze'){
      const analysis=await analyzeOwnedMediaAsset(parsed.data.assetId);
      return Response.json({
        message:'Visual Intelligence concluída para o asset OWNED.',
        analysis
      });
    }

    const matches=await matchOwnedMediaSegments(parsed.data);
    return Response.json({
      message:matches.length?'Trechos OWNED compatíveis encontrados.':'Nenhum trecho OWNED atingiu o mínimo de relevância.',
      matches
    });
  }catch(e){return errorResponse(e);}
}

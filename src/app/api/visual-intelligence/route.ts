import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { analyzeVisualAsset, loadVisualIntelligence } from '@/lib/server/visual-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const analyzeSchema=z.object({
  action:z.literal('analyze'),
  assetId:z.string().uuid()
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Intelligence.',503);
    const assetId=new URL(request.url).searchParams.get('assetId')?.trim();
    if(!assetId||!z.string().uuid().safeParse(assetId).success)throw new HttpError('Asset inválido.',400);
    return Response.json({analysis:await loadVisualIntelligence(assetId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Intelligence.',503);
    if(Number(request.headers.get('content-length')??0)>4000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=analyzeSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise o asset para análise visual.',400);
    const analysis=await analyzeVisualAsset(parsed.data.assetId);
    return Response.json({
      message:'Análise visual concluída. Segmentos e tags foram adicionados ao Asset Vault.',
      analysis
    });
  }catch(e){return errorResponse(e);}
}

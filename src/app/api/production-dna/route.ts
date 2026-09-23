import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadProductionDna, loadProductionDnaHistory, saveProductionDna } from '@/lib/server/production-dna';
import { productionDnaPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const saveSchema=z.object({
  expectedVersion:z.number().int().min(0).max(100000).nullable(),
  dna:productionDnaPayloadSchema
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Production DNA.',503);
    const channelId=new URL(request.url).searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [dna,history]=await Promise.all([
      loadProductionDna(channelId),
      loadProductionDnaHistory(channelId,20)
    ]);
    return Response.json({dna,history},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Production DNA.',503);
    if(Number(request.headers.get('content-length')??0)>180000)throw new HttpError('Production DNA muito extenso.',413);
    const parsed=saveSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Production DNA e tente novamente.',400);
    const dna=await saveProductionDna(parsed.data.dna,parsed.data.expectedVersion);
    const history=await loadProductionDnaHistory(dna.channelId,20);
    return Response.json({message:`Production DNA salvo como versão ${dna.version}.`,dna,history});
  }catch(e){return errorResponse(e);}
}

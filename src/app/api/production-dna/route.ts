import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { loadProductionDna, loadProductionDnaHistory, patchProductionDnaVoice, saveProductionDna } from '@/lib/server/production-dna';
import { productionDnaPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const voiceSchema=z.object({
  language:z.string().trim().max(80),
  providerPreference:z.array(z.string().trim().max(120)).max(20),
  voiceId:z.string().trim().max(250),
  voiceName:z.string().trim().max(250),
  narrationStyle:z.array(z.string().trim().max(500)).max(60),
  paceWpm:z.number().min(40).max(400).nullable(),
  pronunciationRules:z.array(z.string().trim().max(500)).max(100)
}).strict();

const fullSaveSchema=z.object({
  expectedVersion:z.number().int().min(0).max(100000).nullable(),
  dna:productionDnaPayloadSchema
}).strict();

const patchVoiceSchema=z.object({
  action:z.literal('patchVoice'),
  channelId:z.string().uuid(),
  expectedVersion:z.number().int().min(1).max(100000),
  voice:voiceSchema
}).strict();

const saveSchema=z.union([fullSaveSchema,patchVoiceSchema]);

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
    const patch=patchVoiceSchema.safeParse(parsed.data);
    if(patch.success){
      const dna=await patchProductionDnaVoice(patch.data);
      const history=await loadProductionDnaHistory(dna.channelId,20);
      return Response.json({
        message:`Voz do Production DNA atualizada na versão ${dna.version}.`,
        dna,history
      });
    }
    const full=fullSaveSchema.parse(parsed.data);
    const dna=await saveProductionDna(full.dna,full.expectedVersion);
    const history=await loadProductionDnaHistory(dna.channelId,20);
    return Response.json({message:`Production DNA salvo como versão ${dna.version}.`,dna,history});
  }catch(e){return errorResponse(e);}
}

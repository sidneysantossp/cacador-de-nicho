import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createExternalImportBatch, listExternalImportBatches, loadExternalImportBatch,
  processExternalImportItem, remapExternalImportItem, skipExternalImportItem
} from '@/lib/server/external-import';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const fileSchema=z.object({
  name:z.string().trim().min(1).max(500),
  size:z.number().int().min(0).max(250*1024*1024),
  type:z.string().trim().max(160)
}).strict();

const jsonSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('create'),
    channelId:z.string().uuid(),
    scriptId:z.string().uuid(),
    visualPromptSetId:z.string().uuid().optional(),
    voiceAssetId:z.string().uuid().optional(),
    sourceLabel:z.string().trim().max(250).optional(),
    files:z.array(fileSchema).min(1).max(2000)
  }).strict(),
  z.object({
    action:z.literal('remap'),
    batchId:z.string().uuid(),
    itemId:z.string().uuid(),
    sceneId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('skip'),
    batchId:z.string().uuid(),
    itemId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar importação externa.',503);
    const url=new URL(request.url);
    const batchId=url.searchParams.get('batchId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(batchId){
      if(!z.string().uuid().safeParse(batchId).success)throw new HttpError('Import Batch inválido.',400);
      const batch=await loadExternalImportBatch(batchId);
      if(!batch)throw new HttpError('Import Batch não encontrado.',404);
      return Response.json({batch},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({batches:await listExternalImportBatches(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar importação externa.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>260*1024*1024)throw new HttpError('Arquivo maior que 250 MB.',413);
      const form=await request.formData();
      const batchId=String(form.get('batchId')??'').trim();
      const itemId=String(form.get('itemId')??'').trim();
      const file=form.get('file');
      if(!z.string().uuid().safeParse(batchId).success||!z.string().uuid().safeParse(itemId).success){
        throw new HttpError('Batch ou item inválido.',400);
      }
      if(!(file instanceof File))throw new HttpError('Selecione o arquivo correspondente.',400);
      const batch=await processExternalImportItem(batchId,itemId,file);
      return Response.json({message:'Arquivo processado.',batch});
    }

    if(Number(request.headers.get('content-length')??0)>750000)throw new HttpError('Manifesto do batch muito extenso.',413);
    const parsed=jsonSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do Import Batch.',400);
    const body=parsed.data;

    if(body.action==='create'){
      const batch=await createExternalImportBatch(body);
      return Response.json({message:'Import Batch criado e mapeado.',batch});
    }
    if(body.action==='remap'){
      const batch=await remapExternalImportItem(body.batchId,body.itemId,body.sceneId);
      return Response.json({message:'Arquivo remapeado para a cena.',batch});
    }

    const batch=await skipExternalImportItem(body.batchId,body.itemId);
    return Response.json({message:'Arquivo ignorado neste batch.',batch});
  }catch(e){return errorResponse(e);}
}

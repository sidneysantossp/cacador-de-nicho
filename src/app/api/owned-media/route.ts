import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  deleteOwnedMediaAsset, finalizeOwnedMediaUpload, listOwnedMediaAssets,
  prepareOwnedMediaUpload, updateOwnedMediaMetadata
} from '@/lib/server/owned-media';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar a Biblioteca de Mídia.',503);
    const url=new URL(request.url);
    const query=url.searchParams.get('q')??'';
    const kindValue=url.searchParams.get('kind')??'all';
    const kind=kindValue==='image'||kindValue==='video'?kindValue:'all';
    const page=Number(url.searchParams.get('page')??1);
    const limit=Number(url.searchParams.get('limit')??60);
    return Response.json(await listOwnedMediaAssets({query,kind,page,limit}),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(e){return errorResponse(e);}
}

const semantic=z.object({
  subjects:z.array(z.string().trim().min(1).max(120)).max(50),
  locations:z.array(z.string().trim().min(1).max(180)).max(50),
  periods:z.array(z.string().trim().min(1).max(120)).max(50),
  shotTypes:z.array(z.string().trim().min(1).max(120)).max(50),
  moods:z.array(z.string().trim().min(1).max(120)).max(50)
}).strict();

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('prepare'),
    fileName:z.string().trim().min(1).max(255),
    mimeType:z.string().trim().min(1).max(120),
    bytes:z.number().int().positive().max(2*1024*1024*1024)
  }).strict(),
  z.object({
    action:z.literal('finalize'),
    assetId:z.string().uuid(),
    width:z.number().int().positive().max(20000).nullable().optional(),
    height:z.number().int().positive().max(20000).nullable().optional(),
    durationSeconds:z.number().positive().max(86400).nullable().optional()
  }).strict(),
  z.object({
    action:z.literal('metadata'),
    assetId:z.string().uuid(),
    title:z.string().trim().min(1).max(220),
    tags:z.array(z.string().trim().min(1).max(100)).max(50),
    semantic
  }).strict(),
  z.object({
    action:z.literal('delete'),
    assetId:z.string().uuid()
  }).strict()
]);

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar a Biblioteca de Mídia.',503);
    if(Number(request.headers.get('content-length')??0)>30000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados enviados para a Biblioteca.',400);

    if(parsed.data.action==='prepare'){
      const origin=request.headers.get('origin')?.trim()||new URL(request.url).origin;
      const result=await prepareOwnedMediaUpload({...parsed.data,browserOrigin:origin});
      return Response.json({message:'Upload preparado para envio direto ao R2.',...result});
    }
    if(parsed.data.action==='finalize'){
      const asset=await finalizeOwnedMediaUpload(parsed.data);
      return Response.json({message:'Arquivo cadastrado na Biblioteca de Mídia.',asset});
    }
    if(parsed.data.action==='metadata'){
      await updateOwnedMediaMetadata(parsed.data);
      return Response.json({message:'Metadados atualizados.'});
    }
    await deleteOwnedMediaAsset(parsed.data.assetId);
    return Response.json({message:'Asset removido da Biblioteca de Mídia.'});
  }catch(e){return errorResponse(e);}
}

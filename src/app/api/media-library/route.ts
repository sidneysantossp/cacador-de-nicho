import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { listMediaLibrary, saveMediaLibraryMetadata } from '@/lib/server/media-library';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const metadataSchema=z.object({
  action:z.literal('metadata'),
  channelId:z.string().uuid(),
  resourceType:z.enum(['scene_asset','voice_asset']),
  resourceId:z.string().uuid(),
  favorite:z.boolean(),
  tags:z.array(z.string().trim().min(1).max(80)).max(50),
  notes:z.string().max(5000),
  semantic:z.object({
    subjects:z.array(z.string().trim().min(1).max(120)).max(50),
    locations:z.array(z.string().trim().min(1).max(200)).max(50),
    periods:z.array(z.string().trim().min(1).max(120)).max(50),
    shotTypes:z.array(z.string().trim().min(1).max(120)).max(50),
    moods:z.array(z.string().trim().min(1).max(120)).max(50)
  }).strict().optional().default({subjects:[],locations:[],periods:[],shotTypes:[],moods:[]})
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Media Library.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    const scope=url.searchParams.get('scope')==='all'?'all':'channel';
    const page=Number(url.searchParams.get('page')??1);
    const limit=Number(url.searchParams.get('limit')??60);
    if(scope==='channel'&&(!channelId||!z.string().uuid().safeParse(channelId).success))throw new HttpError('Canal inválido.',400);
    const library=await listMediaLibrary(scope==='all'?null:channelId!,{page,limit});
    return Response.json(library,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Media Library.',503);
    if(Number(request.headers.get('content-length')??0)>30000)throw new HttpError('Metadados muito extensos.',413);
    const parsed=metadataSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os metadados da mídia.',400);
    const metadata=await saveMediaLibraryMetadata(parsed.data);
    return Response.json({message:'Metadados da mídia salvos.',metadata});
  }catch(e){return errorResponse(e);}
}

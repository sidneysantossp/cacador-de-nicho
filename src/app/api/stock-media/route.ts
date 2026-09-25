import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { importStockMedia, searchStockMedia } from '@/lib/server/stock-media';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const provider=z.enum(['pexels','pixabay','unsplash','vecteezy']);
const kind=z.enum(['image','video']);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Stock Media Engine.',503);
    const url=new URL(request.url);
    const promptSetId=url.searchParams.get('promptSetId')?.trim()??'';
    const sceneId=url.searchParams.get('sceneId')?.trim()??'';
    const query=url.searchParams.get('q')?.trim()??'';
    const p=provider.safeParse(url.searchParams.get('provider'));
    const k=kind.safeParse(url.searchParams.get('kind'));
    if(!z.string().uuid().safeParse(promptSetId).success||!z.string().uuid().safeParse(sceneId).success)throw new HttpError('Cena ou prompt set inválido.',400);
    if(!p.success||!k.success)throw new HttpError('Provider ou tipo de mídia inválido.',400);
    return Response.json(await searchStockMedia({promptSetId,sceneId,provider:p.data,kind:k.data,query}),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

const importSchema=z.object({
  action:z.literal('import'),
  promptSetId:z.string().uuid(),
  sceneId:z.string().uuid(),
  provider,
  kind,
  providerAssetId:z.string().trim().min(1).max(100)
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Stock Media Engine.',503);
    if(Number(request.headers.get('content-length')??0)>10000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=importSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise o item stock selecionado.',400);
    const asset=await importStockMedia(parsed.data);
    return Response.json({message:'Stock media copiado para o storage e adicionado como variante da cena.',asset});
  }catch(e){return errorResponse(e);}
}

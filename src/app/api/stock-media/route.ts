import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { importStockMedia, resolveVerifiedStockMediaForScene, searchStockMedia } from '@/lib/server/stock-media';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const provider=z.enum(['pexels','pixabay','unsplash','vecteezy','wikimedia']);
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
    const orientation=z.enum(['landscape','portrait','any']).safeParse(url.searchParams.get('orientation')??'landscape');
    if(!z.string().uuid().safeParse(promptSetId).success||!z.string().uuid().safeParse(sceneId).success)throw new HttpError('Cena ou prompt set inválido.',400);
    if(!p.success||!k.success||!orientation.success)throw new HttpError('Provider, tipo ou orientação de mídia inválido.',400);
    return Response.json(await searchStockMedia({
      promptSetId,sceneId,provider:p.data,kind:k.data,query,orientation:orientation.data
    }),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

const actionSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('import'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    provider,
    kind,
    providerAssetId:z.string().trim().min(1).max(100)
  }).strict(),
  z.object({
    action:z.literal('resolveVerified'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    query:z.string().trim().min(1).max(100),
    desiredDurationSeconds:z.number().positive().max(120),
    orientation:z.enum(['landscape','portrait','any']).optional(),
    providers:z.array(provider).min(1).max(3).optional(),
    maxCandidatesPerProvider:z.number().int().min(1).max(3).optional()
  }).strict()
]);

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Stock Media Engine.',503);
    if(Number(request.headers.get('content-length')??0)>10000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a solicitação de stock media.',400);
    if(parsed.data.action==='resolveVerified'){
      const result=await resolveVerifiedStockMediaForScene(parsed.data);
      return Response.json({
        message:result.status==='matched'
          ?'Stock fallback validado visualmente e selecionado.'
          :'Nenhum candidato stock passou pela validação visual.',
        result
      });
    }
    const asset=await importStockMedia(parsed.data);
    return Response.json({message:'Stock media copiado para o storage e adicionado como variante da cena.',asset});
  }catch(e){return errorResponse(e);}
}

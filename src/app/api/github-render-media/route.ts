import { z } from 'zod';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { requireGithubRenderWorker } from '@/lib/server/github-render-auth';
import { r2StoragePath, signedMediaPutUrl, signedMediaUrl } from '@/lib/server/media-storage';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('get'),
    storagePath:z.string().min(4).max(2000)
  }).strict(),
  z.object({
    action:z.literal('put'),
    storagePath:z.string().min(1).max(2000),
    contentType:z.string().trim().min(1).max(120).default('video/mp4')
  }).strict()
]);

export async function POST(request:Request){
  try{
    await requireGithubRenderWorker(request);
    if(Number(request.headers.get('content-length')??0)>10000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a solicitação do GitHub render worker.',400);
    const body=parsed.data;

    if(body.action==='get'){
      if(!body.storagePath.startsWith('r2:'))throw new HttpError('GitHub render suporta somente assets no R2.',409);
      const url=await signedMediaUrl(body.storagePath,3600);
      if(!url)throw new HttpError('Não foi possível assinar o download do asset.',502);
      return Response.json({url});
    }

    const path=body.storagePath.startsWith('r2:')?body.storagePath:r2StoragePath(body.storagePath);
    const url=await signedMediaPutUrl(path,body.contentType,3600);
    if(!url)throw new HttpError('Não foi possível assinar o upload do render.',502);
    return Response.json({url,path});
  }catch(error){
    return errorResponse(error);
  }
}

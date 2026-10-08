import { z } from 'zod';
import { dbConfigured } from '@/lib/server/db';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { importAuthorizedExternalMediaUrl } from '@/lib/server/external-media-url';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const schema=z.object({
  promptSetId:z.string().uuid(),
  sceneId:z.string().uuid(),
  url:z.string().url().max(2048),
  licenseType:z.enum(['owned','licensed']),
  licenseLabel:z.string().trim().min(2).max(250),
  sourcePageUrl:z.string().url().max(2048).optional()
}).strict();

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o banco para importar mídia externa.',503);
    if(Number(request.headers.get('content-length')??0)>16000){
      throw new HttpError('Solicitação de mídia externa muito extensa.',413);
    }
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise a URL, licença e cena da mídia externa.',400);
    const result=await importAuthorizedExternalMediaUrl(parsed.data);
    return Response.json({
      message:result.status==='matched'
        ?'Mídia externa autorizada baixada, validada e selecionada.'
        :'Mídia externa baixada, mas reprovada pelo Visual QA.',
      result
    });
  }catch(error){
    return errorResponse(error);
  }
}

import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { streamOwnedMediaUpload } from '@/lib/server/owned-media';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=1800;

export async function PUT(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar a Biblioteca de Mídia.',503);
    const assetId=new URL(request.url).searchParams.get('assetId')?.trim()??'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)){
      throw new HttpError('Identificador de upload inválido.',400);
    }
    const bytes=Number(request.headers.get('content-length')??0);
    if(!Number.isSafeInteger(bytes)||bytes<=0)throw new HttpError('O navegador não informou o tamanho do arquivo.',411);
    if(bytes>2*1024*1024*1024)throw new HttpError('Arquivo maior que 2 GB.',413);
    const mimeType=(request.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!request.body)throw new HttpError('O upload não contém dados.',400);
    const result=await streamOwnedMediaUpload({assetId,body:request.body,mimeType,bytes});
    return Response.json({message:'Arquivo transmitido ao R2.',...result});
  }catch(e){return errorResponse(e);}
}

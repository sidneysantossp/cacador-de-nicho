import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { streamExternalMasterUpload } from '@/lib/server/render-engine';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=1800;

export async function PUT(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para importar o master externo.',503);
    const url=new URL(request.url);
    const jobId=url.searchParams.get('jobId')?.trim()??'';
    const kind=url.searchParams.get('kind')?.trim()??'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)){
      throw new HttpError('Identificador de master inválido.',400);
    }
    if(kind!=='video'&&kind!=='audio')throw new HttpError('Tipo de upload inválido.',400);
    const bytes=Number(request.headers.get('content-length')??request.headers.get('x-upload-size')??0);
    if(!Number.isSafeInteger(bytes)||bytes<=0)throw new HttpError('O navegador não informou o tamanho do arquivo.',411);
    if(bytes>2*1024*1024*1024)throw new HttpError('Arquivo maior que 2 GB.',413);
    const mimeType=(request.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!request.body)throw new HttpError('O upload não contém dados.',400);
    const result=await streamExternalMasterUpload({
      jobId,
      kind,
      body:request.body,
      mimeType,
      bytes
    });
    return Response.json({message:'Arquivo transmitido diretamente ao Cloudflare R2.',...result});
  }catch(e){return errorResponse(e);}
}

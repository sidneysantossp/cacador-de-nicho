import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { headMedia, r2StoragePath, signedMediaPutUrl } from '@/lib/server/media-storage';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const MAX_BACKUP_BYTES=256*1024*1024;
const fileName=z.string().trim().regex(/^cacadores-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}\.dump$/);
const sha256=z.string().trim().regex(/^[a-f0-9]{64}$/);

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('prepare'),
    fileName,
    bytes:z.number().int().positive().max(MAX_BACKUP_BYTES),
    sha256
  }).strict(),
  z.object({
    action:z.literal('verify'),
    storagePath:z.string().trim().min(1).max(1000),
    bytes:z.number().int().positive().max(MAX_BACKUP_BYTES),
    sha256
  }).strict()
]);

function backupPrefix(){
  return r2StoragePath('backups/postgres/');
}

function assertBackupPath(path:string){
  if(!path.startsWith(backupPrefix()))throw new HttpError('Caminho de backup inválido.',400);
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(Number(request.headers.get('content-length')??0)>10000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do backup.',400);
    const body=parsed.data;

    if(body.action==='prepare'){
      const now=new Date();
      const year=String(now.getUTCFullYear());
      const month=String(now.getUTCMonth()+1).padStart(2,'0');
      const storagePath=r2StoragePath(`backups/postgres/${year}/${month}/${body.fileName}`);
      const uploadUrl=await signedMediaPutUrl(
        storagePath,
        'application/octet-stream',
        900,
        {cacheControl:'no-store',metadata:{sha256:body.sha256}}
      );
      if(!uploadUrl)throw new HttpError('R2 indisponível para backup.',503);
      return Response.json({
        upload:{
          storagePath,
          url:uploadUrl,
          expiresSeconds:900,
          headers:{
            'Content-Type':'application/octet-stream',
            'Cache-Control':'no-store',
            'x-amz-meta-sha256':body.sha256
          }
        }
      },{headers:{'Cache-Control':'no-store'}});
    }

    assertBackupPath(body.storagePath);
    const head=await headMedia(body.storagePath);
    const storedSha=String(head.metadata?.sha256??'').toLowerCase();
    if(head.bytes!==body.bytes||storedSha!==body.sha256){
      throw new HttpError('Backup no R2 não passou na verificação de integridade.',409);
    }
    return Response.json({
      verified:true,
      storagePath:body.storagePath,
      bytes:head.bytes,
      sha256:storedSha,
      etag:head.etag
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return errorResponse(error);
  }
}

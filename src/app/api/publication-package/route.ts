import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { publicationPackagePayloadSchema } from '@/lib/server/validation';
import {
  createPublicationPackage, loadPublicationPackage, loadPublicationPackageHistory,
  publicationPackageChannelState, savePublicationPackage, uploadPublicationThumbnail
} from '@/lib/server/publication-package';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const jsonSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('create'),
    qualityReportId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('save'),
    packageId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    payload:publicationPackagePayloadSchema
  }).strict(),
  z.object({
    action:z.literal('approve'),
    packageId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    payload:publicationPackagePayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Publication Packaging.',503);
    const url=new URL(request.url);
    const packageId=url.searchParams.get('packageId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(packageId){
      if(!z.string().uuid().safeParse(packageId).success)throw new HttpError('Publication Package inválido.',400);
      const pkg=await loadPublicationPackage(packageId);
      if(!pkg)throw new HttpError('Publication Package não encontrado.',404);
      return Response.json({
        package:pkg,
        history:await loadPublicationPackageHistory(packageId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await publicationPackageChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Publication Packaging.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>2.5*1024*1024)throw new HttpError('Upload de thumbnail maior que 2 MB.',413);
      const form=await request.formData();
      const packageId=String(form.get('packageId')??'').trim();
      const expectedVersion=Number(form.get('expectedVersion'));
      const file=form.get('file');
      if(!z.string().uuid().safeParse(packageId).success)throw new HttpError('Publication Package inválido.',400);
      if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw new HttpError('Versão do package inválida.',400);
      if(!(file instanceof File))throw new HttpError('Selecione uma thumbnail.',400);
      const pkg=await uploadPublicationThumbnail({packageId,expectedVersion,file});
      return Response.json({message:'Thumbnail salva e versionada.',package:pkg});
    }

    if(Number(request.headers.get('content-length')??0)>50000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=jsonSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Publication Package.',400);
    const body=parsed.data;

    if(body.action==='create'){
      const pkg=await createPublicationPackage(body.qualityReportId);
      return Response.json({message:'Publication Package criado.',package:pkg});
    }

    const pkg=await savePublicationPackage({
      packageId:body.packageId,
      expectedVersion:body.expectedVersion,
      payload:body.payload,
      approve:body.action==='approve'
    });
    return Response.json({
      message:body.action==='approve'
        ?'Publication Package aprovado e pronto para a etapa de publicação.'
        :'Publication Package salvo como rascunho.',
      package:pkg
    });
  }catch(e){return errorResponse(e);}
}

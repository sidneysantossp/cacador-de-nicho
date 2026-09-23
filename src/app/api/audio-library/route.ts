import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  listAudioAssets, saveAudioAssetMetadata, uploadAudioAsset
} from '@/lib/server/audio-library';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const metadataSchema=z.object({
  action:z.literal('metadata'),
  channelId:z.string().uuid(),
  assetId:z.string().uuid(),
  favorite:z.boolean(),
  tags:z.array(z.string().trim().min(1).max(80)).max(50),
  notes:z.string().max(5000),
  bpm:z.number().min(20).max(400).nullable()
}).strict();

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Audio Library.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({assets:await listAudioAssets(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Audio Library.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>105*1024*1024)throw new HttpError('Upload maior que 100 MB.',413);
      const form=await request.formData();
      const channelId=String(form.get('channelId')??'').trim();
      const kind=String(form.get('kind')??'').trim();
      const file=form.get('file');
      const tagsRaw=String(form.get('tags')??'').trim();
      const notes=String(form.get('notes')??'');
      if(!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
      if(kind!=='music'&&kind!=='sfx')throw new HttpError('Tipo de áudio inválido.',400);
      if(!(file instanceof File))throw new HttpError('Selecione um arquivo de áudio.',400);
      const tags=tagsRaw?tagsRaw.split(',').map(tag=>tag.trim()).filter(Boolean):[];
      const asset=await uploadAudioAsset({channelId,kind,file,tags,notes});
      return Response.json({message:'Áudio salvo na biblioteca do canal.',asset,assets:await listAudioAssets(channelId)});
    }

    if(Number(request.headers.get('content-length')??0)>30000)throw new HttpError('Metadados muito extensos.',413);
    const parsed=metadataSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os metadados do áudio.',400);
    const asset=await saveAudioAssetMetadata(parsed.data);
    return Response.json({message:'Metadados do áudio salvos.',asset,assets:await listAudioAssets(parsed.data.channelId)});
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  deleteVoiceAsset, generateElevenLabsVoice, listElevenLabsVoices,
  listVoiceAssets, loadVoiceAsset, selectVoiceAsset, uploadVoiceAsset
} from '@/lib/server/voice-engine';
import {
  createTranscriptFromAlignment, loadTranscriptByVoiceAsset, transcribeWithScribe
} from '@/lib/server/transcription-engine';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=1800;

const jsonSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('generate'),
    scriptId:z.string().uuid(),
    voiceId:z.string().trim().min(1).max(200).optional(),
    voiceName:z.string().trim().max(250).optional(),
    modelId:z.enum(['eleven_flash_v2_5','eleven_multilingual_v2']).optional()
  }).strict(),
  z.object({
    action:z.literal('select'),
    scriptId:z.string().uuid(),
    assetId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('rebuild'),
    scriptId:z.string().uuid(),
    assetId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('delete'),
    scriptId:z.string().uuid(),
    assetId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Voice Engine.',503);
    const url=new URL(request.url);
    if(url.searchParams.get('voices')==='elevenlabs'){
      return Response.json({voices:await listElevenLabsVoices()},{headers:{'Cache-Control':'no-store'}});
    }
    const scriptId=url.searchParams.get('scriptId')?.trim();
    if(!scriptId||!z.string().uuid().safeParse(scriptId).success)throw new HttpError('Roteiro inválido.',400);
    return Response.json({assets:await listVoiceAssets(scriptId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Voice Engine.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>105*1024*1024)throw new HttpError('Upload maior que 100 MB.',413);
      const form=await request.formData();
      const scriptId=String(form.get('scriptId')??'').trim();
      const file=form.get('file');
      if(!z.string().uuid().safeParse(scriptId).success)throw new HttpError('Roteiro inválido.',400);
      if(!(file instanceof File))throw new HttpError('Selecione um arquivo de áudio.',400);
      const asset=await uploadVoiceAsset(scriptId,file);
      return Response.json({message:'Áudio externo salvo como novo take.',asset,assets:await listVoiceAssets(scriptId)});
    }

    if(Number(request.headers.get('content-length')??0)>12000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=jsonSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Voice Engine.',400);
    const body=parsed.data;

    if(body.action==='generate'){
      const asset=await generateElevenLabsVoice(body);
      const chunks=asset.generationChunks?.length??1;
      const cacheHits=asset.generationChunks?.filter(chunk=>chunk.cacheHit).length??0;
      return Response.json({
        message:chunks>1
          ?'Narração long-form gerada em '+chunks+' blocos, costurada em um único take'+(cacheHits?' ('+cacheHits+' cache hit(s)).':'.')
          :'Narração gerada e salva como novo take.',
        asset,
        assets:await listVoiceAssets(body.scriptId)
      });
    }
    if(body.action==='select'){
      const selection=await selectVoiceAsset(body.scriptId,body.assetId);
      const message=selection.invalidatedStages.length
        ?'Take selecionado. A cadeia anterior ficou stale a partir de Transcript: '+selection.invalidatedStages.join(' → ')+'.'
        :'Take selecionado para as próximas etapas.';
      return Response.json({
        message,
        selection,
        assets:await listVoiceAssets(body.scriptId)
      });
    }
    if(body.action==='rebuild'){
      const selection=await selectVoiceAsset(body.scriptId,body.assetId);
      const asset=await loadVoiceAsset(body.assetId);
      if(!asset)throw new HttpError('Take de voz não encontrado.',404);
      let transcript=await loadTranscriptByVoiceAsset(body.assetId);
      if(!transcript){
        transcript=asset.alignment
          ?await createTranscriptFromAlignment(body.assetId)
          :await transcribeWithScribe(body.assetId);
      }
      return Response.json({
        message:transcript.status==='approved'
          ?'Take ativado. Transcript existente está aprovado; a cadeia pode continuar pelo Scene Timecode.'
          :'Take ativado e Transcript reconstruído como draft. Revise/aprove em Transcription antes de seguir.',
        selection,
        transcript,
        nextStep:transcript.status==='approved'?'scenes':'transcript',
        assets:await listVoiceAssets(body.scriptId)
      });
    }

    await deleteVoiceAsset(body.scriptId,body.assetId);
    return Response.json({message:'Take removido.',assets:await listVoiceAssets(body.scriptId)});
  }catch(e){return errorResponse(e);}
}

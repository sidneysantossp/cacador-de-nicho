import { z } from 'zod';
import { longFormJsonLimit } from '@/lib/long-form-capacity';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createTranscriptFromAlignment, importTranscriptFile, listTranscripts,
  loadTranscript, loadTranscriptHistory, saveTranscript, transcribeWithScribe
} from '@/lib/server/transcription-engine';
import { transcriptPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const jsonSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('alignment'),voiceAssetId:z.string().uuid()}).strict(),
  z.object({action:z.literal('scribe'),voiceAssetId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    transcript:transcriptPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Transcription Engine.',503);
    const url=new URL(request.url);
    const transcriptId=url.searchParams.get('transcriptId')?.trim();
    const scriptId=url.searchParams.get('scriptId')?.trim();

    if(transcriptId){
      if(!z.string().uuid().safeParse(transcriptId).success)throw new HttpError('Transcript inválido.',400);
      const [transcript,history]=await Promise.all([
        loadTranscript(transcriptId),
        loadTranscriptHistory(transcriptId,20)
      ]);
      if(!transcript)throw new HttpError('Transcript não encontrado.',404);
      return Response.json({transcript,history},{headers:{'Cache-Control':'no-store'}});
    }

    if(!scriptId||!z.string().uuid().safeParse(scriptId).success)throw new HttpError('Roteiro inválido.',400);
    return Response.json({transcripts:await listTranscripts(scriptId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Transcription Engine.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>11*1024*1024)throw new HttpError('Arquivo de transcrição maior que 10 MB.',413);
      const form=await request.formData();
      const voiceAssetId=String(form.get('voiceAssetId')??'').trim();
      const file=form.get('file');
      if(!z.string().uuid().safeParse(voiceAssetId).success)throw new HttpError('Take de voz inválido.',400);
      if(!(file instanceof File))throw new HttpError('Selecione um arquivo de transcrição.',400);
      const transcript=await importTranscriptFile(voiceAssetId,file);
      return Response.json({
        message:'Transcrição importada e normalizada.',
        transcript,
        history:await loadTranscriptHistory(transcript.id,20)
      });
    }

    if(Number(request.headers.get('content-length')??0)>longFormJsonLimit('transcript'))throw new HttpError('Transcript muito extenso.',413);
    const parsed=jsonSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Transcription Engine.',400);
    const body=parsed.data;
    let transcript;

    if(body.action==='alignment')transcript=await createTranscriptFromAlignment(body.voiceAssetId);
    else if(body.action==='scribe')transcript=await transcribeWithScribe(body.voiceAssetId);
    else transcript=await saveTranscript(body.transcript,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='alignment'
        ?'Transcript criado a partir do alignment existente.'
        :body.action==='scribe'
          ?'Áudio transcrito com Scribe v2.'
          :body.status==='approved'
            ?'Transcript aprovado.'
            :'Transcript salvo.',
      transcript,
      history:await loadTranscriptHistory(transcript.id,20)
    });
  }catch(e){return errorResponse(e);}
}

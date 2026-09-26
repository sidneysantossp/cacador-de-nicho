import { z } from 'zod';
import { longFormJsonLimit } from '@/lib/long-form-capacity';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import {
  createScenePlanFromTranscript, listScenePlans, loadScenePlan,
  loadScenePlanHistory, loadScenePlanHistoryVersion, saveScenePlan
} from '@/lib/server/scene-timecode';
import { scenePlanPayloadSchema } from '@/lib/server/validation';
import { listTranscriptsByChannel, loadTranscript } from '@/lib/server/transcription-engine';
import { loadProductionDna } from '@/lib/server/production-dna';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),transcriptId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    plan:scenePlanPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Scene Timecode Protocol.',503);
    const url=new URL(request.url);
    const planId=url.searchParams.get('planId')?.trim();
    const historyVersionRaw=url.searchParams.get('historyVersion')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(planId){
      if(!z.string().uuid().safeParse(planId).success)throw new HttpError('Scene Plan inválido.',400);
      if(historyVersionRaw){
        const historyVersion=Number(historyVersionRaw);
        if(!Number.isInteger(historyVersion)||historyVersion<1||historyVersion>100000){
          throw new HttpError('Versão histórica inválida.',400);
        }
        const version=await loadScenePlanHistoryVersion(planId,historyVersion);
        if(!version)throw new HttpError('Versão histórica não encontrada.',404);
        return Response.json({historyVersion:version},{headers:{'Cache-Control':'no-store'}});
      }
      const [plan,history]=await Promise.all([
        loadScenePlan(planId),
        loadScenePlanHistory(planId,20)
      ]);
      if(!plan)throw new HttpError('Scene Plan não encontrado.',404);
      const [transcript,productionDna]=await Promise.all([
        loadTranscript(plan.transcriptId),
        loadProductionDna(plan.channelId)
      ]);
      return Response.json({plan,history,transcript,productionDna},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [plans,transcripts,voiceRows]=await Promise.all([
      listScenePlans(channelId),
      listTranscriptsByChannel(channelId),
      db().from('radar_voice_assets')
        .select('id,episode_id')
        .eq('channel_id',channelId)
        .eq('selected',true)
    ]);
    const selectedVoiceByEpisode=new Map(
      (checked(voiceRows)??[]).map(row=>[String(row.episode_id),String(row.id)])
    );
    const freshTranscript=(item:(typeof transcripts)[number])=>
      selectedVoiceByEpisode.get(item.episodeId)===item.voiceAssetId;
    return Response.json({
      plans:plans.map(plan=>({
        ...plan,
        stale:selectedVoiceByEpisode.get(plan.episodeId)!==plan.voiceAssetId,
        staleReason:selectedVoiceByEpisode.get(plan.episodeId)!==plan.voiceAssetId
          ?'voice-take-changed'
          :undefined
      })),
      transcripts:transcripts.filter(item=>item.status==='approved'&&freshTranscript(item))
    },{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Scene Timecode Protocol.',503);
    if(Number(request.headers.get('content-length')??0)>longFormJsonLimit('scenePlan'))throw new HttpError('Scene Plan muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Scene Timecode Protocol.',400);
    const body=parsed.data;

    const plan=body.action==='create'
      ?await createScenePlanFromTranscript(body.transcriptId)
      :await saveScenePlan(body.plan,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='create'
        ?'Scene Plan criado a partir do transcript aprovado.'
        :body.status==='approved'
          ?'Scene Plan aprovado e episódio movido para produção.'
          :'Scene Plan salvo.',
      plan,
      history:await loadScenePlanHistory(plan.id,20)
    });
  }catch(e){return errorResponse(e);}
}

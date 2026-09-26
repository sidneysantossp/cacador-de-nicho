import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import {
  createTimelineFromPlan, listTimelines, loadTimeline, loadTimelineHistory,
  loadTimelineSources, refreshTimelineFromPlan, saveTimeline
} from '@/lib/server/timeline-engine';
import { listScenePlans, loadScenePlan } from '@/lib/server/scene-timecode';
import { timelinePayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),scenePlanId:z.string().uuid()}).strict(),
  z.object({action:z.literal('refresh'),scenePlanId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    timeline:timelinePayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Timeline Engine.',503);
    const url=new URL(request.url);
    const timelineId=url.searchParams.get('timelineId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(timelineId){
      if(!z.string().uuid().safeParse(timelineId).success)throw new HttpError('Timeline inválida.',400);
      const [timeline,history]=await Promise.all([
        loadTimeline(timelineId),
        loadTimelineHistory(timelineId,20)
      ]);
      if(!timeline)throw new HttpError('Timeline não encontrada.',404);
      const [scenePlan,sources]=await Promise.all([
        loadScenePlan(timeline.scenePlanId),
        loadTimelineSources(timeline)
      ]);
      return Response.json({timeline,history,scenePlan,sources},{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [timelines,scenePlans,voiceRows]=await Promise.all([
      listTimelines(channelId),
      listScenePlans(channelId),
      db().from('radar_voice_assets')
        .select('id,episode_id')
        .eq('channel_id',channelId)
        .eq('selected',true)
    ]);
    const selectedVoiceByEpisode=new Map(
      (checked(voiceRows)??[]).map(row=>[String(row.episode_id),String(row.id)])
    );
    const freshness=<T extends {episodeId:string;voiceAssetId:string}>(item:T)=>({
      ...item,
      stale:selectedVoiceByEpisode.get(item.episodeId)!==item.voiceAssetId,
      staleReason:selectedVoiceByEpisode.get(item.episodeId)!==item.voiceAssetId
        ?'voice-take-changed'
        :undefined
    });
    return Response.json({
      timelines:timelines.map(freshness),
      scenePlans:scenePlans.filter(plan=>plan.status==='approved').map(freshness)
    },{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Timeline Engine.',503);
    if(Number(request.headers.get('content-length')??0)>1000000)throw new HttpError('Timeline muito extensa.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos da Timeline.',400);
    const body=parsed.data;

    const timeline=body.action==='create'
      ?await createTimelineFromPlan(body.scenePlanId)
      :body.action==='refresh'
        ?await refreshTimelineFromPlan(body.scenePlanId)
        :await saveTimeline(body.timeline,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='create'
        ?'Timeline criada a partir do Scene Plan.'
        :body.action==='refresh'
          ?'Timeline reconstruída a partir dos assets atualmente selecionados e voltou para draft.'
          :body.status==='approved'
          ?'Timeline aprovada para edição/render.'
          :'Timeline salva.',
      timeline,
      history:await loadTimelineHistory(timeline.id,20),
      sources:await loadTimelineSources(timeline)
    });
  }catch(e){return errorResponse(e);}
}

import { bridgeSecretValid, safeBridgeMetrics, scopedYoutubeChannel } from '@/lib/gomotion-bridge-policy';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { listLinkedYouTubeChannels } from '@/lib/server/youtube-oauth';
import { listPerformanceObservations } from '@/lib/server/performance-analyst';
import { listYouTubePublishJobs } from '@/lib/server/youtube-publisher';

// Purpose-limited, read-only server-to-server bridge. Never returns tokens,
// OAuth client secrets, database credentials, or full publication payloads.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

export async function GET(request:Request){
  try{
    const secret=process.env.GOMOTION_BRIDGE_SECRET;
    const youtubeChannelId=(process.env.GOMOTION_BRIDGE_YOUTUBE_CHANNEL_ID??'').trim();
    if(!secret||secret.length<32||!/^UC[A-Za-z0-9_-]{22}$/.test(youtubeChannelId)){
      throw new HttpError('Integração GoMotion não configurada.',503);
    }
    if(!bridgeSecretValid(request.headers.get('x-gomotion-bridge-secret'),secret)){
      throw new HttpError('Não autorizado.',401);
    }
    if(!dbConfigured())throw new HttpError('Banco de dados indisponível.',503);

    const channels=await listLinkedYouTubeChannels();
    const channel=scopedYoutubeChannel(channels,youtubeChannelId);
    if(!channel){
      return Response.json({
        schema:'gomotion-youtube-status-v1',
        connected:false,
        youtubeChannelId,
        reason:'channel-not-linked-in-cacadores',
        snapshots:[],
        publishJobs:[]
      },{headers:{'Cache-Control':'no-store'}});
    }

    const [observations,jobs]=await Promise.all([
      listPerformanceObservations(channel.projectId),
      listYouTubePublishJobs(channel.projectId)
    ]);
    return Response.json({
      schema:'gomotion-youtube-status-v1',
      connected:channel.status==='connected',
      youtubeChannelId:channel.youtubeChannelId,
      channel:{
        title:channel.youtubeTitle,
        handle:channel.youtubeHandle??null,
        projectId:channel.projectId,
        status:channel.status,
        isPrimary:channel.isPrimary,
        lastValidatedAt:channel.lastValidatedAt??null,
        analyticsAuthorized:channel.scopes.includes(
          'https://www.googleapis.com/auth/yt-analytics.readonly'
        ),
        uploadAuthorized:channel.scopes.includes(
          'https://www.googleapis.com/auth/youtube.upload'
        )
      },
      snapshots:observations
        .filter(row=>row.sourceType==='youtube-analytics')
        .slice(0,12)
        .map(row=>({
          videoId:row.externalVideoId??null,
          observedAt:row.observedAt,
          metrics:safeBridgeMetrics(row.metrics as Record<string,unknown>)
        })),
      publishJobs:jobs.slice(0,12).map(job=>({
        id:job.id,
        status:job.status,
        stage:job.stage,
        progress:job.progress,
        youtubeUrl:job.youtubeUrl??null,
        createdAt:job.createdAt
      }))
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

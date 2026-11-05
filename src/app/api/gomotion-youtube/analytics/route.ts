import { bridgeSecretValid, scopedYoutubeChannel } from '@/lib/gomotion-bridge-policy';
import {
  EV_CHANNEL_ID,ANALYTICS_READ_SCOPE,analyticsDateWindow,
  googleAnalyticsMetrics,safeAnalyticsReport,safeLatestVideoList
} from '@/lib/gomotion-owned-analytics-policy';
import { errorResponse,HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  listLinkedYouTubeChannels,loadLinkedYouTubeConnectionSecret,
  refreshYouTubeAccessToken,fetchOwnYouTubeChannel
} from '@/lib/server/youtube-oauth';

// Ephemeral, read-only owner intelligence. Never logs/stores/transmits OAuth tokens.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const analyticsBase='https://youtubeanalytics.googleapis.com/v2/reports';
const youtubeBase='https://www.googleapis.com/youtube/v3';
type JsonObject=Record<string,unknown>;
async function googleJson(accessToken:string,url:URL):Promise<JsonObject>{
  let response:Response;
  try{
    response=await fetch(url,{headers:{Authorization:'Bearer '+accessToken},
      cache:'no-store',signal:AbortSignal.timeout(12000)});
  }catch{throw new HttpError('Google API não respondeu a tempo.',502);}
  if(!response.ok){
    // Do not echo token, full request URL, provider response, or user data.
    if(response.status===401||response.status===403)
      throw new HttpError('Google recusou a leitura; revise as permissões OAuth e a ativação da API de Analytics.',502);
    throw new HttpError('A leitura da API Google falhou.',502);
  }
  const data=await response.json().catch(()=>null);
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new HttpError('A API Google devolveu um relatório inválido.',502);
  return data as JsonObject;
}
async function fetchWindow(accessToken:string,days:7|28){
  const window=analyticsDateWindow(days);
  const url=new URL(analyticsBase);
  url.searchParams.set('ids','channel==MINE');
  url.searchParams.set('startDate',window.startDate);
  url.searchParams.set('endDate',window.endDate);
  url.searchParams.set('metrics',googleAnalyticsMetrics);
  const data=await googleJson(accessToken,url);
  return {...window,...safeAnalyticsReport(data)};
}
async function fetchLatestVideos(accessToken:string,youtubeChannelId:string){
  const channelUrl=new URL(youtubeBase+'/channels');
  channelUrl.searchParams.set('part','id,contentDetails');
  channelUrl.searchParams.set('mine','true');
  const channelData=await googleJson(accessToken,channelUrl);
  const candidates=Array.isArray(channelData.items)?channelData.items:[];
  const channel=candidates.find(item=>
    item&&typeof item==='object'&&(item as {id?:unknown}).id===youtubeChannelId
  ) as {contentDetails?:{relatedPlaylists?:{uploads?:string}}}|undefined;
  if(candidates.length!==1||!channel)
    throw new HttpError('A identidade Google não corresponde ao canal esperado.',409);
  const playlistId=channel.contentDetails?.relatedPlaylists?.uploads;
  if(!playlistId)return [];
  const videosUrl=new URL(youtubeBase+'/playlistItems');
  videosUrl.searchParams.set('part','snippet,contentDetails');
  videosUrl.searchParams.set('playlistId',playlistId);
  videosUrl.searchParams.set('maxResults','5');
  const videoData=await googleJson(accessToken,videosUrl);
  return safeLatestVideoList(videoData.items,youtubeChannelId);
}
export async function GET(request:Request){
  try{
    const secret=process.env.GOMOTION_BRIDGE_SECRET;
    const channelId=(process.env.GOMOTION_BRIDGE_YOUTUBE_CHANNEL_ID??'').trim();
    if(!secret||secret.length<32||channelId!==EV_CHANNEL_ID)
      throw new HttpError('Ponte do canal Elétrico em Movimento não configurada.',503);
    if(!bridgeSecretValid(request.headers.get('x-gomotion-bridge-secret'),secret))
      throw new HttpError('Não autorizado.',401);
    if(!dbConfigured())throw new HttpError('Banco indisponível.',503);
    const linked=scopedYoutubeChannel(await listLinkedYouTubeChannels(),channelId);
    if(!linked||linked.youtubeChannelId!==EV_CHANNEL_ID||!linked.isPrimary
      ||linked.status!=='connected'||!linked.scopes.includes(ANALYTICS_READ_SCOPE))
      throw new HttpError('Canal principal ou permissão YouTube Analytics não disponível.',409);
    const connection=await loadLinkedYouTubeConnectionSecret(linked.id);
    if(connection.youtubeChannelId!==EV_CHANNEL_ID)
      throw new HttpError('Identidade do token diferente do canal autorizado.',409);
    const token=await refreshYouTubeAccessToken(connection.refreshToken);
    if(!token.access_token)throw new HttpError('Refresh OAuth não retornou token.',502);
    const ownChannel=await fetchOwnYouTubeChannel(token.access_token);
    if(ownChannel.youtubeChannelId!==EV_CHANNEL_ID)
      throw new HttpError('A conta OAuth acessa outro canal. Reconecte a conta correta.',409);
    const [seven,twentyEight,latestVideos]=await Promise.all([
      fetchWindow(token.access_token,7),
      fetchWindow(token.access_token,28),
      fetchLatestVideos(token.access_token,EV_CHANNEL_ID)
    ]);
    return Response.json({
      schema:'gomotion-owned-channel-analytics-v1',
      source:'youtube-analytics-api',
      readOnly:true,
      youtubeChannelId:EV_CHANNEL_ID,
      projectId:linked.projectId,
      collectedAt:new Date().toISOString(),
      latestVideos,
      windows:[seven,twentyEight],
      notes:[
        'Métricas agregadas por canal, não por vídeo.',
        'Datas solicitadas podem incluir dias ainda não consolidados pelo YouTube.',
        'Impressões, CTR e receita não são disponibilizados por esta rota.'
      ]
    },{headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
  }catch(error){return errorResponse(error);}
}

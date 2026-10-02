import 'server-only';

import type { PerformanceMetrics, PerformanceObservationPayload } from '@/lib/types';
import { isoDurationSeconds } from '@/lib/opportunity-criteria';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  createAutomaticYouTubePerformanceObservation,
  loadPerformanceObservation,
  loadPerformanceReport
} from './performance-analyst';
import {
  listLinkedYouTubeChannels,
  loadLinkedYouTubeConnectionSecret,
  refreshYouTubeAccessToken
} from './youtube-oauth';

const ANALYTICS_SCOPE='https://www.googleapis.com/auth/yt-analytics.readonly';
const ANALYTICS_BASE=(process.env.YOUTUBE_ANALYTICS_API_BASE||
  'https://youtubeanalytics.googleapis.com/v2').replace(/\/$/,'');
const DATA_API_BASE=(process.env.YOUTUBE_API_BASE||
  'https://www.googleapis.com/youtube/v3').replace(/\/$/,'');

type AnalyticsTable={
  columnHeaders?:Array<{name?:string}>;
  rows?:Array<Array<string|number|null>>;
};
function rowObject(table:AnalyticsTable,row:Array<string|number|null>){
  const result:Record<string,string|number|null>={};
  (table.columnHeaders??[]).forEach((header,index)=>{
    if(header.name)result[header.name]=row[index]??null;
  });
  return result;
}

function numeric(value:unknown){
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

function isoDay(value:string){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return new Date().toISOString().slice(0,10);
  return date.toISOString().slice(0,10);
}

async function analyticsQuery(accessToken:string,params:Record<string,string>){
  const url=new URL(ANALYTICS_BASE+'/reports');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const result=await response.json().catch(()=>({})) as
    AnalyticsTable&{error?:{message?:string}};
  if(!response.ok){
    throw new HttpError(
      'YouTube Analytics falhou: '+(result.error?.message??response.statusText)+'.',
      502
    );
  }
  return result;
}

async function videoMetadata(accessToken:string,videoId:string){
  const url=new URL(DATA_API_BASE+'/videos');
  url.searchParams.set('part','snippet,contentDetails');
  url.searchParams.set('id',videoId);
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const result=await response.json().catch(()=>({})) as {
    items?:Array<{
      id?:string;
      snippet?:{channelId?:string;title?:string;publishedAt?:string};
      contentDetails?:{duration?:string};
    }>;
    error?:{message?:string};
  };
  if(!response.ok){
    throw new HttpError(
      'Falha ao verificar vídeo no YouTube: '+(result.error?.message??response.statusText)+'.',
      502
    );
  }
  const item=result.items?.[0];
  if(!item?.id||!item.snippet?.channelId||!item.snippet?.publishedAt){
    throw new HttpError('Vídeo do YouTube não encontrado para backfill.',404);
  }
  return {
    videoId:item.id,
    youtubeChannelId:item.snippet.channelId,
    title:item.snippet.title?.trim()||item.id,
    publishedAt:item.snippet.publishedAt,
    durationSeconds:isoDurationSeconds(item.contentDetails?.duration??'')
  };
}

async function commentSample(accessToken:string,videoId:string){
  const url=new URL(DATA_API_BASE+'/commentThreads');
  url.searchParams.set('part','snippet');
  url.searchParams.set('videoId',videoId);
  url.searchParams.set('maxResults','50');
  url.searchParams.set('order','relevance');
  url.searchParams.set('textFormat','plainText');
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const result=await response.json().catch(()=>({})) as {
    items?:Array<{
      snippet?:{topLevelComment?:{
        snippet?:{textDisplay?:string;textOriginal?:string;likeCount?:number}
      }}
    }>;
    error?:{errors?:Array<{reason?:string}>;message?:string};
  };
  if(!response.ok){
    if(result.error?.errors?.some(item=>item.reason==='commentsDisabled'))return [];
    throw new HttpError(
      'Falha ao coletar comentários do YouTube: '+(result.error?.message??response.statusText)+'.',
      502
    );
  }
  return (result.items??[]).map(item=>{
    const snippet=item.snippet?.topLevelComment?.snippet;
    return {
      text:(snippet?.textOriginal??snippet?.textDisplay??'').trim(),
      likes:Number(snippet?.likeCount??0)
    };
  }).filter(item=>item.text).slice(0,50);
}
async function existingHistoricalSnapshot(
  channelId:string,
  episodeId:string,
  videoId:string
){
  const rows=checked(await db().from('radar_performance_observations')
    .select('id')
    .eq('channel_id',channelId)
    .eq('episode_id',episodeId)
    .eq('external_video_id',videoId)
    .eq('source_type','youtube-analytics')
    .order('observed_at',{ascending:false})
    .limit(1))??[];
  const row=rows[0];
  if(!row)return null;
  const observation=await loadPerformanceObservation(String(row.id));
  if(!observation)return null;
  const reportRow=checked(await db().from('radar_performance_reports')
    .select('id')
    .eq('observation_id',observation.id)
    .maybeSingle());
  if(!reportRow)return null;
  const report=await loadPerformanceReport(String(reportRow.id));
  return report?{observation,report}:null;
}
export async function collectHistoricalYouTubePerformance(input:{
  channelId:string;
  episodeId:string;
  videoId:string;
}){
  const episode=checked(await db().from('radar_episodes')
    .select('id,channel_id,payload')
    .eq('id',input.episodeId)
    .maybeSingle());
  if(!episode||String(episode.channel_id)!==input.channelId){
    throw new HttpError('Episódio histórico inválido para este canal.',400);
  }

  const linked=(await listLinkedYouTubeChannels())
    .filter(item=>item.projectId===input.channelId&&item.status==='connected');
  const connection=linked.find(item=>item.isPrimary)??linked[0]??null;
  if(!connection)throw new HttpError('Canal YouTube conectado não encontrado.',409);
  if(!connection.scopes.includes(ANALYTICS_SCOPE)){
    throw new HttpError(
      'Reconecte o canal para conceder acesso ao YouTube Analytics.',
      409
    );
  }
  const secret=await loadLinkedYouTubeConnectionSecret(connection.id);
  const token=await refreshYouTubeAccessToken(secret.refreshToken);
  const accessToken=token.access_token!;
  const metadata=await videoMetadata(accessToken,input.videoId);
  if(metadata.youtubeChannelId!==connection.youtubeChannelId){
    throw new HttpError(
      'O vídeo informado não pertence ao canal YouTube conectado.',
      409
    );
  }

  const episodePayload=(episode.payload&&typeof episode.payload==='object'
    ?episode.payload:{}) as Record<string,unknown>;
  const recordedVideoId=String(episodePayload.youtubeVideoId??'').trim();
  if(recordedVideoId&&recordedVideoId!==metadata.videoId){
    throw new HttpError(
      'O episódio histórico já está vinculado a outro vídeo do YouTube.',
      409
    );
  }

  const existing=await existingHistoricalSnapshot(
    input.channelId,input.episodeId,metadata.videoId
  );
  if(existing)return {...existing,metadata,alreadyCollected:true};
  const startDate=isoDay(metadata.publishedAt);
  const endDate=new Date().toISOString().slice(0,10);
  const [basic,traffic,comments]=await Promise.all([
    analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      metrics:[
        'views','comments','likes','shares','estimatedMinutesWatched',
        'averageViewDuration','averageViewPercentage',
        'subscribersGained','subscribersLost'
      ].join(','),
      filters:'video=='+metadata.videoId
    }),
    analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      dimensions:'insightTrafficSourceType',
      metrics:'views,estimatedMinutesWatched',
      filters:'video=='+metadata.videoId,
      sort:'-views'
    }),
    commentSample(accessToken,metadata.videoId)
  ]);

  const basicRow=basic.rows?.[0];
  if(!basicRow){
    throw new HttpError(
      'O YouTube Analytics ainda não disponibilizou métricas para este vídeo.',
      409
    );
  }
  const basicValues=rowObject(basic,basicRow);
  let retentionCurve:Array<{second:number;audiencePercent:number}>=[];
  if(metadata.durationSeconds>0){
    const retention=await analyticsQuery(accessToken,{
      ids:'channel==MINE',
      startDate,endDate,
      dimensions:'elapsedVideoTimeRatio',
      metrics:'audienceWatchRatio',
      filters:'video=='+metadata.videoId
    });
    retentionCurve=(retention.rows??[]).map(row=>{
      const value=rowObject(retention,row);
      const ratio=numeric(value.elapsedVideoTimeRatio);
      const audience=numeric(value.audienceWatchRatio);
      return ratio===null||audience===null?null:{
        second:Math.max(0,ratio*metadata.durationSeconds),
        audiencePercent:Math.max(0,audience*100)
      };
    }).filter(
      (item):item is {second:number;audiencePercent:number}=>Boolean(item)
    ).sort((a,b)=>a.second-b.second);
  }

  const metrics:PerformanceMetrics={};
  const assign=(key:keyof PerformanceMetrics,value:unknown)=>{
    const number=numeric(value);
    if(number!==null)metrics[key]=number;
  };
  assign('views',basicValues.views);
  assign('commentCount',basicValues.comments);
  assign('likes',basicValues.likes);
  assign('shares',basicValues.shares);
  assign('watchTimeMinutes',basicValues.estimatedMinutesWatched);
  assign('averageViewDurationSeconds',basicValues.averageViewDuration);
  assign('averagePercentageViewed',basicValues.averageViewPercentage);
  assign('subscribersGained',basicValues.subscribersGained);
  assign('subscribersLost',basicValues.subscribersLost);

  const nearest=(second:number)=>{
    if(!retentionCurve.length)return undefined;
    return [...retentionCurve].sort(
      (a,b)=>Math.abs(a.second-second)-Math.abs(b.second-second)
    )[0]?.audiencePercent;
  };
  const retention5=nearest(5);
  const retention30=nearest(30);
  if(retention5!==undefined)metrics.retentionFirstSecondsPercent=retention5;
  if(retention30!==undefined)metrics.retention30Percent=retention30;

  const trafficSources=(traffic.rows??[]).map(row=>{
    const value=rowObject(traffic,row);
    return {
      source:String(value.insightTrafficSourceType??'UNKNOWN'),
      views:Math.max(0,numeric(value.views)??0),
      watchTimeMinutes:Math.max(
        0,numeric(value.estimatedMinutesWatched)??0
      )
    };
  });

  const now=new Date().toISOString();
  const observation:PerformanceObservationPayload={
    kind:'performance-observation',
    id:crypto.randomUUID(),
    channelId:input.channelId,
    episodeId:input.episodeId,
    externalVideoId:metadata.videoId,
    sourceType:'youtube-analytics',
    observedAt:now,
    metrics,
    retentionCurve,
    trafficSources,
    comments,
    expectations:{},
    experiment:{changedVariables:[],notes:'Historical YouTube backfill.'},
    provenance:{
      sourceLabel:
        'YouTube Analytics historical backfill '+startDate+' → '+endDate
    },
    createdAt:now
  };
  const created=await createAutomaticYouTubePerformanceObservation(observation);
  return {...created,metadata,alreadyCollected:false};
}

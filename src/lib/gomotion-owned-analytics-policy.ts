// Pure helpers for the authorized EV read-only Analytics bridge.
// Returned values are explicitly allowlisted; never proxy Google's raw payload.
export const EV_CHANNEL_ID='UCVqoM3LGRS2nrfKk2CzeXjQ';
export const ANALYTICS_READ_SCOPE='https://www.googleapis.com/auth/yt-analytics.readonly';
const utcDay=(date:Date)=>date.toISOString().slice(0,10);
export function analyticsDateWindow(days:7|28,now=new Date()){
  const yesterday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-1));
  const first=new Date(yesterday.getTime()-(days-1)*86400000);
  return {days,startDate:utcDay(first),endDate:utcDay(yesterday),dateConvention:'UTC calendar dates; Google may finalize analytics later'};
}
export const googleAnalyticsMetrics='views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares';
type GoogleTable={columnHeaders?:Array<{name?:string}>;rows?:Array<Array<number|string|null>>};
const metricNames=[
  ['views','views'],
  ['estimatedMinutesWatched','watchTimeMinutes'],
  ['averageViewDuration','averageViewDurationSeconds'],
  ['averageViewPercentage','averagePercentageViewed'],
  ['subscribersGained','subscribersGained'],
  ['subscribersLost','subscribersLost'],
  ['likes','likes'],
  ['comments','commentCount'],
  ['shares','shares']
] as const;
export function safeAnalyticsReport(report:GoogleTable|unknown){
  const data=(report&&typeof report==='object'?report:{}) as GoogleTable;
  if(!Array.isArray(data.rows)||!data.rows.length||!Array.isArray(data.rows[0])){
    return {status:'no-rows' as const,metrics:null};
  }
  const row=data.rows[0];
  const headers=data.columnHeaders??[];
  const metrics:Record<string,number>={};
  for(const [googleName,key] of metricNames){
    const idx=headers.findIndex(h=>h?.name===googleName);
    if(idx<0)continue;
    const n=Number(row[idx]);
    if(row[idx]===null||row[idx]===undefined||!Number.isFinite(n)||n<0)continue;
    metrics[key]=n;
  }
  return {status:'available' as const,metrics};
}
type PlaylistItem={snippet?:{title?:string;channelId?:string;publishedAt?:string};contentDetails?:{videoId?:string;videoPublishedAt?:string}};
export function safeLatestVideoList(items:unknown,channelId:string,limit=5){
  if(!Array.isArray(items))return [];
  return items.flatMap((item:PlaylistItem)=>{
    const id=item?.contentDetails?.videoId;
    if(item?.snippet?.channelId!==channelId||!id||!/^[a-zA-Z0-9_-]{11}$/.test(id))return [];
    return [{videoId:id,title:String(item.snippet.title??'').trim().slice(0,200),
      publishedAt:item.contentDetails?.videoPublishedAt??item.snippet.publishedAt??null}];
  }).slice(0,Math.min(5,Math.max(0,limit)));
}

import { timingSafeEqual } from 'node:crypto';

export function bridgeSecretValid(
  provided:string|null,
  expected:string|undefined
):boolean{
  if(!expected||expected.length<32||!provided)return false;
  const a=Buffer.from(provided);
  const b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export function scopedYoutubeChannel<T extends {
  youtubeChannelId:string;status:string;isPrimary:boolean
}>(channels:T[],allowedYoutubeChannelId:string):T|null{
  if(!/^UC[A-Za-z0-9_-]{22}$/.test(allowedYoutubeChannelId))return null;
  const matches=channels.filter(channel=>channel.youtubeChannelId===allowedYoutubeChannelId);
  return matches.find(channel=>channel.isPrimary&&channel.status==='connected')
    ??matches.find(channel=>channel.status==='connected')
    ??matches[0]??null;
}

export function safeBridgeMetrics(metrics:Record<string,unknown>){
  const allow=[
    'views','impressions','ctrPercent','retentionFirstSecondsPercent',
    'retention30Percent','averageViewDurationSeconds','averagePercentageViewed',
    'watchTimeMinutes','likes','commentCount','shares','subscribersGained',
    'subscribersLost','conversions','revenue','rpm'
  ];
  return Object.fromEntries(
    allow.filter(key=>typeof metrics[key]==='number'&&Number.isFinite(metrics[key]))
      .map(key=>[key,metrics[key] as number])
  );
}

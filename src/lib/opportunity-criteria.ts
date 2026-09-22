import type { Channel, Settings } from './types';

export const REQUIRED_MARKET_COUNTRY='US';
export const REQUIRED_LANGUAGE_PREFIX='en';
export const MIN_LONG_FORM_SECONDS=240;

export type OpportunityQualification = {
  qualified: boolean;
  failed: string[];
  ageHours: number;
  channelAgeDays: number;
  breakoutRatio: number | null;
  durationSeconds: number;
};

export function isoDurationSeconds(value:string){
  const m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if(!m)return 0;
  return Number(m[1]??0)*86400+Number(m[2]??0)*3600+Number(m[3]??0)*60+Number(m[4]??0);
}

export function evaluateOpportunityCandidate(
  channel: Pick<Channel,'createdAt'|'observedAt'|'videoCount'|'subscribers'|'video'|'country'|'language'>,
  config: Pick<Settings,'minViews'|'maxVideoAgeHours'|'maxChannelVideos'|'maxChannelAgeDays'>
): OpportunityQualification {
  const observedAt=Date.parse(channel.observedAt);
  const publishedAt=Date.parse(channel.video.publishedAt);
  const createdAt=Date.parse(channel.createdAt);
  const ageHours=(observedAt-publishedAt)/3600000;
  const channelAgeDays=(observedAt-createdAt)/86400000;
  const durationSeconds=isoDurationSeconds(channel.video.duration);
  const breakoutRatio=channel.subscribers&&channel.subscribers>0
    ? channel.video.views/channel.subscribers
    : null;
  const failed:string[]=[];

  if(channel.country!==REQUIRED_MARKET_COUNTRY){
    failed.push('canal sem país público confirmado como Estados Unidos');
  }
  if(!channel.language.toLowerCase().startsWith(REQUIRED_LANGUAGE_PREFIX)){
    failed.push('idioma do vídeo não confirmado como inglês');
  }
  if(durationSeconds<MIN_LONG_FORM_SECONDS){
    failed.push(`vídeo com menos de ${MIN_LONG_FORM_SECONDS/60} minutos (não long form)`);
  }
  if(!Number.isFinite(ageHours)||ageHours<0||ageHours>=config.maxVideoAgeHours){
    failed.push(`vídeo fora da janela de ${config.maxVideoAgeHours}h`);
  }
  if(channel.video.views<config.minViews){
    failed.push(`menos de ${config.minViews} views`);
  }
  if(channel.videoCount>config.maxChannelVideos){
    failed.push(`mais de ${config.maxChannelVideos} vídeos no canal`);
  }
  if(!Number.isFinite(channelAgeDays)||channelAgeDays<0||channelAgeDays>config.maxChannelAgeDays){
    failed.push(`canal com mais de ${config.maxChannelAgeDays} dias`);
  }
  if(breakoutRatio!==null&&breakoutRatio<=1){
    failed.push('o vídeo não supera a base atual de inscritos');
  }

  return {
    qualified:failed.length===0,
    failed,
    ageHours,
    channelAgeDays,
    breakoutRatio,
    durationSeconds
  };
}

export function qualifiesOpportunityCandidate(
  channel: Pick<Channel,'createdAt'|'observedAt'|'videoCount'|'subscribers'|'video'|'country'|'language'>,
  config: Pick<Settings,'minViews'|'maxVideoAgeHours'|'maxChannelVideos'|'maxChannelAgeDays'>
){
  return evaluateOpportunityCandidate(channel,config).qualified;
}

import type { Channel, Settings } from './types';

export type OpportunityQualification = {
  qualified: boolean;
  failed: string[];
  ageHours: number;
  channelAgeDays: number;
  breakoutRatio: number | null;
};

export function evaluateOpportunityCandidate(
  channel: Pick<Channel,'createdAt'|'observedAt'|'videoCount'|'subscribers'|'video'>,
  config: Pick<Settings,'minViews'|'maxVideoAgeHours'|'maxChannelVideos'|'maxChannelAgeDays'>
): OpportunityQualification {
  const observedAt=Date.parse(channel.observedAt);
  const publishedAt=Date.parse(channel.video.publishedAt);
  const createdAt=Date.parse(channel.createdAt);
  const ageHours=(observedAt-publishedAt)/3600000;
  const channelAgeDays=(observedAt-createdAt)/86400000;
  const breakoutRatio=channel.subscribers&&channel.subscribers>0
    ? channel.video.views/channel.subscribers
    : null;
  const failed:string[]=[];

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
    breakoutRatio
  };
}

export function qualifiesOpportunityCandidate(
  channel: Pick<Channel,'createdAt'|'observedAt'|'videoCount'|'subscribers'|'video'>,
  config: Pick<Settings,'minViews'|'maxVideoAgeHours'|'maxChannelVideos'|'maxChannelAgeDays'>
){
  return evaluateOpportunityCandidate(channel,config).qualified;
}

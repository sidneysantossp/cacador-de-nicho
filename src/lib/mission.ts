import type { Channel, OpportunityReport } from './types';

const positive = new Set(['medium','high']);

export function productionReadiness(report:OpportunityReport){
  const reasons:string[]=[];
  const demand=report.viralDNA.demand.level;
  const repeatability=report.viralDNA.repeatability.level;
  const gap=report.viralDNA.gap.level;
  const saturation=report.viralDNA.saturation.level;

  if(report.validation.classification==='structural')reasons.push('Curva observada em pelo menos três criadores independentes.');
  if(positive.has(demand))reasons.push(`Demanda classificada como ${demand} com justificativa explícita.`);
  if(positive.has(repeatability))reasons.push(`Repetibilidade classificada como ${repeatability}.`);
  if(gap!=='low')reasons.push(`Lacuna não foi classificada como baixa (${gap}).`);
  if(saturation!=='high')reasons.push(`Saturação não foi classificada como alta (${saturation}).`);

  const ready=
    report.validation.classification==='structural' &&
    positive.has(demand) &&
    positive.has(repeatability) &&
    gap!=='low' &&
    saturation!=='high';

  return {ready,reasons};
}

export function channelMissionPriority(channel:Channel){
  const subscribers=channel.subscribers&&channel.subscribers>0?channel.subscribers:null;
  const breakout=subscribers?channel.video.views/subscribers:0;
  const ageMs=Math.max(0,Date.parse(channel.observedAt)-Date.parse(channel.video.publishedAt));
  return {
    breakout,
    views:channel.video.views,
    ageMs
  };
}

export function compareMissionCandidates(a:Channel,b:Channel){
  const pa=channelMissionPriority(a);
  const pb=channelMissionPriority(b);
  if(pb.breakout!==pa.breakout)return pb.breakout-pa.breakout;
  if(pb.views!==pa.views)return pb.views-pa.views;
  return pa.ageMs-pb.ageMs;
}

import type { UniverseCompetitor } from './types';

export const UNIVERSE_MONITORING_HOURS:Record<UniverseCompetitor['monitoringTier'],number>={
  hot:6,
  active:24,
  stable:72,
  dormant:168
};

export const UNIVERSE_STATUS_RANK:Record<UniverseCompetitor['status'],number>={
  'production-reference':8,
  'gap-found':7,
  'structural-curve':6,
  'emerging-curve':5,
  'pattern':4,
  'breakout':3,
  'heating-up':2,
  'watch':1
};

export function universeCompetitorDue(competitor:UniverseCompetitor,now=Date.now()){
  return now-Date.parse(competitor.lastMonitoredAt)>=UNIVERSE_MONITORING_HOURS[competitor.monitoringTier]*3600000;
}

function dnaEvidencePriority(competitor:UniverseCompetitor){
  const details=competitor.signalDetails??[];
  return {
    high:details.filter(signal=>signal.strength==='high').length,
    medium:details.filter(signal=>signal.strength==='medium').length,
    total:Math.max(details.length,competitor.signals.length),
    breakout:competitor.breakoutRatio??-1,
    uploads:competitor.uploadsLast30d,
    median:competitor.recentMedianViews??-1
  };
}

export function compareUniverseDnaPriority(a:UniverseCompetitor,b:UniverseCompetitor){
  const missingA=a.dna?1:0;
  const missingB=b.dna?1:0;
  if(missingA!==missingB)return missingA-missingB;

  const statusDelta=UNIVERSE_STATUS_RANK[b.status]-UNIVERSE_STATUS_RANK[a.status];
  if(statusDelta!==0)return statusDelta;

  const aEvidence=dnaEvidencePriority(a);
  const bEvidence=dnaEvidencePriority(b);
  for(const key of ['high','medium','total','breakout','uploads','median'] as const){
    const delta=bEvidence[key]-aEvidence[key];
    if(delta!==0)return delta;
  }

  return Date.parse(a.dna?.generatedAt??a.importedAt)-Date.parse(b.dna?.generatedAt??b.importedAt);
}

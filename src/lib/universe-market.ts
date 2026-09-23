import type { UniverseCompetitor, UniverseCurveClassification } from './types';
import { UNIVERSE_STATUS_RANK } from './universe-policy';

export function universeCurveClassification(channelIds:string[]):UniverseCurveClassification{
  const count=new Set(channelIds.filter(Boolean)).size;
  return count>=3?'structural':count>=2?'emerging':'hypothesis';
}

export function universeGapDemandStatus(
  classification:UniverseCurveClassification,
  targetEvidenceChannelIds:string[]
):'observed'|'partial'|'hypothesis'{
  const count=new Set(targetEvidenceChannelIds.filter(Boolean)).size;
  if(classification==='structural'&&count>=2)return 'observed';
  if(count>=1)return 'partial';
  return 'hypothesis';
}

export function universeKey(value:string){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72)||'curve';
}

export function selectUniverseCurveEvidence(competitors:UniverseCompetitor[],max=40,perCluster=8){
  const groups=new Map<string,UniverseCompetitor[]>();
  for(const competitor of competitors.filter(item=>!!item.dna)){
    const key=competitor.cluster||'Unclassified';
    groups.set(key,[...(groups.get(key)??[]),competitor]);
  }
  const sortedGroups=[...groups.entries()]
    .map(([cluster,items])=>[cluster,[...items].sort((a,b)=>{
      if(UNIVERSE_STATUS_RANK[b.status]!==UNIVERSE_STATUS_RANK[a.status])return UNIVERSE_STATUS_RANK[b.status]-UNIVERSE_STATUS_RANK[a.status];
      const signalDelta=(b.signalDetails?.length??b.signals.length)-(a.signalDetails?.length??a.signals.length);
      if(signalDelta!==0)return signalDelta;
      return (b.breakoutRatio??0)-(a.breakoutRatio??0);
    }).slice(0,perCluster)] as const)
    .sort((a,b)=>b[1].length-a[1].length);

  const selected:UniverseCompetitor[]=[];
  let index=0;
  while(selected.length<max&&sortedGroups.some(([,items])=>index<items.length)){
    for(const [,items] of sortedGroups){
      if(selected.length>=max)break;
      if(items[index])selected.push(items[index]);
    }
    index++;
  }
  return selected;
}

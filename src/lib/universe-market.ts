import type { UniverseCompetitor, UniverseCurveClassification, UniverseMarketIntelligence } from './types';
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


export function selectUniverseMissionOpportunities(
  intelligence:UniverseMarketIntelligence|null,
  max=5
){
  if(!intelligence)return [];
  const demandRank={observed:2,partial:1} as const;
  const saturationRank={low:3,medium:2,uncertain:1} as const;

  return intelligence.gaps.flatMap(gap=>{
    const curve=intelligence.curves.find(item=>item.id===gap.curveId);
    if(
      !curve||
      curve.classification!=='structural'||
      gap.demandStatus==='hypothesis'||
      gap.sampleSaturation==='high'
    )return [];

    const readiness:'pilot-ready'|'investigate'=
      gap.demandStatus==='observed'&&['low','medium'].includes(gap.sampleSaturation)
        ?'pilot-ready'
        :'investigate';
    const targetEvidenceCount=new Set(gap.targetEvidenceChannelIds.filter(Boolean)).size;

    return [{
      gapId:gap.id,
      curveId:curve.id,
      title:gap.title,
      curveName:curve.name,
      targetSpace:gap.targetSpace,
      readiness,
      demandStatus:gap.demandStatus,
      sampleSaturation:gap.sampleSaturation,
      independentCreators:curve.independentCreators,
      targetEvidenceCount,
      firstTest:gap.firstTests[0]??'Definir um piloto de baixo custo antes de escalar produção.',
      reasons:[
        `Curva estrutural sustentada por ${curve.independentCreators} criador(es) independente(s).`,
        `Demanda no target: ${gap.demandStatus} com ${targetEvidenceCount} canal(is) de evidência.`,
        `Saturação na amostra do Universe: ${gap.sampleSaturation}.`,
        gap.rationale
      ],
      risks:gap.risks
    }];
  }).sort((a,b)=>{
    if(a.readiness!==b.readiness)return a.readiness==='pilot-ready'?-1:1;
    const demandDelta=demandRank[b.demandStatus]-demandRank[a.demandStatus];
    if(demandDelta!==0)return demandDelta;
    const saturationDelta=saturationRank[b.sampleSaturation]-saturationRank[a.sampleSaturation];
    if(saturationDelta!==0)return saturationDelta;
    if(b.independentCreators!==a.independentCreators)return b.independentCreators-a.independentCreators;
    if(b.targetEvidenceCount!==a.targetEvidenceCount)return b.targetEvidenceCount-a.targetEvidenceCount;
    return a.title.localeCompare(b.title);
  }).slice(0,Math.max(0,Math.min(max,10)));
}

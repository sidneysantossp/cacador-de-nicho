import type { UniverseCompetitor, UniverseGap, UniverseMarketIntelligence } from './types';
import {
  resolveUniverseGapEvidence,
  selectUniverseMissionOpportunities,
  universeCurveClassification,
  universeGapDemandStatus,
  universeKey
} from './universe-market';

function gapKey(gap:Pick<UniverseGap,'title'|'targetSpace'>){
  return universeKey(gap.targetSpace||gap.title);
}

export function preserveUniverseMarketContinuity(
  current:UniverseMarketIntelligence,
  previousReports:Array<UniverseMarketIntelligence|null|undefined>,
  competitors:UniverseCompetitor[],
  maxCarried=5
):UniverseMarketIntelligence{
  const withDna=competitors.filter(item=>!!item.dna);
  const validIds=new Set(withDna.map(item=>item.channelId));
  const curves=[...current.curves];
  const gaps=[...current.gaps];
  const gapKeys=new Set(gaps.map(gapKey));
  const sourceIds=new Set(current.sourceCompetitorIds);
  let carried=0;

  for(const previous of previousReports){
    if(!previous||carried>=maxCarried)continue;
    for(const opportunity of selectUniverseMissionOpportunities(previous,10)){
      if(carried>=maxCarried)break;
      const priorGap=previous.gaps.find(item=>item.id===opportunity.gapId);
      const priorCurve=previous.curves.find(item=>item.id===opportunity.curveId);
      if(!priorGap||!priorCurve)continue;
      const key=gapKey(priorGap);
      if(gapKeys.has(key))continue;

      const support=[...new Set(priorCurve.supportingChannelIds.filter(id=>validIds.has(id)))];
      let curve=curves.find(item=>item.id===priorCurve.id);
      if(curve){
        if(curve.classification!=='structural')continue;
      }else{
        const classification=universeCurveClassification(support);
        if(classification!=='structural')continue;
        curve={...priorCurve,supportingChannelIds:support,independentCreators:new Set(support).size,classification};
        curves.push(curve);
      }

      const resolved=resolveUniverseGapEvidence(withDna,priorGap,priorGap.targetEvidenceChannelIds);
      const demandStatus=universeGapDemandStatus(curve.classification,resolved.channelIds);
      if(demandStatus==='hypothesis'||priorGap.sampleSaturation==='high')continue;

      gaps.push({
        ...priorGap,
        curveId:curve.id,
        demandStatus,
        targetEvidenceChannelIds:resolved.channelIds,
        demandEvidence:[
          `Continuidade do Market: hipótese acionável de ${previous.generatedAt} revalidada contra o Universe atual.`,
          ...resolved.evidence,
          ...priorGap.demandEvidence.filter(item=>!item.startsWith('Continuidade do Market:'))
        ].slice(0,8)
      });
      gapKeys.add(key);
      carried++;
      for(const id of [...support,...resolved.channelIds])sourceIds.add(id);
    }
  }

  return {
    ...current,
    sourceCompetitorIds:[...sourceIds],
    curves,
    gaps,
    limitations:[
      ...current.limitations,
      ...(carried?[`${carried} gap(s) acionável(is) anterior(es) foram mantidos somente após revalidação determinística.`]:[])
    ]
  };
}

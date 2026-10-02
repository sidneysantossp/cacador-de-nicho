import type { ProductionAutonomySummary } from './types';

type ProductionCandidate={
  id:string;
  narrativeReady:boolean;
  blockers:string[];
  originalityGate?:{status:'pass'|'review'|'block'};
  productionAutonomy?:ProductionAutonomySummary;
};

/** Economics only orders candidates already eligible for autonomous production. */
export function productionAutonomyRecommendation(candidates:ProductionCandidate[]){
  return candidates
    .filter(candidate=>candidate.narrativeReady&&candidate.blockers.length===0&&
      candidate.originalityGate?.status==='pass'&&
      candidate.productionAutonomy?.status==='approved')
    .map((candidate,index)=>({candidate,index}))
    .sort((a,b)=>(b.candidate.productionAutonomy?.score??0)-
      (a.candidate.productionAutonomy?.score??0)||a.index-b.index)[0]?.candidate.id??null;
}

export function productionAutonomyPending(candidates:ProductionCandidate[]){
  return candidates.some(candidate=>candidate.narrativeReady&&candidate.blockers.length===0&&
    candidate.originalityGate?.status==='pass'&&!candidate.productionAutonomy);
}

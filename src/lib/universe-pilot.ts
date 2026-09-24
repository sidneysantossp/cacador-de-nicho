import type { Decision, MissionBrief, UniverseMarketIntelligence } from './types';
import { selectUniverseMissionOpportunities } from './universe-market';

export type UniversePilotDecisionChoice='approved'|'rejected';
export type UniverseMissionOpportunity=MissionBrief['universeOpportunities'][number];

export function resolveUniversePilotDecision(
  intelligence:UniverseMarketIntelligence|null,
  gapId:string
):
  | {ok:true;opportunity:UniverseMissionOpportunity}
  | {ok:false;reason:'market-unavailable'|'not-actionable'|'not-pilot-ready'}{
  if(!intelligence)return {ok:false,reason:'market-unavailable'};
  const opportunity=selectUniverseMissionOpportunities(intelligence,10).find(item=>item.gapId===gapId);
  if(!opportunity)return {ok:false,reason:'not-actionable'};
  if(opportunity.readiness!=='pilot-ready')return {ok:false,reason:'not-pilot-ready'};
  return {ok:true,opportunity};
}

export function buildUniversePilotDecision(input:{
  id:string;
  createdAt:string;
  intelligence:UniverseMarketIntelligence;
  opportunity:UniverseMissionOpportunity;
  decision:UniversePilotDecisionChoice;
  reason:string;
}):Decision{
  const {id,createdAt,intelligence,opportunity,decision,reason}=input;
  return {
    id,
    kind:'universe-pilot',
    channelId:'universe',
    opportunityId:opportunity.gapId,
    decision,
    reason,
    createdAt,
    marketGeneratedAt:intelligence.generatedAt,
    title:opportunity.title,
    targetSpace:opportunity.targetSpace,
    readiness:opportunity.readiness,
    demandStatus:opportunity.demandStatus,
    sampleSaturation:opportunity.sampleSaturation,
    independentCreators:opportunity.independentCreators,
    targetEvidenceCount:opportunity.targetEvidenceCount,
    firstTest:opportunity.firstTest,
    alternateAngles:opportunity.alternateAngles??[]
  };
}

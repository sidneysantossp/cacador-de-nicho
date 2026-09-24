import type { Decision, MissionBrief, UniverseMarketIntelligence, UniversePilotBrief } from './types';
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

export function buildUniversePilotBrief(input:{
  decisionId:string;
  createdAt:string;
  intelligence:UniverseMarketIntelligence;
  opportunity:UniverseMissionOpportunity;
}):UniversePilotBrief{
  const {decisionId,createdAt,intelligence,opportunity}=input;
  const gap=intelligence.gaps.find(item=>item.id===opportunity.gapId);
  const curve=intelligence.curves.find(item=>item.id===opportunity.curveId);
  if(!gap||!curve)throw new Error('A evidência do piloto não existe mais no snapshot do Market.');
  if(curve.classification!=='structural'||gap.demandStatus!=='observed')throw new Error('O snapshot do Market não sustenta um Pilot Brief.');

  return {
    kind:'universe-pilot-brief',
    id:`universe-pilot-brief:${decisionId}`,
    decisionId,
    gapId:opportunity.gapId,
    marketGeneratedAt:intelligence.generatedAt,
    createdAt,
    status:'approved-for-test',
    title:opportunity.title,
    targetSpace:opportunity.targetSpace,
    curveId:opportunity.curveId,
    curveName:opportunity.curveName,
    firstTest:opportunity.firstTest,
    alternateAngles:opportunity.alternateAngles??[],
    hypothesis:`Testar se o mecanismo editorial "${curve.name}" transfere para "${gap.targetSpace}" em um único episódio controlado, sem assumir que a evidência do mercado garante desempenho no canal próprio.`,
    evidence:{
      curveClassification:'structural',
      independentCreators:opportunity.independentCreators,
      targetEvidenceCount:opportunity.targetEvidenceCount,
      demandStatus:'observed',
      sampleSaturation:opportunity.sampleSaturation,
      supportingChannelIds:[...curve.supportingChannelIds],
      targetEvidenceChannelIds:[...gap.targetEvidenceChannelIds],
      demandEvidence:gap.demandEvidence.slice(0,8)
    },
    risks:[...opportunity.risks],
    testPlan:{
      episodeTitle:opportunity.firstTest,
      purpose:'Validar uma única transferência editorial antes de escalar produção ou criar uma série.',
      preserveMechanism:gap.preservedMechanism,
      changedVariable:gap.changedVariable,
      successGate:[
        'O episódio publicado deve preservar o mecanismo editorial da curva e manter o target aprovado no brief.',
        'Depois da publicação em um canal próprio, comparar somente métricas reais desse canal com seu baseline disponível; não inventar benchmark externo.',
        'Usar performance e feedback real do público para decidir se existe evidência suficiente para um segundo episódio.'
      ],
      stopGate:[
        'Não publicar ou escalar se a revisão factual/técnica do episódio não passar.',
        'Não transformar um único piloto em série sem evidência pós-publicação do canal próprio.',
        'Se o Market perder o status PILOT READY antes da produção, revalidar o brief antes de usar a hipótese.'
      ]
    },
    nextGate:'produce-one-pilot'
  };
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
  const pilotBrief=decision==='approved'
    ?buildUniversePilotBrief({decisionId:id,createdAt,intelligence,opportunity})
    :undefined;
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
    alternateAngles:opportunity.alternateAngles??[],
    pilotBrief
  };
}

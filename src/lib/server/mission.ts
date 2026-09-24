import 'server-only';

import type { Channel, ChannelStudy, MissionBrief, OpportunityReport, Run, UniverseCompetitor, UniverseImportQueueSummary, UniverseMarketIntelligence } from '@/lib/types';
import { compareMissionCandidates, productionReadiness, universeCompetitorHasSignals } from '@/lib/mission';
import { selectUniverseMissionOpportunities } from '@/lib/universe-market';
import { qualifiesOpportunityCandidate } from '@/lib/opportunity-criteria';
import { runChannelStudy } from './channel-study';
import { checked, db, list, put, settings } from './db';
import { runRadar } from './jobs';
import { runOpportunityReport } from './opportunity-report';
import { HttpError } from './auth';
import { providerSecret, testProvider } from './providers';
import { isYouTubeSearchQuotaError, YouTubeSearchQuotaError } from './youtube';
import { YouTubeSearchBudgetError } from './youtube-search-budget';
import { processUniverseImportQueue, refreshUniverseCompetitors, runUniverseIntelligence, runUniverseMarketIntelligence, shouldRefreshUniverseMarketIntelligence, universeMarketIntelligenceState, universeQueueSummary, universeState } from './universe';

const OBJECTIVE='Encontrar, validar e transformar oportunidades de conteúdo em ativos capazes de gerar receita.';

function isStudy(value:unknown):value is ChannelStudy{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='channel-study';
}
function isReport(value:unknown):value is OpportunityReport{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='opportunity-report';
}
function isNewer(a:string,b:string){return Date.parse(a)>Date.parse(b);}

async function loadMissionState(){
  const [config,channels,analyses]=await Promise.all([
    settings(),
    list<Channel>('radar_channels',1000),
    list<unknown>('radar_analyses',300)
  ]);
  return {
    config,
    channels:channels.filter(channel=>channel.discoverySource==='reference-adjacent'&&qualifiesOpportunityCandidate(channel,config)),
    studies:analyses.filter(isStudy),
    reports:analyses.filter(isReport)
  };
}

async function providerHealth(){
  const config=await settings();
  const result={youtube:false,openai:false,blockers:[] as string[]};
  try{
    const key=await providerSecret('youtube');
    await testProvider('youtube',key);
    result.youtube=true;
  }catch(error){
    result.blockers.push(error instanceof Error?error.message:'YouTube indisponível.');
  }
  try{
    const key=await providerSecret('openai');
    await testProvider('openai',key,config.analysisModel);
    result.openai=true;
  }catch(error){
    result.blockers.push(error instanceof Error?error.message:'OpenAI indisponível.');
  }
  return result;
}

function reportSource(report:OpportunityReport,studies:ChannelStudy[]){
  return studies.find(study=>study.id===report.channelStudyId)?.source.name??report.title;
}

function buildBrief(input:{
  startedAt:string;
  completedAt:string;
  status:MissionBrief['status'];
  health:MissionBrief['health'];
  channels:Channel[];
  studies:ChannelStudy[];
  reports:OpportunityReport[];
  universe:UniverseCompetitor[];
  universeIntelligence:UniverseMarketIntelligence|null;
  universeQueue:UniverseImportQueueSummary;
  workCompleted:string[];
  blockers:string[];
  notes:string[];
}):MissionBrief{
  const productionQueue=input.reports.flatMap(report=>{
    const readiness=productionReadiness(report);
    if(!readiness.ready)return [];
    return [{
      reportId:report.id,
      channelStudyId:report.channelStudyId,
      sourceChannelId:report.sourceChannelId,
      title:report.title,
      sourceChannel:reportSource(report,input.studies),
      conceptName:report.channelConcept.nameDirections[0]??report.title,
      firstEpisode:report.channelConcept.firstEpisodes[0]??'',
      readiness:'production-ready' as const,
      reasons:readiness.reasons,
      nextAction:report.nextMove
    }];
  }).slice(0,5);

  const allUniverseOpportunities=selectUniverseMissionOpportunities(input.universeIntelligence,10);
  const universeOpportunities=allUniverseOpportunities.slice(0,5);

  const decisionsNeeded:MissionBrief['decisionsNeeded']=[];
  for(const report of input.reports){
    if(decisionsNeeded.length>=5)break;
    const readiness=productionReadiness(report);
    if(readiness.ready)continue;
    const strongDemand=['medium','high'].includes(report.viralDNA.demand.level);
    const strongRepeatability=['medium','high'].includes(report.viralDNA.repeatability.level);
    const usefulGap=report.viralDNA.gap.level!=='low';
    if(report.validation.classification==='emerging'&&strongDemand&&strongRepeatability&&usefulGap){
      decisionsNeeded.push({
        type:'pilot-decision',
        title:report.title,
        reason:'A curva ainda é emergente, mas demanda, repetibilidade e lacuna justificam decidir se vale um piloto barato antes da validação estrutural.',
        reportId:report.id
      });
      continue;
    }
    if(report.validation.classification==='structural'&&(report.viralDNA.saturation.level==='high'||report.viralDNA.gap.level==='low')){
      decisionsNeeded.push({
        type:'evidence-review',
        title:report.title,
        reason:'A curva é estrutural, mas a saturação/lacuna atual reduz a clareza de entrada. Requer decisão humana antes de comprometer produção.',
        reportId:report.id
      });
    }
  }

  return {
    kind:'mission-brief',
    id:`mission-brief:${input.completedAt.slice(0,10)}`,
    objective:OBJECTIVE,
    status:input.status,
    startedAt:input.startedAt,
    completedAt:input.completedAt,
    health:input.health,
    market:{
      qualifiedChannels:input.channels.length,
      channelStudies:input.studies.length,
      opportunityReports:input.reports.length,
      productionReady:productionQueue.length,
      competitors:input.universe.length,
      competitorSignals:input.universe.filter(universeCompetitorHasSignals).length,
      competitorDna:input.universe.filter(item=>!!item.dna).length,
      universeCurves:input.universeIntelligence?.curves.length??0,
      universeGaps:input.universeIntelligence?.gaps.length??0,
      universeActionableGaps:allUniverseOpportunities.length,
      universeQueuePending:input.universeQueue.pending+input.universeQueue.retryable+input.universeQueue.processing,
      universeQueueCompleted:input.universeQueue.completed
    },
    workCompleted:input.workCompleted,
    productionQueue,
    universeOpportunities,
    decisionsNeeded,
    blockers:input.blockers,
    notes:input.notes
  };
}

export async function runMission():Promise<MissionBrief>{
  const startedAt=new Date().toISOString();
  const key=`mission:${Date.now()}:${crypto.randomUUID().slice(0,8)}`;
  const token=crypto.randomUUID();
  const acquired=checked(await db().rpc('claim_radar_job',{job_key:key,lease_token:token}));
  if(!acquired)throw new HttpError('Outra tarefa pesada já está em execução. Consulte Atividade e tente a missão novamente depois.',409);

  const run:Run={id:key,type:'Mission Control',status:'running',startedAt,message:'Objetivo ativo: encontrar e preparar oportunidades rentáveis.'};
  await put('radar_runs',key,run);

  const workCompleted:string[]=[];
  const blockers:string[]=[];
  const notes:string[]=[];
  const startedMs=Date.now();

  try{
    const healthResult=await providerHealth();
    const health:MissionBrief['health']={
      supabase:true,
      youtube:healthResult.youtube,
      openai:healthResult.openai,
      blockers:[...healthResult.blockers]
    };

    let state=await loadMissionState();
    let universe=await universeState();
    let universeIntelligence=await universeMarketIntelligenceState();
    let universeQueue=await universeQueueSummary();
    let reportsGenerated=0;
    let studiesGenerated=0;

    // Close the nearest-to-revenue gap first: a completed study without a fresh report.
    if(health.openai){
      const pendingStudy=state.studies
        .filter(study=>{
          const report=state.reports.find(item=>item.channelStudyId===study.id);
          return !report||isNewer(study.createdAt,report.createdAt);
        })
        .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
      if(pendingStudy){
        try{
          await runOpportunityReport(pendingStudy.id);
          reportsGenerated++;
          workCompleted.push(`Opportunity Report gerado/atualizado para ${pendingStudy.source.name}.`);
          state=await loadMissionState();
        }catch(error){
          blockers.push(`Opportunity Report: ${error instanceof Error?error.message:'falha não identificada'}`);
        }
      }
    }

    // Bootstrap the known market before refreshing it or spending scarce search quota outside it.
    if(health.youtube&&(universeQueue.pending+universeQueue.retryable>0)&&Date.now()-startedMs<80000){
      try{
        const imported=await processUniverseImportQueue(25);
        universeQueue=imported.summary;
        if(imported.succeeded>0)workCompleted.push(`Universe bootstrap: ${imported.succeeded} concorrente(s) resolvido(s) e enriquecido(s).`);
        if(imported.failed>0)blockers.push(`Universe bootstrap: ${imported.failed} item(ns) falharam neste lote; serão retentados até o limite configurado.`);
        universe=await universeState();
        if(universeQueue.pending+universeQueue.retryable>0){
          notes.push(`Universe bootstrap em progresso: ${universeQueue.completed}/${universeQueue.total} concluídos; ${universeQueue.pending+universeQueue.retryable} aguardando.`);
        }
      }catch(error){
        blockers.push(`Universe bootstrap: ${error instanceof Error?error.message:'falha não identificada'}`);
      }
    }

    // Keep the known market fresh before spending scarce search quota outside it.
    if(health.youtube&&universe.length&&Date.now()-startedMs<105000){
      try{
        const refreshed=await refreshUniverseCompetitors(undefined,10);
        if(refreshed.refreshed>0)workCompleted.push(`Universe: ${refreshed.refreshed} concorrente(s) vencido(s) atualizado(s).`);
        if(refreshed.failed>0)blockers.push(`Universe: ${refreshed.failed} atualização(ões) de concorrente falharam.`);
        universe=await universeState();
      }catch(error){
        blockers.push(`Universe refresh: ${error instanceof Error?error.message:'falha não identificada'}`);
      }
    }

    if(health.openai&&universe.length&&Date.now()-startedMs<140000){
      try{
        const intelligence=await runUniverseIntelligence();
        if(intelligence.analyzed>0)workCompleted.push(intelligence.message);
        universe=await universeState();
      }catch(error){
        blockers.push(`Universe Intelligence: ${error instanceof Error?error.message:'falha não identificada'}`);
      }
    }

    if(health.openai&&Date.now()-startedMs<160000){
      try{
        if(await shouldRefreshUniverseMarketIntelligence()){
          universeIntelligence=await runUniverseMarketIntelligence();
          workCompleted.push(`Universe Market Intelligence: ${universeIntelligence.curves.length} curva(s) e ${universeIntelligence.gaps.length} gap(s) organizados.`);
          universe=await universeState();
        }
      }catch(error){
        blockers.push(`Universe Curves & Gaps: ${error instanceof Error?error.message:'falha não identificada'}`);
      }
    }

    // Keep the external market fresh only after the known Universe has advanced.
    const youtubeDataAvailable=health.youtube;
    if(health.youtube&&Date.now()-startedMs<175000){
      try{
        const message=await runRadar(false,false);
        workCompleted.push(message);
        state=await loadMissionState();
      }catch(error){
        if(isYouTubeSearchQuotaError(error)){
          const discoveryOnly=error instanceof YouTubeSearchBudgetError&&error.reason==='purpose-limit';
          const transient=error instanceof YouTubeSearchQuotaError&&!error.hardQuota;
          blockers.push(discoveryOnly
            ?'Radar: orçamento diário de descoberta atingido. A reserva de busca para Análise de Canal e similares permanece disponível.'
            :transient
              ?'Radar: o YouTube aplicou um limite temporário de busca. Novas pesquisas foram interrompidas nesta missão para evitar retries inúteis.'
              :'Radar: cota global de search.list do YouTube indisponível. Novas buscas foram pausadas nesta missão.');
          notes.push(discoveryOnly
            ?'Quota Intelligence preservou o orçamento reservado para aprofundar candidatos já encontrados.'
            :transient
              ?'O limite temporário não marcou o restante do dia como esgotado; uma missão posterior poderá tentar novamente.'
              :'Modo quota-degraded: o sistema continuou trabalhando apenas com estudos e Opportunity Reports já existentes.');
        }else{
          blockers.push(`Radar: ${error instanceof Error?error.message:'falha não identificada'}`);
        }
      }
    }

    // Open at most one new deep investigation per mission. A known channel can
    // still be analyzed when search.list is unavailable: Channel Study falls
    // back to the uploads playlist and marks the sample scope explicitly.
    if(youtubeDataAvailable&&health.openai&&Date.now()-startedMs<195000){
      const studiedIds=new Set(state.studies.map(study=>study.source.id));
      const candidate=state.channels.filter(channel=>!studiedIds.has(channel.id)).sort(compareMissionCandidates)[0];
      if(candidate){
        try{
          const study=await runChannelStudy(candidate.url||candidate.handle);
          studiesGenerated++;
          workCompleted.push(`Análise de Canal concluída para ${study.source.name}${study.topSampleScope==='recent-uploads'?' em modo sem search.list':''}.`);
          state=await loadMissionState();

          // One report maximum per mission. If no older pending report consumed the slot,
          // close the newly-created study while there is still execution budget.
          if(reportsGenerated===0&&Date.now()-startedMs<225000){
            try{
              await runOpportunityReport(study.id);
              reportsGenerated++;
              workCompleted.push(`Opportunity Report gerado para ${study.source.name}.`);
              state=await loadMissionState();
            }catch(error){
              blockers.push(`Opportunity Report de ${study.source.name}: ${error instanceof Error?error.message:'falha não identificada'}`);
            }
          }
        }catch(error){
          blockers.push(`Análise de Canal: ${error instanceof Error?error.message:'falha não identificada'}`);
        }
      }else{
        notes.push('Nenhum novo candidato rígido do Radar precisava de Análise de Canal nesta execução.');
      }
    }

    if(studiesGenerated===0&&reportsGenerated===0&&state.channels.length===0){
      notes.push('Nenhuma oportunidade passou pelos gates rígidos nesta rodada. Os critérios não foram relaxados para preencher a fila.');
    }

    const completedAt=new Date().toISOString();
    const status:MissionBrief['status']=health.blockers.length?'blocked':blockers.length?'partial':'completed';
    const brief=buildBrief({
      startedAt,
      completedAt,
      status,
      health,
      channels:state.channels,
      studies:state.studies,
      reports:state.reports,
      universe,
      universeIntelligence,
      universeQueue,
      workCompleted,
      blockers,
      notes
    });

    await put('radar_analyses',brief.id,brief);
    await put('radar_runs',key,{...run,status:'completed',message:`Missão ${status}: ${brief.market.productionReady} oportunidade(s) pronta(s) para produção; ${brief.universeOpportunities.length} oportunidade(s) acionável(is) do Universe; ${brief.decisionsNeeded.length} decisão(ões) do operador.`});
    checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:true}));
    return brief;
  }catch(error){
    const message=error instanceof Error?error.message:'Missão interrompida.';
    await put('radar_runs',key,{...run,status:'failed',message:message.slice(0,600)});
    checked(await db().rpc('finish_radar_job',{job_key:key,lease_token:token,success:false}));
    throw error;
  }
}

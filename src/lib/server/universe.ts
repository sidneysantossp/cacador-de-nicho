import 'server-only';

import type { ManagedChannel, UniverseCompetitor, UniverseImportQueueSummary, UniverseMarketIntelligence, UniversePriorityDiscovery } from '@/lib/types';
import { z } from 'zod';
import { checked, db, list, put } from './db';
import { HttpError } from './auth';
import { collectUniverseCompetitor, discoverUniversePriorityChannels, type UniversePriorityChannelCandidate } from './youtube';
import { analyzeUniverseCompetitorDNA, analyzeUniverseCurvesAndGaps, universeChannelDnaSchema, universeCurvesGapsSchema, UNIVERSE_DNA_MODEL } from './ai';
import { summarizeUniverseQueueRows, universeCompetitorDue, universeImportFailureIsPermanent, universeMarketRefreshDecision, UNIVERSE_STATUS_RANK } from '@/lib/universe-policy';
import { resolveUniverseGapEvidence, selectUniverseCurveEvidence, selectUniverseDnaBootstrapBatch, selectUniverseGapValidationDnaBatch, universeCurveClassification, universeGapDemandStatus, universeKey } from '@/lib/universe-market';
import { preserveUniverseMarketContinuity, revalidateUniverseMarketEvidenceReport } from '@/lib/universe-market-continuity';
import { PRIORITY_CONTENT_MODELS, PRIORITY_CONTENT_MODEL_VERSION, inferPriorityContentModel, priorityContentModelById, priorityDiscoverySeed, type PriorityContentModel } from '@/lib/priority-content-models';

function isCompetitor(value:unknown):value is UniverseCompetitor{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='competitor';
}

async function mapLimit<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>){
  const output=new Array<R>(items.length);
  let cursor=0;
  async function worker(){
    while(cursor<items.length){
      const index=cursor++;
      output[index]=await work(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return output;
}

export async function universeState(){
  const records=await list<ManagedChannel|UniverseCompetitor>('radar_managed_channels',1000);
  return records.filter(isCompetitor);
}

type UniversePriorityAssignment={
  kind:'universe-priority-assignment';
  id:string;
  channelId:string;
  modelId:string;
  modelName:string;
  fitScore:9|10;
  tier:'core'|'expansion';
  seed:string;
  discoveredAt:string;
  evidenceVideoId:string;
  evidenceVideoTitle:string;
  evidenceViews:number;
};

function priorityAssignmentId(channelId:string){
  return 'universe-priority-assignment:'+channelId;
}

function priorityModelText(competitor:UniverseCompetitor){
  return [
    competitor.name,
    competitor.description,
    competitor.sourceCluster,
    competitor.cluster,
    competitor.subniche,
    competitor.format,
    competitor.dna?.primaryNiche,
    competitor.dna?.subniche,
    competitor.dna?.formatSignature,
    ...(competitor.dna?.contentPillars??[]),
    ...(competitor.dna?.titlePatterns??[])
  ].filter(Boolean).join(' ');
}

export function priorityModelForCompetitor(competitor:UniverseCompetitor):PriorityContentModel|null{
  return priorityContentModelById(competitor.priorityModelId)??inferPriorityContentModel(priorityModelText(competitor));
}

export function priorityUniverseCompetitors(items:UniverseCompetitor[]){
  return items.filter(item=>!!priorityModelForCompetitor(item));
}

async function loadPriorityAssignment(channelId:string):Promise<UniversePriorityAssignment|null>{
  const result=await db().from('radar_analyses').select('payload').eq('id',priorityAssignmentId(channelId)).maybeSingle();
  if(result.error)throw new HttpError('Falha ao ler a proveniência estratégica do Universe.',502);
  const payload=result.data?.payload as UniversePriorityAssignment|undefined;
  return payload?.kind==='universe-priority-assignment'?payload:null;
}

function applyPriorityAssignment(competitor:UniverseCompetitor,assignment:UniversePriorityAssignment|null){
  if(!assignment)return competitor;
  return {
    ...competitor,
    priorityModelId:assignment.modelId,
    priorityModelName:assignment.modelName,
    priorityModelFit:assignment.fitScore,
    priorityModelTier:assignment.tier,
    priorityDiscoverySeed:assignment.seed,
    priorityDiscoveredAt:assignment.discoveredAt,
    priorityEvidenceVideoId:assignment.evidenceVideoId,
    priorityEvidenceVideoTitle:assignment.evidenceVideoTitle
  } satisfies UniverseCompetitor;
}

export async function universePriorityDiscoveryState():Promise<UniversePriorityDiscovery|null>{
  const result=await db().from('radar_analyses').select('payload').eq('id','universe-priority-discovery:latest').maybeSingle();
  if(result.error)throw new HttpError('Falha ao ler a descoberta estratégica do Universe.',502);
  const payload=result.data?.payload as UniversePriorityDiscovery|undefined;
  return payload?.kind==='universe-priority-discovery'?payload:null;
}

export async function discoverPriorityUniverse(modelIds?:string[]):Promise<UniversePriorityDiscovery>{
  const requested=modelIds?.length?new Set(modelIds):null;
  const models=PRIORITY_CONTENT_MODELS.filter(model=>!requested||requested.has(model.id));
  if(!models.length)throw new HttpError('Nenhum modelo prioritário válido foi selecionado.',400);

  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));
  const queueRows=checked(await db().from('radar_universe_queue').select('input,status')) as Array<Pick<UniverseQueueRow,'input'|'status'>>;
  const queuedInputs=new Set(queueRows.map(row=>row.input));
  const discoveredAt=new Date().toISOString();
  const candidateMap=new Map<string,{model:PriorityContentModel;seed:string;candidate:UniversePriorityChannelCandidate}>();
  const modelResults:UniversePriorityDiscovery['modelResults']=[];
  const errors:string[]=[];
  let searchedQueries=0;

  for(const model of models){
    const seed=priorityDiscoverySeed(model);
    let candidates:UniversePriorityChannelCandidate[]=[];
    try{
      candidates=await discoverUniversePriorityChannels(seed,'priority:'+model.id+':'+seed,6);
      searchedQueries++;
    }catch(error){
      errors.push(model.name+': '+(error instanceof Error?error.message:'falha não identificada'));
    }
    let modelExisting=0;
    let modelQueued=0;
    for(const candidate of candidates){
      const prior=candidateMap.get(candidate.channelId);
      if(!prior||model.fitScore>prior.model.fitScore||candidate.views>prior.candidate.views){
        candidateMap.set(candidate.channelId,{model,seed,candidate});
      }
      if(byChannel.has(candidate.channelId))modelExisting++;
      else if(!queuedInputs.has(candidate.channelId))modelQueued++;
    }
    modelResults.push({
      modelId:model.id,
      modelName:model.name,
      fitScore:model.fitScore,
      tier:model.tier,
      seed,
      candidates:candidates.length,
      queued:modelQueued,
      existing:modelExisting
    });
  }

  let queuedChannels=0;
  let existingChannels=0;
  let duplicateQueueChannels=0;
  const ranked=[...candidateMap.values()].sort((a,b)=>b.model.fitScore-a.model.fitScore||b.candidate.views-a.candidate.views);

  for(const item of ranked){
    const assignment:UniversePriorityAssignment={
      kind:'universe-priority-assignment',
      id:priorityAssignmentId(item.candidate.channelId),
      channelId:item.candidate.channelId,
      modelId:item.model.id,
      modelName:item.model.name,
      fitScore:item.model.fitScore,
      tier:item.model.tier,
      seed:item.seed,
      discoveredAt,
      evidenceVideoId:item.candidate.videoId,
      evidenceVideoTitle:item.candidate.videoTitle,
      evidenceViews:item.candidate.views
    };
    await put('radar_analyses',assignment.id,assignment);

    const current=byChannel.get(item.candidate.channelId);
    if(current){
      existingChannels++;
      const enriched=applyPriorityAssignment(current,assignment);
      await put('radar_managed_channels',enriched.id,enriched);
      byChannel.set(enriched.channelId,enriched);
      continue;
    }
    if(queuedInputs.has(item.candidate.channelId)){
      duplicateQueueChannels++;
      continue;
    }
    const id='universe-priority:'+item.candidate.channelId;
    checked(await db().from('radar_universe_queue').insert({
      id,
      input:item.candidate.channelId,
      status:'pending',
      attempts:0,
      last_error:null,
      created_at:discoveredAt,
      updated_at:discoveredAt
    }));
    queuedInputs.add(item.candidate.channelId);
    queuedChannels++;
  }

  const report:UniversePriorityDiscovery={
    kind:'universe-priority-discovery',
    id:'universe-priority-discovery:latest',
    generatedAt:discoveredAt,
    modelVersion:PRIORITY_CONTENT_MODEL_VERSION,
    searchedModelIds:models.map(model=>model.id),
    searchedQueries,
    candidateChannels:ranked.length,
    queuedChannels,
    existingChannels,
    duplicateQueueChannels,
    modelResults,
    errors:errors.slice(0,8)
  };
  await put('radar_analyses',report.id,report);
  return report;
}

export async function runPriorityUniverseDiscovery(modelIds?:string[]){
  const discovery=await discoverPriorityUniverse(modelIds);
  const bootstrap=discovery.queuedChannels>0
    ?await processUniverseImportQueue(Math.min(25,discovery.queuedChannels))
    :{processed:0,succeeded:0,failed:0,summary:await universeQueueSummary()};
  const finalReport:UniversePriorityDiscovery={
    ...discovery,
    importedChannels:bootstrap.succeeded,
    failedImports:bootstrap.failed
  };
  await put('radar_analyses',finalReport.id,finalReport);
  return {discovery:finalReport,bootstrap};
}

type UniverseQueueRow={
  id:string;
  input:string;
  status:'pending'|'processing'|'completed'|'failed';
  attempts:number;
  last_error:string|null;
  created_at:string;
  updated_at:string;
};

function mergeCompetitorSnapshot(snapshot:UniverseCompetitor,prior?:UniverseCompetitor):UniverseCompetitor{
  if(!prior)return snapshot;
  return {
    ...snapshot,
    importedAt:prior.importedAt,
    sourceCluster:prior.sourceCluster??snapshot.sourceCluster??prior.cluster,
    cluster:prior.dna?prior.cluster:snapshot.cluster,
    subniche:prior.subniche,
    format:prior.dna?prior.format:snapshot.format,
    monitoringTier:prior.monitoringTier,
    status:['pattern','emerging-curve','structural-curve','gap-found','production-reference'].includes(prior.status)?prior.status:snapshot.status,
    snapshots:[...(snapshot.snapshots??[]),...(prior.snapshots??[])].filter((item,index,array)=>array.findIndex(other=>other.observedAt===item.observedAt)===index).slice(0,30),
    dna:prior.dna,
    dnaAttempts:prior.dnaAttempts,
    lastDnaAttemptAt:prior.lastDnaAttemptAt,
    lastDnaError:prior.lastDnaError,
    dnaTags:prior.dnaTags.length?prior.dnaTags:snapshot.dnaTags,
    gapSummary:prior.gapSummary
  };
}

export async function universeQueueSummary():Promise<UniverseImportQueueSummary>{
  const rows=checked(await db().from('radar_universe_queue').select('status,attempts')) as Array<Pick<UniverseQueueRow,'status'|'attempts'>>;
  return summarizeUniverseQueueRows(rows);
}

export async function processUniverseImportQueue(maxItems=25){
  const rows=checked(await db().rpc('claim_radar_universe_queue',{
    p_limit:Math.max(1,Math.min(maxItems,50))
  })) as UniverseQueueRow[];

  if(!rows.length)return {processed:0,succeeded:0,failed:0,summary:await universeQueueSummary()};

  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));

  const results=await mapLimit(rows,4,async row=>{
    try{
      const snapshot=await collectUniverseCompetitor(row.input);
      const assignment=await loadPriorityAssignment(snapshot.channelId);
      const merged=applyPriorityAssignment(mergeCompetitorSnapshot(snapshot,byChannel.get(snapshot.channelId)),assignment);
      await put('radar_managed_channels',merged.id,merged);
      byChannel.set(merged.channelId,merged);
      checked(await db().from('radar_universe_queue')
        .update({status:'completed',last_error:null,updated_at:new Date().toISOString()})
        .eq('id',row.id));
      return {ok:true as const,id:row.id,name:merged.name};
    }catch(error){
      const message=(error instanceof Error?error.message:'Falha não identificada.').slice(0,1000);
      checked(await db().from('radar_universe_queue')
        .update({
          status:'failed',
          attempts:universeImportFailureIsPermanent(message)?Math.max(row.attempts,3):row.attempts,
          last_error:message,
          updated_at:new Date().toISOString()
        })
        .eq('id',row.id));
      return {ok:false as const,id:row.id,error:message};
    }
  });

  return {
    processed:results.length,
    succeeded:results.filter(result=>result.ok).length,
    failed:results.filter(result=>!result.ok).length,
    summary:await universeQueueSummary()
  };
}

export async function importUniverseCompetitors(inputs:string[]){
  const clean=[...new Set(inputs.map(input=>input.trim()).filter(Boolean))].slice(0,25);
  const existing=await universeState();
  const byChannel=new Map(existing.map(item=>[item.channelId,item]));
  const results=await mapLimit(clean,4,async input=>{
    try{
      const snapshot=await collectUniverseCompetitor(input);
      const prior=byChannel.get(snapshot.channelId);
      const assignment=await loadPriorityAssignment(snapshot.channelId);
      const merged=applyPriorityAssignment(mergeCompetitorSnapshot(snapshot,prior),assignment);
      await put('radar_managed_channels',merged.id,merged);
      return {ok:true as const,input,name:merged.name,id:merged.id};
    }catch(error){
      return {ok:false as const,input,error:error instanceof Error?error.message:'Falha não identificada.'};
    }
  });
  const imported=results.filter(result=>result.ok).length;
  const failed=results.length-imported;
  return {
    imported,
    failed,
    total:results.length,
    failures:results.filter((result):result is Extract<(typeof results)[number],{ok:false}>=>!result.ok).slice(0,10)
  };
}

export async function refreshUniverseCompetitors(ids?:string[],maxItems=25){
  const all=await universeState();
  const wanted=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId))
    :priorityUniverseCompetitors(all)
      .filter(item=>universeCompetitorDue(item))
      .sort((a,b)=>Date.parse(a.lastMonitoredAt)-Date.parse(b.lastMonitoredAt))
      .slice(0,maxItems);
  const results=await mapLimit(wanted.slice(0,maxItems),4,async competitor=>{
    try{
      const updated=await collectUniverseCompetitor(competitor.channelId,competitor);
      await put('radar_managed_channels',updated.id,updated);
      return {ok:true as const,id:updated.id,name:updated.name};
    }catch(error){
      return {ok:false as const,id:competitor.id,name:competitor.name,error:error instanceof Error?error.message:'Falha não identificada.'};
    }
  });
  const refreshed=results.filter(result=>result.ok).length;
  return {refreshed,failed:results.length-refreshed,total:results.length};
}
export async function backfillUniverseSourceClusters(maxRefresh=25){
  const all=await universeState();
  const local=all.filter(item=>!item.sourceCluster&&!item.dna);
  for(const competitor of local){
    await put('radar_managed_channels',competitor.id,{
      ...competitor,
      sourceCluster:competitor.cluster
    });
  }

  const refreshCandidates=all
    .filter(item=>!item.sourceCluster&&!!item.dna)
    .slice(0,Math.max(1,Math.min(maxRefresh,50)));

  const results=await mapLimit(refreshCandidates,4,async competitor=>{
    try{
      const refreshed=await collectUniverseCompetitor(competitor.channelId,competitor);
      await put('radar_managed_channels',refreshed.id,refreshed);
      return {ok:true as const,id:competitor.id,name:competitor.name,sourceCluster:refreshed.sourceCluster};
    }catch(error){
      return {ok:false as const,id:competitor.id,name:competitor.name,error:error instanceof Error?error.message:'Falha não identificada.'};
    }
  });

  const after=await universeState();
  return {
    localBackfilled:local.length,
    refreshed:results.filter(result=>result.ok).length,
    failed:results.filter(result=>!result.ok).length,
    remaining:after.filter(item=>!item.sourceCluster).length,
    failures:results.filter((result):result is Extract<(typeof results)[number],{ok:false}>=>!result.ok).slice(0,10)
  };
}

export async function operatorUniverseDnaContext(ids?:string[]){
  const all=await universeState();
  const scoped=priorityUniverseCompetitors(all);
  const selected=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId)).slice(0,5)
    :selectUniverseDnaBootstrapBatch(scoped,await universeMarketIntelligenceState(),5,2);
  return {
    selected:selected.map(item=>({
      competitor:item,
      expectedLastMonitoredAt:item.lastMonitoredAt
    })),
    ready:scoped.filter(item=>!!item.dna).length,
    total:scoped.length
  };
}

export async function importOperatorUniverseDNA(input:{
  items:Array<{
    expectedLastMonitoredAt:string;
    dna:z.infer<typeof universeChannelDnaSchema>;
  }>;
}){
  const all=await universeState();
  const byChannel=new Map(all.map(item=>[item.channelId,item]));
  const now=new Date().toISOString();
  const updated:string[]=[];

  for(const item of input.items){
    const dna=universeChannelDnaSchema.parse(item.dna);
    const competitor=byChannel.get(dna.channelId);
    if(!competitor)throw new Error('Concorrente do Universe não encontrado: '+dna.channelId);
    if(competitor.lastMonitoredAt!==item.expectedLastMonitoredAt){
      throw new Error('O snapshot do concorrente '+competitor.name+' mudou. Recarregue o contexto antes de importar o DNA.');
    }
    const nextDna={
      generatedAt:now,
      summary:dna.summary,
      primaryNiche:dna.primaryNiche,
      subniche:dna.subniche,
      audienceIntent:dna.audienceIntent,
      editorialPromise:dna.editorialPromise,
      formatSignature:dna.formatSignature,
      contentPillars:dna.contentPillars,
      recurringEntities:dna.recurringEntities,
      titlePatterns:dna.titlePatterns,
      curiosityMechanisms:dna.curiosityMechanisms,
      emotionalDrivers:dna.emotionalDrivers,
      differentiationSignals:dna.differentiationSignals,
      limitations:dna.limitations,
      provenance:{
        schemaVersion:1,
        generatedBy:'chatgpt',
        model:'chatgpt-operator',
        sourceVideoCount:Math.min(20,competitor.recentUploads.length),
        sourceSignalCount:competitor.signalDetails?.length??competitor.signals.length,
        observedAt:competitor.lastMonitoredAt
      }
    };
    const dnaTags=[
      nextDna.primaryNiche,
      nextDna.subniche,
      nextDna.formatSignature,
      ...nextDna.curiosityMechanisms.slice(0,2)
    ].filter(Boolean).slice(0,5);
    await put('radar_managed_channels',competitor.id,{
      ...competitor,
      sourceCluster:competitor.sourceCluster??competitor.cluster,
      cluster:nextDna.primaryNiche||competitor.cluster,
      subniche:nextDna.subniche||competitor.subniche,
      format:nextDna.formatSignature||competitor.format,
      dna:nextDna,
      dnaAttempts:(competitor.dnaAttempts??0)+1,
      lastDnaAttemptAt:now,
      lastDnaError:undefined,
      dnaTags,
      updatedAt:now
    });
    updated.push(competitor.name);
  }

  const after=await universeState();
  const ready=after.filter(item=>!!item.dna).length;
  return {
    analyzed:updated.length,
    updated,
    total:after.length,
    ready,
    remaining:Math.max(0,after.length-ready)
  };
}

export async function runUniverseIntelligence(ids?:string[]){
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use Operator Analysis.',409);
  const all=await universeState();
  const scoped=priorityUniverseCompetitors(all);
  const selected=ids?.length
    ?all.filter(item=>ids.includes(item.id)||ids.includes(item.channelId)).slice(0,5)
    :selectUniverseDnaBootstrapBatch(scoped,await universeMarketIntelligenceState(),5,2);
  if(!selected.length){
    const ready=scoped.filter(item=>!!item.dna).length;
    return {
      analyzed:0,
      updated:[],
      total:scoped.length,
      ready,
      remaining:Math.max(0,scoped.length-ready),
      message:all.length&&ready===all.length
        ?'Channel DNA já concluído para todos os concorrentes.'
        :'Nenhum concorrente disponível para Channel DNA.'
    };
  }

  const attemptedAt=new Date().toISOString();
  let results:Awaited<ReturnType<typeof analyzeUniverseCompetitorDNA>>;
  try{
    results=await analyzeUniverseCompetitorDNA(selected);
  }catch(error){
    const detail=(error instanceof Error?error.message:'Falha não identificada na análise de Channel DNA.').slice(0,500);
    for(const competitor of selected){
      await put('radar_managed_channels',competitor.id,{
        ...competitor,
        dnaAttempts:(competitor.dnaAttempts??0)+1,
        lastDnaAttemptAt:attemptedAt,
        lastDnaError:detail,
        updatedAt:attemptedAt
      });
    }
    throw error;
  }

  const byChannel=new Map(results.map(result=>[result.channelId,result.dna]));
  const updated:string[]=[];
  for(const competitor of selected){
    const dna=byChannel.get(competitor.channelId);
    const dnaAttempts=(competitor.dnaAttempts??0)+1;
    if(!dna){
      await put('radar_managed_channels',competitor.id,{
        ...competitor,
        dnaAttempts,
        lastDnaAttemptAt:attemptedAt,
        lastDnaError:'A análise não devolveu DNA utilizável para este canal.',
        updatedAt:attemptedAt
      });
      continue;
    }
    const dnaTags=[
      dna.primaryNiche,
      dna.subniche,
      dna.formatSignature,
      ...dna.curiosityMechanisms.slice(0,2)
    ].filter(Boolean).slice(0,5);
    const next:UniverseCompetitor={
      ...competitor,
      sourceCluster:competitor.sourceCluster??competitor.cluster,
      cluster:dna.primaryNiche||competitor.cluster,
      subniche:dna.subniche||competitor.subniche,
      format:dna.formatSignature||competitor.format,
      dna:{
        ...dna,
        provenance:{
          schemaVersion:1,
          generatedBy:'platform',
          model:UNIVERSE_DNA_MODEL,
          sourceVideoCount:Math.min(20,competitor.recentUploads.length),
          sourceSignalCount:competitor.signalDetails?.length??competitor.signals.length,
          observedAt:competitor.lastMonitoredAt
        }
      },
      dnaAttempts,
      lastDnaAttemptAt:attemptedAt,
      lastDnaError:undefined,
      dnaTags,
      updatedAt:attemptedAt
    };
    await put('radar_managed_channels',next.id,next);
    updated.push(next.name);
  }
  const after=priorityUniverseCompetitors(await universeState());
  const ready=after.filter(item=>!!item.dna).length;
  const remaining=Math.max(0,after.length-ready);
  return {
    analyzed:updated.length,
    updated,
    total:after.length,
    ready,
    remaining,
    message:updated.length
      ?`Channel DNA atualizado para ${updated.length} concorrente(s): ${updated.join(', ')}. Progresso: ${ready}/${after.length}; ${remaining} pendente(s).`
      :'A análise não devolveu DNA utilizável para os concorrentes selecionados.'
  };
}

export async function runUniverseDnaBootstrap(maxCompetitors=15,timeBudgetMs=120_000){
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use Operator Analysis.',409);
  const cap=Math.max(1,Math.min(maxCompetitors,25));
  const budget=Math.max(30_000,Math.min(timeBudgetMs,180_000));
  const startedAt=Date.now();
  const attempted=new Set<string>();
  const updated:string[]=[];
  const market=await universeMarketIntelligenceState();
  let batches=0;
  let failedBatches=0;
  let attemptedChannels=0;
  let targetedAttempts=0;
  const errors:string[]=[];

  while(attemptedChannels<cap&&Date.now()-startedAt<budget){
    const all=priorityUniverseCompetitors(await universeState());
    const eligible=all.filter(item=>!attempted.has(item.id)&&!attempted.has(item.channelId));
    const targetedIds=new Set(selectUniverseGapValidationDnaBatch(eligible,market,2).map(item=>item.id));
    const selected=selectUniverseDnaBootstrapBatch(
      eligible,
      market,
      Math.min(5,cap-attemptedChannels),
      2
    );
    if(!selected.length)break;

    attemptedChannels+=selected.length;
    targetedAttempts+=selected.filter(item=>targetedIds.has(item.id)).length;
    for(const competitor of selected){
      attempted.add(competitor.id);
      attempted.add(competitor.channelId);
    }

    batches++;
    try{
      const result=await runUniverseIntelligence(selected.map(item=>item.id));
      updated.push(...result.updated);
    }catch(error){
      failedBatches++;
      errors.push((error instanceof Error?error.message:'Falha não identificada no lote de Channel DNA.').slice(0,500));
    }
  }

  const after=priorityUniverseCompetitors(await universeState());
  const ready=after.filter(item=>!!item.dna).length;
  const remaining=Math.max(0,after.length-ready);
  return {
    analyzed:updated.length,
    updated,
    batches,
    attempted:attemptedChannels,
    targetedAttempts,
    failedBatches,
    errors:errors.slice(0,3),
    total:after.length,
    ready,
    remaining,
    timeBudgetReached:remaining>0&&Date.now()-startedAt>=budget,
    message:updated.length
      ?`Channel DNA bootstrap: ${updated.length} concorrente(s) analisado(s) em ${batches} lote(s), ${failedBatches} lote(s) com falha isolada. Progresso: ${ready}/${after.length}; ${remaining} pendente(s).`
      :remaining===0
        ?'Channel DNA já concluído para todos os concorrentes.'
        :failedBatches
          ?`Channel DNA bootstrap terminou sem novos DNAs; ${failedBatches} lote(s) falharam isoladamente e serão elegíveis novamente em uma próxima execução.`
          :'Nenhum concorrente adicional produziu DNA utilizável nesta execução.'
  };
}



export async function runUniverseBootstrapCycle(){
  const bootstrap=await processUniverseImportQueue(25);
  const intelligence=await runUniverseDnaBootstrap(15,120_000);
  const evidence=await revalidateUniverseMarketEvidence();
  const queue=await universeQueueSummary();
  return {bootstrap,intelligence,evidence,queue};
}

export async function runUniverseCycle(){
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use Operator Analysis.',409);
  const {bootstrap,intelligence,evidence,queue}=await runUniverseBootstrapCycle();
  let market:UniverseMarketIntelligence|null=null;
  let marketError:string|null=null;
  if(await shouldRefreshUniverseMarketIntelligence()){
    try{
      market=await runUniverseMarketIntelligence();
    }catch(error){
      marketError=error instanceof Error?error.message:'Falha não identificada ao recalcular Market Intelligence.';
    }
  }
  return {bootstrap,intelligence,evidence,market,marketError,queue};
}

function isUniverseMarketIntelligence(value:unknown):value is UniverseMarketIntelligence{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='universe-market-intelligence';
}

export async function universeMarketIntelligenceState(){
  const analyses=await list<unknown>('radar_analyses',300);
  return analyses.find((item):item is UniverseMarketIntelligence=>isUniverseMarketIntelligence(item)&&item.id==='universe-market-intelligence:latest')??null;
}

export async function universePreviousMarketIntelligenceState(){
  const analyses=await list<unknown>('radar_analyses',300);
  return analyses.find((item):item is UniverseMarketIntelligence=>isUniverseMarketIntelligence(item)&&item.id==='universe-market-intelligence:previous')??null;
}


export async function revalidateUniverseMarketEvidence(){
  const current=await universeMarketIntelligenceState();
  if(!current)return null;
  const competitors=priorityUniverseCompetitors(await universeState());
  const report=revalidateUniverseMarketEvidenceReport(current,competitors);
  await put('radar_analyses',report.id,report);
  return report;
}

export async function universeMarketRefreshState(){
  const competitors=priorityUniverseCompetitors(await universeState());
  const dnaCount=competitors.filter(item=>!!item.dna).length;
  const current=await universeMarketIntelligenceState();
  return universeMarketRefreshDecision(dnaCount,current?.dnaCount);
}

export async function shouldRefreshUniverseMarketIntelligence(){
  return (await universeMarketRefreshState()).run;
}

export async function operatorUniverseMarketContext(){
  const all=priorityUniverseCompetitors(await universeState());
  const withDna=all.filter(item=>!!item.dna);
  const sample=selectUniverseCurveEvidence(withDna,40,8);
  if(sample.length<2)throw new Error('O Universe precisa de Channel DNA em pelo menos 2 concorrentes antes de extrair curvas.');
  return {
    snapshot:sample.map(item=>({
      channelId:item.channelId,
      expectedLastMonitoredAt:item.lastMonitoredAt,
      expectedDnaGeneratedAt:item.dna?.generatedAt??null
    })),
    competitors:sample,
    currentMarket:await universeMarketIntelligenceState()
  };
}

export async function importOperatorUniverseMarket(input:{
  snapshot:Array<{
    channelId:string;
    expectedLastMonitoredAt:string;
    expectedDnaGeneratedAt:string|null;
  }>;
  raw:z.infer<typeof universeCurvesGapsSchema>;
}):Promise<UniverseMarketIntelligence>{
  const raw=universeCurvesGapsSchema.parse(input.raw);
  const all=priorityUniverseCompetitors(await universeState());
  const withDna=all.filter(item=>!!item.dna);
  const byChannel=new Map(withDna.map(item=>[item.channelId,item]));
  const sample:UniverseCompetitor[]=[];

  for(const expected of input.snapshot){
    const current=byChannel.get(expected.channelId);
    if(!current)throw new Error('Concorrente do snapshot de mercado não encontrado: '+expected.channelId);
    if(current.lastMonitoredAt!==expected.expectedLastMonitoredAt||
       (current.dna?.generatedAt??null)!==expected.expectedDnaGeneratedAt){
      throw new Error('O snapshot de mercado mudou para '+current.name+'. Recarregue o contexto antes de importar.');
    }
    sample.push(current);
  }
  if(sample.length<2)throw new Error('O snapshot importado precisa conter pelo menos 2 concorrentes com DNA.');

  const previous=await universeMarketIntelligenceState();
  const olderPrevious=await universePreviousMarketIntelligenceState();
  const validIds=new Set(sample.map(item=>item.channelId));
  const byId=new Map(sample.map(item=>[item.channelId,item]));

  const curves=raw.curves.flatMap((candidate,index)=>{
    const support=[...new Set(candidate.supportingChannelIds.filter(id=>validIds.has(id)))];
    if(!support.length)return [];
    const classification=universeCurveClassification(support);
    const key=universeKey(candidate.key||candidate.name||'curve-'+String(index+1));
    const clusters=[...new Set(support.map(id=>byId.get(id)?.cluster).filter((value):value is string=>!!value))];
    return [{
      id:'universe-curve:'+key,
      key,
      name:candidate.name,
      thesis:candidate.thesis,
      mechanismSteps:candidate.mechanismSteps,
      supportingChannelIds:support,
      independentCreators:new Set(support).size,
      classification,
      clusters,
      evidence:candidate.evidence,
      counterEvidence:candidate.counterEvidence,
      recurringTitlePatterns:candidate.recurringTitlePatterns,
      transferableVariables:candidate.transferableVariables,
      limitations:candidate.limitations
    }];
  });

  const curveByKey=new Map(curves.map(curve=>[curve.key,curve]));
  const gaps=raw.gaps.flatMap((candidate,index)=>{
    const key=universeKey(candidate.curveKey);
    const curve=curveByKey.get(key);
    if(!curve)return [];
    const resolvedEvidence=resolveUniverseGapEvidence(
      withDna,
      candidate,
      candidate.targetEvidenceChannelIds.filter(id=>validIds.has(id))
    );
    const targetIds=resolvedEvidence.channelIds;
    const demandStatus=universeGapDemandStatus(curve.classification,targetIds);
    return [{
      id:'universe-gap:'+curve.key+':'+universeKey(candidate.targetSpace||candidate.title||String(index+1)),
      curveId:curve.id,
      title:candidate.title,
      targetSpace:candidate.targetSpace,
      targetKeywords:candidate.targetKeywords,
      preservedMechanism:candidate.preservedMechanism,
      changedVariable:candidate.changedVariable,
      demandStatus,
      targetEvidenceChannelIds:targetIds,
      demandEvidence:[...candidate.demandEvidence,...resolvedEvidence.evidence].slice(0,8),
      sampleSaturation:candidate.sampleSaturation,
      rationale:candidate.rationale,
      risks:candidate.risks,
      firstTests:candidate.firstTests
    }];
  });

  const gapEvidenceIds=[...new Set(gaps.flatMap(gap=>gap.targetEvidenceChannelIds))];
  const baseReport:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:new Date().toISOString(),
    sourceCompetitorIds:[...new Set([...sample.map(item=>item.channelId),...gapEvidenceIds])],
    dnaCount:withDna.length,
    curves,
    gaps,
    limitations:[
      ...raw.limitations,
      'Classificações de curva são recalculadas no backend por criadores independentes: 1=hypothesis, 2=emerging, 3+=structural.',
      'Saturação descreve apenas a amostra do Competitor Universe analisada; não representa todo o YouTube.',
      'Gaps sem evidência explícita no targetSpace permanecem hypothesis, mesmo quando a curva de origem é estrutural.',
      'Curvas foram importadas pelo ChatGPT operador e revalidadas deterministicamente contra o snapshot persistido.',
      'Target evidence dos gaps foi revalidada deterministicamente contra todos os '+String(withDna.length)+' canais com Channel DNA.'
    ]
  };

  const report=preserveUniverseMarketContinuity(
    baseReport,
    [previous,olderPrevious],
    all
  );
  if(previous){
    await put('radar_analyses','universe-market-intelligence:previous',{
      ...previous,
      id:'universe-market-intelligence:previous'
    });
  }
  await put('radar_analyses',report.id,report);

  for(const competitor of sample){
    const supported=curves.filter(curve=>curve.supportingChannelIds.includes(competitor.channelId));
    const strongest=supported.sort((a,b)=>{
      const rank={hypothesis:1,emerging:2,structural:3};
      return rank[b.classification]-rank[a.classification];
    })[0];
    if(!strongest)continue;
    const desired=strongest.classification==='structural'
      ?'structural-curve'
      :strongest.classification==='emerging'
        ?'emerging-curve'
        :competitor.status;
    if(UNIVERSE_STATUS_RANK[desired]>UNIVERSE_STATUS_RANK[competitor.status]){
      await put('radar_managed_channels',competitor.id,{
        ...competitor,
        status:desired,
        updatedAt:new Date().toISOString()
      });
    }
  }

  return report;
}

export async function runUniverseMarketIntelligence():Promise<UniverseMarketIntelligence>{
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use Operator Analysis.',409);
  const all=priorityUniverseCompetitors(await universeState());
  const previous=await universeMarketIntelligenceState();
  const olderPrevious=await universePreviousMarketIntelligenceState();
  const withDna=all.filter(item=>!!item.dna);
  const sample=selectUniverseCurveEvidence(withDna,40,8);
  if(sample.length<2)throw new Error('O Universe precisa de Channel DNA em pelo menos 2 concorrentes antes de extrair curvas.');

  const raw=await analyzeUniverseCurvesAndGaps(sample);
  const validIds=new Set(sample.map(item=>item.channelId));
  const byId=new Map(sample.map(item=>[item.channelId,item]));

  const curves=raw.curves.flatMap((candidate,index)=>{
    const support=[...new Set(candidate.supportingChannelIds.filter(id=>validIds.has(id)))];
    if(!support.length)return [];
    const classification=universeCurveClassification(support);
    const key=universeKey(candidate.key||candidate.name||`curve-${index+1}`);
    const clusters=[...new Set(support.map(id=>byId.get(id)?.cluster).filter((value):value is string=>!!value))];
    return [{
      id:`universe-curve:${key}`,
      key,
      name:candidate.name,
      thesis:candidate.thesis,
      mechanismSteps:candidate.mechanismSteps,
      supportingChannelIds:support,
      independentCreators:new Set(support).size,
      classification,
      clusters,
      evidence:candidate.evidence,
      counterEvidence:candidate.counterEvidence,
      recurringTitlePatterns:candidate.recurringTitlePatterns,
      transferableVariables:candidate.transferableVariables,
      limitations:candidate.limitations
    }];
  });

  const curveByKey=new Map(curves.map(curve=>[curve.key,curve]));
  const gaps=raw.gaps.flatMap((candidate,index)=>{
    const key=universeKey(candidate.curveKey);
    const curve=curveByKey.get(key);
    if(!curve)return [];
    const resolvedEvidence=resolveUniverseGapEvidence(
      withDna,
      candidate,
      candidate.targetEvidenceChannelIds.filter(id=>validIds.has(id))
    );
    const targetIds=resolvedEvidence.channelIds;
    const demandStatus=universeGapDemandStatus(curve.classification,targetIds);
    return [{
      id:`universe-gap:${curve.key}:${universeKey(candidate.targetSpace||candidate.title||String(index+1))}`,
      curveId:curve.id,
      title:candidate.title,
      targetSpace:candidate.targetSpace,
      targetKeywords:candidate.targetKeywords,
      preservedMechanism:candidate.preservedMechanism,
      changedVariable:candidate.changedVariable,
      demandStatus,
      targetEvidenceChannelIds:targetIds,
      demandEvidence:[...candidate.demandEvidence,...resolvedEvidence.evidence].slice(0,8),
      sampleSaturation:candidate.sampleSaturation,
      rationale:candidate.rationale,
      risks:candidate.risks,
      firstTests:candidate.firstTests
    }];
  });

  const gapEvidenceIds=[...new Set(gaps.flatMap(gap=>gap.targetEvidenceChannelIds))];
  const baseReport:UniverseMarketIntelligence={
    kind:'universe-market-intelligence',
    id:'universe-market-intelligence:latest',
    generatedAt:new Date().toISOString(),
    sourceCompetitorIds:[...new Set([...sample.map(item=>item.channelId),...gapEvidenceIds])],
    dnaCount:withDna.length,
    curves,
    gaps,
    limitations:[
      ...raw.limitations,
      'Classificações de curva são recalculadas no backend por criadores independentes: 1=hypothesis, 2=emerging, 3+=structural.',
      'Saturação descreve apenas a amostra do Competitor Universe analisada; não representa todo o YouTube.',
      'Gaps sem evidência explícita no targetSpace permanecem hypothesis, mesmo quando a curva de origem é estrutural.',
      `Curvas foram extraídas de uma amostra balanceada de ${sample.length} canais; target evidence dos gaps foi revalidada deterministicamente contra todos os ${withDna.length} canais com Channel DNA.`
    ]
  };

  const report=preserveUniverseMarketContinuity(
    baseReport,
    [previous,olderPrevious],
    all
  );

  if(previous){
    await put('radar_analyses','universe-market-intelligence:previous',{
      ...previous,
      id:'universe-market-intelligence:previous'
    });
  }
  await put('radar_analyses',report.id,report);

  for(const competitor of sample){
    const supported=curves.filter(curve=>curve.supportingChannelIds.includes(competitor.channelId));
    const strongest=supported.sort((a,b)=>{
      const rank={hypothesis:1,emerging:2,structural:3};
      return rank[b.classification]-rank[a.classification];
    })[0];
    if(!strongest)continue;
    const desired=strongest.classification==='structural'?'structural-curve':strongest.classification==='emerging'?'emerging-curve':competitor.status;
    if(UNIVERSE_STATUS_RANK[desired]>UNIVERSE_STATUS_RANK[competitor.status]){
      await put('radar_managed_channels',competitor.id,{...competitor,status:desired,updatedAt:new Date().toISOString()});
    }
  }

  return report;
}

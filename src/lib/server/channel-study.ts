import 'server-only';

import type { ChannelNicheProfile, ChannelStudy, ChannelStudyAnatomy, ChannelStudyThumbnailAnalysis, SimilarChannelMatch } from '@/lib/types';
import { list, put, settings } from './db';
import { HttpError } from './auth';
import { analyzeChannelStudyEvidence, analyzeChannelThumbnails, reviewSimilarChannelCandidates } from './ai';
import { collectChannelStudyEvidence, findNicheLockedSimilarCandidates } from './youtube';

type OperatorChannelStudyContext={
  kind:'channel-study-operator-context';
  id:string;
  input:string;
  sourceId:string;
  evidence:Awaited<ReturnType<typeof collectChannelStudyEvidence>>;
  createdAt:string;
};

function isOperatorContext(value:unknown):value is OperatorChannelStudyContext{
  return !!value&&typeof value==='object'&&(value as {kind?:string}).kind==='channel-study-operator-context';
}

export async function operatorChannelStudyContext(input:string){
  const evidence=await collectChannelStudyEvidence(input);
  const context:OperatorChannelStudyContext={
    kind:'channel-study-operator-context',
    id:'channel-study-operator-context:'+evidence.source.id,
    input,
    sourceId:evidence.source.id,
    evidence,
    createdAt:new Date().toISOString()
  };
  await put('radar_analyses',context.id,context);
  return context;
}

export async function importOperatorChannelStudy(input:{
  contextId:string;
  expectedCreatedAt:string;
  nicheProfile:ChannelNicheProfile;
  anatomy:ChannelStudyAnatomy;
  thumbnailAnalysis:ChannelStudyThumbnailAnalysis;
}):Promise<ChannelStudy>{
  const analyses=await list<unknown>('radar_analyses',500);
  const context=analyses.find((item):item is OperatorChannelStudyContext=>
    isOperatorContext(item)&&item.id===input.contextId
  );
  if(!context)throw new HttpError('Contexto de Channel Study não encontrado. Recolete a evidência.',404);
  if(context.createdAt!==input.expectedCreatedAt){
    throw new HttpError('A evidência do Channel Study mudou. Recarregue o contexto antes de importar.',409);
  }
  const evidence=context.evidence;
  const limitation='Canais similares não foram inferidos por provider AI. Use Universe/NexLev e revisão do operador para enriquecer a validação estrutural.';
  const study:ChannelStudy={
    kind:'channel-study',
    id:'channel-study:'+evidence.source.id,
    input:context.input,
    source:evidence.source,
    topSampleScope:evidence.topSampleScope,
    scannedVideos:evidence.scannedVideos,
    totalPublicVideos:evidence.totalPublicVideos,
    scanTruncated:evidence.scanTruncated,
    topVideos:evidence.topVideos,
    thumbnailAnalysis:input.thumbnailAnalysis,
    weakRecentVideos:evidence.weakRecentVideos,
    sequences:evidence.sequences,
    comparisonSampleSize:evidence.comparisonSampleSize,
    commentSampleSize:evidence.commentSampleSize,
    commentsAvailableVideos:evidence.commentsAvailableVideos,
    nicheProfile:input.nicheProfile,
    anatomy:{
      ...input.anatomy,
      limitations:[...input.anatomy.limitations,limitation]
    },
    similarCandidates:[],
    metrics:evidence.metrics,
    createdAt:new Date().toISOString()
  };
  await put('radar_analyses',study.id,study);
  return study;
}

export async function runChannelStudy(input:string):Promise<ChannelStudy>{
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use a importação do ChatGPT.',409);
  // Core path: public YouTube evidence + textual anatomy. If either fails, surface the
  // real error to the operator instead of saving a misleading partial study.
  const evidence=await collectChannelStudyEvidence(input);
  const [{nicheProfile,anatomy},thumbnailAnalysis]=await Promise.all([
    analyzeChannelStudyEvidence(evidence),
    analyzeChannelThumbnails(evidence.topVideos,evidence.weakRecentVideos)
  ]);

  // Supplementary path: similar-channel discovery is valuable, but it must not erase
  // an otherwise valid channel anatomy when quota/model/network issues affect this stage.
  let similarCandidates:SimilarChannelMatch[]=[];
  const supplementaryLimitations:string[]=[];
  if(evidence.topSampleScope==='recent-uploads')supplementaryLimitations.push('A busca global do YouTube estava indisponível. O Top sample foi calculado a partir de até 100 uploads públicos recentes do canal, ordenados por views; não representa necessariamente os maiores vídeos históricos do canal.');
  try{
    const config=await settings();
    const candidates=await findNicheLockedSimilarCandidates(nicheProfile,config,evidence.source.id);
    const reviewed=await reviewSimilarChannelCandidates(nicheProfile,candidates);
    const byId=new Map(candidates.map(channel=>[channel.id,channel]));
    similarCandidates=reviewed.flatMap(review=>{
      const channel=byId.get(review.channelId);
      return channel?[{
        channel:{...channel,niche:nicheProfile.primaryNiche},
        similarityScore:review.score,
        similarityReason:review.reason,
        matchedTerms:review.matchedTerms
      }]:[];
    }).slice(0,12);
  }catch{
    supplementaryLimitations.push('A busca/revisão de pequenos canais similares não foi concluída nesta execução. A anatomia do canal de origem permanece válida e pode ser atualizada depois.');
  }

  const study:ChannelStudy={
    kind:'channel-study',
    id:`channel-study:${evidence.source.id}`,
    input,
    source:evidence.source,
    topSampleScope:evidence.topSampleScope,
    scannedVideos:evidence.scannedVideos,
    totalPublicVideos:evidence.totalPublicVideos,
    scanTruncated:evidence.scanTruncated,
    topVideos:evidence.topVideos,
    thumbnailAnalysis,
    weakRecentVideos:evidence.weakRecentVideos,
    sequences:evidence.sequences,
    comparisonSampleSize:evidence.comparisonSampleSize,
    commentSampleSize:evidence.commentSampleSize,
    commentsAvailableVideos:evidence.commentsAvailableVideos,
    nicheProfile,
    anatomy:supplementaryLimitations.length?{...anatomy,limitations:[...anatomy.limitations,...supplementaryLimitations]}:anatomy,
    similarCandidates,
    metrics:evidence.metrics,
    createdAt:new Date().toISOString()
  };
  await put('radar_analyses',study.id,study);
  return study;
}

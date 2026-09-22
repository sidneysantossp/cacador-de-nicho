import 'server-only';

import type { ChannelStudy } from '@/lib/types';
import { put, settings } from './db';
import { analyzeChannelStudyEvidence, analyzeChannelThumbnails, reviewSimilarChannelCandidates } from './ai';
import { collectChannelStudyEvidence, findNicheLockedSimilarCandidates } from './youtube';

export async function runChannelStudy(input:string):Promise<ChannelStudy>{
  const evidence=await collectChannelStudyEvidence(input);
  const [{nicheProfile,anatomy},thumbnailAnalysis]=await Promise.all([analyzeChannelStudyEvidence(evidence),analyzeChannelThumbnails(evidence.topVideos,evidence.weakRecentVideos)]);
  const config=await settings();
  const candidates=await findNicheLockedSimilarCandidates(nicheProfile,config,evidence.source.id);
  const reviewed=await reviewSimilarChannelCandidates(nicheProfile,candidates);
  const byId=new Map(candidates.map(channel=>[channel.id,channel]));
  const similarCandidates=reviewed.flatMap(review=>{
    const channel=byId.get(review.channelId);
    return channel?[{
      channel:{...channel,niche:nicheProfile.primaryNiche},
      similarityScore:review.score,
      similarityReason:review.reason,
      matchedTerms:review.matchedTerms
    }]:[];
  }).slice(0,12);

  const study:ChannelStudy={
    kind:'channel-study',
    id:`channel-study:${evidence.source.id}`,
    input,
    source:evidence.source,
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
    anatomy,
    similarCandidates,
    metrics:evidence.metrics,
    createdAt:new Date().toISOString()
  };
  await put('radar_analyses',study.id,study);
  return study;
}

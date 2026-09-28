import 'server-only';

import type { ChannelStudy, OpportunityReport } from '@/lib/types';
import { z } from 'zod';
import { HttpError } from './auth';
import { generateOpportunityReport, opportunityReportBodySchema } from './ai';
import { list, put } from './db';

function isChannelStudy(value: unknown): value is ChannelStudy {
  return !!value && typeof value === 'object' && (value as { kind?: string }).kind === 'channel-study';
}

async function loadStudy(channelStudyId:string){
  const analyses=await list<unknown>('radar_analyses',500);
  const study=analyses.find((item):item is ChannelStudy=>isChannelStudy(item)&&item.id===channelStudyId);
  if(!study)throw new HttpError('Análise de canal não encontrada. Execute a Análise de Canal antes de gerar a oportunidade.',404);
  return {study,analyses};
}

export async function operatorOpportunityContext(channelStudyId:string){
  const {study,analyses}=await loadStudy(channelStudyId);
  const reportId='opportunity-report:'+study.source.id;
  const current=analyses.find((item):item is OpportunityReport=>
    !!item&&typeof item==='object'&&(item as {kind?:string;id?:string}).kind==='opportunity-report'&&
    (item as {id?:string}).id===reportId
  )??null;
  return {
    channelStudyId:study.id,
    sourceChannelId:study.source.id,
    study,
    currentReport:current
  };
}

export async function importOperatorOpportunityReport(
  channelStudyId:string,
  body:z.infer<typeof opportunityReportBodySchema>
){
  const {study}=await loadStudy(channelStudyId);
  const parsed=opportunityReportBodySchema.parse(body);
  const similar=study.similarCandidates.map(match=>({
    id:match.channel.id,
    name:match.channel.name,
    similarityScore:match.similarityScore,
    videoViews:match.channel.video.views,
    url:match.channel.url
  }));
  const independentCreators=1+new Set(similar.map(item=>item.id)).size;
  const supportingVideos=study.topVideos.length+similar.length;
  const classification=independentCreators>=3?'structural':independentCreators>=2?'emerging':'hypothesis';

  const report:OpportunityReport={
    kind:'opportunity-report',
    id:'opportunity-report:'+study.source.id,
    channelStudyId:study.id,
    sourceChannelId:study.source.id,
    ...parsed,
    validation:{
      ...parsed.validation,
      classification,
      independentCreators,
      supportingVideos
    },
    evidence:{
      topVideos:study.topVideos.slice(0,10).map(video=>({
        id:video.id,title:video.title,views:video.views,url:video.url
      })),
      similarChannels:similar
    },
    transfers:parsed.transfers.map((transfer,index)=>({
      ...transfer,
      id:study.source.id+'-transfer-'+String(index+1)
    })),
    createdAt:new Date().toISOString()
  };
  const saved={...report,approval:{status:'pending' as const}};
  await put('radar_analyses',report.id,saved);
  return saved;
}

export async function runOpportunityReport(channelStudyId: string) {
  if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: provider AI desabilitado; use a importação do ChatGPT.',409);
  const analyses = await list<unknown>('radar_analyses', 200);
  const study = analyses.find((item): item is ChannelStudy => isChannelStudy(item) && item.id === channelStudyId);

  if (!study) {
    throw new HttpError('Análise de canal não encontrada. Execute a Análise de Canal antes de gerar a oportunidade.', 404);
  }

  const report = await generateOpportunityReport(study);
  await put('radar_analyses', report.id, {
    ...report,
    approval: {
      status: 'pending'
    }
  });

  return {
    ...report,
    approval: {
      status: 'pending'
    }
  };
}

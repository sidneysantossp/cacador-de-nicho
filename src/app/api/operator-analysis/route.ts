import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  channelNicheProfileSchema, channelStudyAnatomySchema, channelThumbnailAnalysisSchema,
  opportunityReportBodySchema, universeChannelDnaSchema, universeCurvesGapsSchema
} from '@/lib/server/ai';
import {
  importOperatorChannelStudy, operatorChannelStudyContext
} from '@/lib/server/channel-study';
import {
  importOperatorOpportunityReport, operatorOpportunityContext
} from '@/lib/server/opportunity-report';
import {
  importOperatorUniverseDNA, importOperatorUniverseMarket,
  operatorUniverseDnaContext, operatorUniverseMarketContext
} from '@/lib/server/universe';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const postSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('import-channel-study'),
    contextId:z.string().trim().min(1).max(220),
    expectedCreatedAt:z.string().datetime(),
    nicheProfile:channelNicheProfileSchema,
    anatomy:channelStudyAnatomySchema,
    thumbnailAnalysis:channelThumbnailAnalysisSchema
  }).strict(),
  z.object({
    action:z.literal('import-opportunity-report'),
    channelStudyId:z.string().trim().min(1).max(220),
    report:opportunityReportBodySchema
  }).strict(),
  z.object({
    action:z.literal('import-universe-dna'),
    items:z.array(z.object({
      expectedLastMonitoredAt:z.string().datetime(),
      dna:universeChannelDnaSchema
    }).strict()).min(1).max(5)
  }).strict(),
  z.object({
    action:z.literal('import-universe-market'),
    snapshot:z.array(z.object({
      channelId:z.string().trim().min(1).max(180),
      expectedLastMonitoredAt:z.string().datetime(),
      expectedDnaGeneratedAt:z.string().trim().min(1).max(80).nullable()
    }).strict()).min(2).max(40),
    raw:universeCurvesGapsSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Operator Analysis.',503);
    const url=new URL(request.url);
    const kind=url.searchParams.get('kind')?.trim();

    if(kind==='channel-study'){
      const input=url.searchParams.get('input')?.trim();
      if(!input||input.length>500)throw new HttpError('Informe um canal válido para coletar a evidência.',400);
      return Response.json(await operatorChannelStudyContext(input),{headers:{'Cache-Control':'no-store'}});
    }
    if(kind==='opportunity-report'){
      const channelStudyId=url.searchParams.get('channelStudyId')?.trim();
      if(!channelStudyId)throw new HttpError('Informe o Channel Study.',400);
      return Response.json(await operatorOpportunityContext(channelStudyId),{headers:{'Cache-Control':'no-store'}});
    }
    if(kind==='universe-dna'){
      const ids=(url.searchParams.get('ids')??'').split(',').map(item=>item.trim()).filter(Boolean).slice(0,5);
      return Response.json(await operatorUniverseDnaContext(ids.length?ids:undefined),{headers:{'Cache-Control':'no-store'}});
    }
    if(kind==='universe-market'){
      return Response.json(await operatorUniverseMarketContext(),{headers:{'Cache-Control':'no-store'}});
    }
    throw new HttpError('Tipo de Operator Analysis inválido.',400);
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Operator Analysis.',503);
    if(Number(request.headers.get('content-length')??0)>500000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise o payload do Operator Analysis.',400);
    const body=parsed.data;

    if(body.action==='import-channel-study'){
      const study=await importOperatorChannelStudy(body);
      return Response.json({
        message:'Channel Study do ChatGPT operador validado contra evidência coletada e salvo.',
        study
      });
    }
    if(body.action==='import-opportunity-report'){
      const report=await importOperatorOpportunityReport(body.channelStudyId,body.report);
      return Response.json({
        message:'Opportunity Report do ChatGPT operador validado e salvo com classificação estrutural recalculada no backend.',
        report
      });
    }
    if(body.action==='import-universe-dna'){
      const result=await importOperatorUniverseDNA(body);
      return Response.json({
        message:'Channel DNA do ChatGPT operador validado contra snapshots atuais do Universe.',
        result
      });
    }

    const report=await importOperatorUniverseMarket(body);
    return Response.json({
      message:'Universe Market Intelligence do ChatGPT operador revalidada e persistida.',
      report
    });
  }catch(error){return errorResponse(error);}
}

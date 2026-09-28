import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  approveAudienceIntelligence, audienceIntelligenceChannelState, audienceOperatorContext,
  createAudienceIntelligence, importOperatorAudienceIntelligence, loadAudienceIntelligenceHistory,
  loadAudienceIntelligenceReport
} from '@/lib/server/audience-intelligence';
import {
  applyAudienceReportToBrain, audienceLearningLoopChannelState
} from '@/lib/server/audience-learning-loop';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const intentSchema=z.enum([
  'praise','question','confusion','request','objection','follow-up','topic','debate'
]);
const sentimentSchema=z.enum(['positive','neutral','negative','mixed']);
const operatorModelSchema=z.object({
  classifications:z.array(z.object({
    commentRef:z.string().regex(/^c\d+$/),
    sentiment:sentimentSchema,
    intents:z.array(intentSchema).max(4)
  }).strict()).min(1).max(80),
  themes:z.array(z.object({
    kind:intentSchema,
    label:z.string().trim().min(1).max(180),
    insight:z.string().trim().min(1).max(2000),
    commentRefs:z.array(z.string().regex(/^c\d+$/)).min(1).max(30),
    nextAction:z.string().trim().min(1).max(2000)
  }).strict()).max(16)
}).strict();

const actionSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('generate'),
    performanceReportId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('import-operator-analysis'),
    performanceReportId:z.string().uuid(),
    expectedPerformanceReportVersion:z.number().int().min(1).max(100000),
    expectedObservationId:z.string().uuid(),
    model:operatorModelSchema
  }).strict(),
  z.object({
    action:z.literal('approve'),
    reportId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    notes:z.string().max(5000).default('')
  }).strict(),
  z.object({
    action:z.literal('apply-learning-loop'),
    reportId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Audience Intelligence.',503);
    const url=new URL(request.url);
    const reportId=url.searchParams.get('reportId')?.trim();
    const performanceReportId=url.searchParams.get('performanceReportId')?.trim();

    if(reportId){
      if(!z.string().uuid().safeParse(reportId).success)throw new HttpError('Audience Report inválido.',400);
      const report=await loadAudienceIntelligenceReport(reportId);
      if(!report)throw new HttpError('Audience Report não encontrado.',404);
      return Response.json({
        report,
        history:await loadAudienceIntelligenceHistory(reportId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    if(performanceReportId&&url.searchParams.get('context')==='operator'){
      if(!z.string().uuid().safeParse(performanceReportId).success)throw new HttpError('Performance Report inválido.',400);
      return Response.json(await audienceOperatorContext(performanceReportId),{headers:{'Cache-Control':'no-store'}});
    }

    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [state,learningLoop]=await Promise.all([
      audienceIntelligenceChannelState(channelId),
      audienceLearningLoopChannelState(channelId)
    ]);
    return Response.json({...state,learningLoop},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Audience Intelligence.',503);
    if(Number(request.headers.get('content-length')??0)>50000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados da Audience Intelligence.',400);
    const body=parsed.data;

    if(body.action==='generate'){
      const result=await createAudienceIntelligence(body.performanceReportId);
      return Response.json({
        message:result.created
          ?'Audience Intelligence gerada a partir da amostra real de comentários.'
          :'Este Performance Report já possui Audience Intelligence.',
        ...result
      });
    }

    if(body.action==='import-operator-analysis'){
      const result=await importOperatorAudienceIntelligence(body);
      return Response.json({
        message:result.created
          ?'Audience Intelligence criada pelo ChatGPT operador e validada contra a amostra real.'
          :'Este Performance Report já possui Audience Intelligence.',
        ...result
      });
    }

    if(body.action==='apply-learning-loop'){
      const learningLoop=await applyAudienceReportToBrain(body.reportId);
      return Response.json({
        message:learningLoop.nothingToApply
          ?'Nenhum tema possui confiança suficiente para entrar no Channel Brain.'
          :learningLoop.alreadyApplied
            ?'Este Audience Report já estava incorporado ao Channel Brain.'
            :learningLoop.applied+' learning(s) de audiência incorporado(s) ao Channel Brain.',
        learningLoop
      });
    }

    const report=await approveAudienceIntelligence({
      reportId:body.reportId,
      expectedVersion:body.expectedVersion,
      notes:body.notes
    });
    const learningLoop=await applyAudienceReportToBrain(report.id);
    return Response.json({
      message:learningLoop.nothingToApply
        ?'Audience Report aprovado; nenhum tema atingiu confiança suficiente para virar learning.'
        :'Audience Report aprovado e '+learningLoop.applied+' learning(s) de audiência incorporado(s) ao Channel Brain.',
      report,
      learningLoop
    });
  }catch(error){return errorResponse(error);}
}

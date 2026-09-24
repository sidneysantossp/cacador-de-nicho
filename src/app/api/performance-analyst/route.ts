import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  performanceObservationPayloadSchema
} from '@/lib/server/validation';
import {
  approvePerformanceReport, collectYouTubePerformance,
  createManualPerformanceObservation, loadPerformanceReport,
  loadPerformanceReportHistory, performanceAnalystChannelState
} from '@/lib/server/performance-analyst';
import {
  applyPerformanceReportToBrain, learningLoopChannelState
} from '@/lib/server/learning-loop';
import {
  closedLoopChannelState, resumeLearningLoopJob, scheduleClosedLoopJobs
} from '@/lib/server/closed-loop-intelligence';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const actionSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('collect-youtube'),
    jobId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('manual'),
    observation:performanceObservationPayloadSchema
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
  }).strict(),
  z.object({
    action:z.literal('schedule-closed-loop'),
    channelId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('resume-closed-loop'),
    jobId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Performance Analyst.',503);
    const url=new URL(request.url);
    const reportId=url.searchParams.get('reportId')?.trim();
    if(reportId){
      if(!z.string().uuid().safeParse(reportId).success)throw new HttpError('Performance Report inválido.',400);
      const report=await loadPerformanceReport(reportId);
      if(!report)throw new HttpError('Performance Report não encontrado.',404);
      return Response.json({
        report,
        history:await loadPerformanceReportHistory(reportId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [state,learningLoop,closedLoop]=await Promise.all([
      performanceAnalystChannelState(channelId),
      learningLoopChannelState(channelId),
      closedLoopChannelState(channelId)
    ]);
    return Response.json({...state,learningLoop,closedLoop},{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Performance Analyst.',503);
    if(Number(request.headers.get('content-length')??0)>100000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do Performance Analyst.',400);
    const body=parsed.data;

    if(body.action==='collect-youtube'){
      const result=await collectYouTubePerformance(body.jobId);
      return Response.json({
        message:'YouTube Analytics coletado e Performance Report gerado.',
        ...result
      });
    }
    if(body.action==='manual'){
      const result=await createManualPerformanceObservation(body.observation);
      return Response.json({
        message:'Observação manual salva e Performance Report gerado.',
        ...result
      });
    }
    if(body.action==='apply-learning-loop'){
      const learningLoop=await applyPerformanceReportToBrain(body.reportId);
      return Response.json({
        message:learningLoop.alreadyApplied
          ?'Este Performance Report já estava incorporado ao Channel Brain.'
          :learningLoop.applied+' learning(s) de performance incorporado(s) ao Channel Brain.',
        learningLoop
      });
    }

    if(body.action==='schedule-closed-loop'){
      const scheduled=await scheduleClosedLoopJobs(body.channelId);
      return Response.json({
        message:scheduled.created
          ?scheduled.created+' janela(s) do Closed Loop agendada(s).'
          :'Nenhuma nova janela precisava ser criada.',
        scheduled,
        closedLoop:await closedLoopChannelState(body.channelId)
      });
    }

    if(body.action==='resume-closed-loop'){
      const job=await resumeLearningLoopJob(body.jobId);
      return Response.json({
        message:'Closed Loop job liberado para nova tentativa.',
        job
      });
    }

    const report=await approvePerformanceReport({
      reportId:body.reportId,
      expectedVersion:body.expectedVersion,
      notes:body.notes
    });
    const learningLoop=await applyPerformanceReportToBrain(report.id);
    return Response.json({
      message:learningLoop.alreadyApplied
        ?'Performance Report aprovado; o Learning Loop já estava aplicado.'
        :'Performance Report aprovado e '+learningLoop.applied+' learning(s) incorporado(s) ao Channel Brain.',
      report,
      learningLoop
    });
  }catch(error){return errorResponse(error);}
}

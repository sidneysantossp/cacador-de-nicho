import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  approveProductionQuality, loadProductionQualityHistory,
  loadProductionQualityReport, productionQualityChannelState, runProductionQuality
} from '@/lib/server/production-quality';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const checkCode=z.enum([
  'render-completed',
  'decode-integrity',
  'duration-match',
  'resolution-match',
  'aspect-ratio-match',
  'fps-match',
  'audio-stream',
  'audio-silence',
  'audio-clipping',
  'caption-timing',
  'visual-coverage',
  'asset-duplication',
  'asset-provenance',
  'character-continuity',
  'prompt-asset-alignment',
  'text-placeholders',
  'spelling-review',
  'black-frames'
]);

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('run'),
    renderJobId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('approve'),
    reportId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    notes:z.string().max(5000),
    overrides:z.array(checkCode).max(30)
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Production QA.',503);
    const url=new URL(request.url);
    const reportId=url.searchParams.get('reportId')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();

    if(reportId){
      if(!z.string().uuid().safeParse(reportId).success)throw new HttpError('Production QA inválido.',400);
      const report=await loadProductionQualityReport(reportId);
      if(!report)throw new HttpError('Production QA não encontrado.',404);
      return Response.json({
        report,
        history:await loadProductionQualityHistory(reportId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json(await productionQualityChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Production QA.',503);
    if(Number(request.headers.get('content-length')??0)>30000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Production QA.',400);

    if(parsed.data.action==='run'){
      const report=await runProductionQuality(parsed.data.renderJobId);
      return Response.json({
        message:report.status==='blocked'
          ?'Production QA concluído com blockers.'
          :'Production QA concluído. Revise os itens manuais antes da liberação.',
        report
      });
    }

    const report=await approveProductionQuality(parsed.data);
    return Response.json({
      message:'Release gate aprovado. O render está liberado para a próxima etapa.',
      report
    });
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { calibrateResearchClaimsCapability } from '@/lib/server/content-research-ai';
import { loadProductionAutonomy } from '@/lib/server/production-autonomy';
import type { ProductionAutonomySubject } from '@/lib/production-autonomy-contract';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const subjectSchema=z.object({
  subjectType:z.enum(['universe-gap','opportunity-report','next-episode']),
  subjectId:z.string().min(1).max(200),
  candidateId:z.string().min(1).max(200).optional()
}).strict();

function parse(value:unknown):ProductionAutonomySubject{
  const result=subjectSchema.safeParse(value);
  if(!result.success)throw new HttpError('Alvo de calibração inválido.',400);
  return result.data;
}
export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase antes da calibração.',503);
    const subject=parse(await request.json());
    const assessment=await loadProductionAutonomy(subject);
    if(!assessment||!assessment.marketEligible){
      throw new HttpError('Execute primeiro um Production Autonomy assessment market-valid.',409);
    }
    const workingTitle=assessment.input.titles[0]?.title?.trim();
    if(!workingTitle)throw new HttpError('Assessment sem título utilizável para calibração.',409);
    const evidence=await calibrateResearchClaimsCapability({subject,workingTitle});
    return Response.json({
      message:'Research + Claim Ledger calibrados com evidência web.',
      evidence
    },{status:201,headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return errorResponse(error);
  }
}

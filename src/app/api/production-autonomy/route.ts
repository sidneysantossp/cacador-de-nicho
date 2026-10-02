import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { evaluateProductionAutonomyForSubject, productionAutonomyForApi } from '@/lib/server/production-autonomy';
import type { ProductionAutonomySubject } from '@/lib/production-autonomy-contract';

export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=300;
const subject=z.object({subjectType:z.enum(['universe-gap','opportunity-report','next-episode']),subjectId:z.string().min(1).max(200),candidateId:z.string().min(1).max(200).optional()}).strict();
function parse(value:unknown):ProductionAutonomySubject{const result=subject.safeParse(value);if(!result.success)throw new HttpError('Alvo de Production Autonomy Fit inválido.',400);return result.data;}
export async function GET(request:Request){try{if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);if(!dbConfigured())throw new HttpError('Configure o Supabase para avaliar Production Autonomy Fit.',503);const url=new URL(request.url);return Response.json(await productionAutonomyForApi(parse({subjectType:url.searchParams.get('subjectType'),subjectId:url.searchParams.get('subjectId'),candidateId:url.searchParams.get('candidateId')||undefined})),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{requireOperator(request);if(!dbConfigured())throw new HttpError('Configure o Supabase para avaliar Production Autonomy Fit.',503);const target=parse(await request.json());const assessment=await evaluateProductionAutonomyForSubject(target);return Response.json({assessment,summary:{status:assessment.status,score:assessment.score,reasons:assessment.reasons.map(item=>item.message)}},{status:201,headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

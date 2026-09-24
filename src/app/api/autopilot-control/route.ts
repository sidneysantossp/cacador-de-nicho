import { z } from 'zod';
import {
  authenticated, errorResponse, HttpError, requireOperator
} from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  autopilotControlState, loadAutopilotControl, saveAutopilotControl
} from '@/lib/server/autopilot-control';
import { resolveAutopilotIncident } from '@/lib/server/autopilot-incidents';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const actionSchema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('pause'),
    expectedVersion:z.number().int().min(1),
    reason:z.string().trim().min(3).max(1000)
  }).strict(),
  z.object({
    action:z.literal('resume'),
    expectedVersion:z.number().int().min(1)
  }).strict(),
  z.object({
    action:z.literal('limits'),
    expectedVersion:z.number().int().min(1),
    maxConcurrentAutomationRuns:z.number().int().min(1).max(10),
    maxConcurrentLearningJobs:z.number().int().min(1).max(10)
  }).strict(),
  z.object({
    action:z.literal('incident'),
    incidentId:z.string().uuid(),
    disposition:z.enum(['resolved','ignored'])
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request)){
      throw new HttpError('Entre com a senha da operação para continuar.',401);
    }
    if(!dbConfigured()){
      throw new HttpError('Configure o Supabase para usar Autopilot Control Plane.',503);
    }
    return Response.json(await autopilotControlState(),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured()){
      throw new HttpError('Configure o Supabase para usar Autopilot Control Plane.',503);
    }
    if(Number(request.headers.get('content-length')??0)>10000){
      throw new HttpError('Solicitação muito extensa.',413);
    }
    const parsed=actionSchema.safeParse(await request.json());
    if(!parsed.success){
      throw new HttpError('Revise os campos do Autopilot Control Plane.',400);
    }
    const body=parsed.data;

    if(body.action==='incident'){
      const incident=await resolveAutopilotIncident({
        incidentId:body.incidentId,
        status:body.disposition
      });
      return Response.json({
        message:body.disposition==='resolved'
          ?'Incidente marcado como resolvido.'
          :'Incidente ignorado pelo operador.',
        incident,
        state:await autopilotControlState()
      });
    }

    const current=await loadAutopilotControl();

    const control=await saveAutopilotControl({
      expectedVersion:body.expectedVersion,
      status:body.action==='pause'
        ?'paused'
        :body.action==='resume'
          ?'running'
          :current.status,
      pauseReason:body.action==='pause'
        ?body.reason
        :body.action==='resume'
          ?''
          :current.pauseReason,
      maxConcurrentAutomationRuns:body.action==='limits'
        ?body.maxConcurrentAutomationRuns
        :current.maxConcurrentAutomationRuns,
      maxConcurrentLearningJobs:body.action==='limits'
        ?body.maxConcurrentLearningJobs
        :current.maxConcurrentLearningJobs
    });

    return Response.json({
      message:body.action==='pause'
        ?'Autopilot global pausado.'
        :body.action==='resume'
          ?'Autopilot global retomado.'
          :'Limites do Autopilot atualizados.',
      control,
      state:await autopilotControlState()
    });
  }catch(error){return errorResponse(error);}
}

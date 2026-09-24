import 'server-only';

import type {
  AutopilotControl, AutopilotControlPayload, AutopilotControlStatus,
  AutopilotControlVersion
} from '@/lib/types';
import {
  normalizeAutopilotControlPayload
} from '@/lib/autopilot-control-policy';
import { checked, db } from './db';
import { HttpError } from './auth';

type ControlRow={
  id:string;
  version:number;
  status:AutopilotControlStatus;
  pause_reason:string;
  max_concurrent_automation_runs:number;
  max_concurrent_learning_jobs:number;
  payload:unknown;
  created_at:string;
  updated_at:string;
};

const selection=[
  'id','version','status','pause_reason',
  'max_concurrent_automation_runs','max_concurrent_learning_jobs',
  'payload','created_at','updated_at'
].join(',');

function normalize(row:ControlRow):AutopilotControl{
  const payload=(row.payload??{}) as Partial<AutopilotControlPayload>;
  return {
    kind:'autopilot-control',
    id:'global',
    status:row.status,
    pauseReason:String(payload.pauseReason??row.pause_reason??''),
    maxConcurrentAutomationRuns:Number(
      payload.maxConcurrentAutomationRuns??row.max_concurrent_automation_runs??1
    ),
    maxConcurrentLearningJobs:Number(
      payload.maxConcurrentLearningJobs??row.max_concurrent_learning_jobs??1
    ),
    updatedBy:payload.updatedBy==='operator'?'operator':'system',
    createdAt:String(payload.createdAt??row.created_at),
    updatedAt:String(payload.updatedAt??row.updated_at),
    version:Number(row.version)
  };
}

export async function loadAutopilotControl():Promise<AutopilotControl>{
  const row=checked(await db().from('radar_autopilot_control')
    .select(selection)
    .eq('id','global')
    .maybeSingle());
  if(!row){
    throw new HttpError(
      'Autopilot Control Plane não está inicializado. Automação permanece bloqueada.',
      503
    );
  }
  return normalize(row as unknown as ControlRow);
}

export async function loadAutopilotControlHistory(limit=30):Promise<AutopilotControlVersion[]>{
  const rows=checked(await db().from('radar_autopilot_control_versions')
    .select('version,status,payload,created_at')
    .eq('control_id','global')
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,100))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    status:row.status as AutopilotControlStatus,
    payload:row.payload as AutopilotControlPayload,
    createdAt:String(row.created_at)
  }));
}

export async function saveAutopilotControl(input:{
  expectedVersion:number;
  status:AutopilotControlStatus;
  pauseReason:string;
  maxConcurrentAutomationRuns:number;
  maxConcurrentLearningJobs:number;
}){
  const current=await loadAutopilotControl();
  if(current.version!==input.expectedVersion){
    throw new HttpError(
      'Control Plane desatualizado. Recarregue antes de salvar.',
      409
    );
  }

  const pauseReason=input.pauseReason.trim();
  if(input.status==='paused'&&pauseReason.length<3){
    throw new HttpError('Informe o motivo da pausa global.',400);
  }

  const now=new Date().toISOString();
  const payload=normalizeAutopilotControlPayload({
    kind:'autopilot-control',
    id:'global',
    status:input.status,
    pauseReason:input.status==='paused'?pauseReason:'',
    maxConcurrentAutomationRuns:input.maxConcurrentAutomationRuns,
    maxConcurrentLearningJobs:input.maxConcurrentLearningJobs,
    updatedBy:'operator',
    createdAt:current.createdAt,
    updatedAt:now
  });

  const result=await db().rpc('save_autopilot_control',{
    p_status:payload.status,
    p_pause_reason:payload.pauseReason,
    p_max_concurrent_automation_runs:payload.maxConcurrentAutomationRuns,
    p_max_concurrent_learning_jobs:payload.maxConcurrentLearningJobs,
    p_payload:payload,
    p_expected_version:input.expectedVersion
  });
  if(result.error){
    const message=String(result.error.message??'');
    if(message.includes('autopilot control version conflict')){
      throw new HttpError(
        'Control Plane desatualizado. Recarregue antes de salvar.',
        409
      );
    }
    throw new HttpError('Falha ao salvar Autopilot Control Plane.',502);
  }

  return loadAutopilotControl();
}

export async function assertAutopilotControlRunning(area:string){
  const control=await loadAutopilotControl();
  if(control.status==='running')return control;
  throw new HttpError(
    'Autopilot Control Plane está pausado. '+
    (control.pauseReason||'Retome o master switch antes de continuar.')+
    ' · '+area,
    409
  );
}

export async function autopilotControlState(){
  const client=db();
  const [control,history,automationResult,learningResult]=await Promise.all([
    loadAutopilotControl(),
    loadAutopilotControlHistory(),
    client.from('radar_episode_automation_runs')
      .select('status,worker_token,lease_until'),
    client.from('radar_learning_loop_jobs')
      .select('status,worker_token,lease_until')
  ]);

  const automation=checked(automationResult)??[];
  const learning=checked(learningResult)??[];
  const now=Date.now();
  const liveLease=(item:{worker_token?:unknown;lease_until?:unknown})=>{
    const lease=item.lease_until?Date.parse(String(item.lease_until)):0;
    return Boolean(item.worker_token)&&Number.isFinite(lease)&&lease>now;
  };

  return {
    control,
    history,
    live:{
      automationActive:automation.filter(item=>
        item.status==='active'||item.status==='running'
      ).length,
      automationLeased:automation.filter(item=>
        item.status==='running'&&liveLease(item)
      ).length,
      learningScheduled:learning.filter(item=>item.status==='scheduled').length,
      learningLeased:learning.filter(item=>
        item.status==='processing'&&liveLease(item)
      ).length
    }
  };
}

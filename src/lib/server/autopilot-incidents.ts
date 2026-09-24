import 'server-only';

import type {
  AutopilotIncident, AutopilotIncidentArea, AutopilotIncidentSeverity,
  AutopilotIncidentStatus
} from '@/lib/types';
import {
  AUTOPILOT_BREAKER_WINDOW_MINUTES,
  autopilotCircuitBreakerReason,
  autopilotCircuitBreakerShouldTrip
} from '@/lib/autopilot-incident-policy';
import { checked, db } from './db';
import { HttpError } from './auth';
import { pauseAutopilotControlFromSystem } from './autopilot-control';

type IncidentRow={
  id:string;
  area:AutopilotIncidentArea;
  channel_id:string|null;
  entity_id:string;
  severity:AutopilotIncidentSeverity;
  code:string;
  message:string;
  status:AutopilotIncidentStatus;
  occurrences:number;
  payload:unknown;
  created_at:string;
  last_seen_at:string;
  resolved_at:string|null;
};

const selection=[
  'id','area','channel_id','entity_id','severity','code','message','status',
  'occurrences','payload','created_at','last_seen_at','resolved_at'
].join(',');

function normalize(row:IncidentRow):AutopilotIncident{
  return {
    id:row.id,
    area:row.area,
    channelId:row.channel_id??undefined,
    entityId:row.entity_id,
    severity:row.severity,
    code:row.code,
    message:row.message,
    status:row.status,
    occurrences:Number(row.occurrences),
    payload:(row.payload??{}) as Record<string,unknown>,
    firstSeenAt:row.created_at,
    lastSeenAt:row.last_seen_at,
    resolvedAt:row.resolved_at??undefined
  };
}

export async function listAutopilotIncidents(input:{
  status?:AutopilotIncidentStatus;
  limit?:number;
}={}):Promise<AutopilotIncident[]>{
  let query=db().from('radar_autopilot_incidents')
    .select(selection)
    .order('last_seen_at',{ascending:false})
    .limit(Math.max(1,Math.min(input.limit??100,500)));
  if(input.status)query=query.eq('status',input.status);
  const rows=checked(await query)??[];
  return rows.map(row=>normalize(row as unknown as IncidentRow));
}

export async function evaluateAutopilotCircuitBreaker(){
  const since=new Date(
    Date.now()-AUTOPILOT_BREAKER_WINDOW_MINUTES*60_000
  ).toISOString();
  const rows=checked(await db().from('radar_autopilot_incidents')
    .select(selection)
    .eq('status','open')
    .eq('severity','critical')
    .gte('last_seen_at',since)
    .order('last_seen_at',{ascending:false})
    .limit(500))??[];
  const incidents=rows.map(row=>normalize(row as unknown as IncidentRow));
  if(!autopilotCircuitBreakerShouldTrip(incidents)){
    return {tripped:false,incidents};
  }
  const reason=autopilotCircuitBreakerReason(incidents);
  const control=await pauseAutopilotControlFromSystem(reason);
  return {tripped:true,reason,control,incidents};
}

export async function recordAutopilotIncident(input:{
  area:AutopilotIncidentArea;
  channelId?:string;
  entityId:string;
  severity:AutopilotIncidentSeverity;
  code:string;
  message:string;
  payload?:Record<string,unknown>;
}){
  const now=new Date().toISOString();
  const existing=checked(await db().from('radar_autopilot_incidents')
    .select(selection)
    .eq('area',input.area)
    .eq('entity_id',input.entityId)
    .eq('code',input.code)
    .eq('status','open')
    .order('last_seen_at',{ascending:false})
    .limit(1))?.[0] as IncidentRow|undefined;

  let incident:AutopilotIncident;
  if(existing){
    const rows=checked(await db().from('radar_autopilot_incidents').update({
      severity:input.severity,
      message:input.message.slice(0,4000),
      payload:input.payload??{},
      occurrences:Number(existing.occurrences)+1,
      last_seen_at:now,
      updated_at:now
    }).eq('id',existing.id).select(selection));
    incident=normalize(rows![0] as unknown as IncidentRow);
  }else{
    const id=crypto.randomUUID();
    const rows=checked(await db().from('radar_autopilot_incidents').insert({
      id,
      area:input.area,
      channel_id:input.channelId??null,
      entity_id:input.entityId,
      severity:input.severity,
      code:input.code.slice(0,120),
      message:input.message.slice(0,4000),
      status:'open',
      occurrences:1,
      last_seen_at:now,
      payload:input.payload??{}
    }).select(selection));
    incident=normalize(rows![0] as unknown as IncidentRow);
  }

  const breaker=input.severity==='critical'
    ?await evaluateAutopilotCircuitBreaker()
    :{tripped:false,incidents:[] as AutopilotIncident[]};

  return {incident,breaker};
}

export async function resolveAutopilotIncident(input:{
  incidentId:string;
  status:'resolved'|'ignored';
}){
  const rows=checked(await db().from('radar_autopilot_incidents').update({
    status:input.status,
    resolved_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  }).eq('id',input.incidentId).eq('status','open').select(selection));
  if(!rows?.length)throw new HttpError('Incidente aberto não encontrado.',404);
  return normalize(rows[0] as unknown as IncidentRow);
}

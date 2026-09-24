import type { AutopilotIncident } from './types';

export const AUTOPILOT_BREAKER_THRESHOLD=3;
export const AUTOPILOT_BREAKER_WINDOW_MINUTES=15;

export function recentCriticalAutopilotIncidents(
  incidents:AutopilotIncident[],
  nowMs=Date.now()
){
  const cutoff=nowMs-AUTOPILOT_BREAKER_WINDOW_MINUTES*60_000;
  return incidents.filter(incident=>
    incident.status==='open'&&
    incident.severity==='critical'&&
    Date.parse(incident.lastSeenAt)>=cutoff
  );
}

export function autopilotCircuitBreakerDistinctEntities(
  incidents:AutopilotIncident[],
  nowMs=Date.now()
){
  return new Set(
    recentCriticalAutopilotIncidents(incidents,nowMs)
      .map(incident=>incident.area+':'+incident.entityId)
  );
}

export function autopilotCircuitBreakerShouldTrip(
  incidents:AutopilotIncident[],
  nowMs=Date.now()
){
  return autopilotCircuitBreakerDistinctEntities(incidents,nowMs).size>=
    AUTOPILOT_BREAKER_THRESHOLD;
}

export function autopilotCircuitBreakerReason(
  incidents:AutopilotIncident[],
  nowMs=Date.now()
){
  const recent=recentCriticalAutopilotIncidents(incidents,nowMs);
  const distinct=autopilotCircuitBreakerDistinctEntities(incidents,nowMs);
  const areas=[...new Set(recent.map(incident=>incident.area))].sort();
  return [
    'Circuit breaker automático:',
    distinct.size+' entidades distintas com falha crítica em '+
      AUTOPILOT_BREAKER_WINDOW_MINUTES+' min.',
    areas.length?'Áreas: '+areas.join(', ')+'.':''
  ].filter(Boolean).join(' ');
}

import type {
  AutopilotControl, AutopilotControlPayload, AutopilotControlStatus
} from './types';

export const AUTOPILOT_CONCURRENCY_MIN=1;
export const AUTOPILOT_CONCURRENCY_MAX=10;

export function defaultAutopilotControl(now=new Date().toISOString()):AutopilotControlPayload{
  return {
    kind:'autopilot-control',
    id:'global',
    status:'paused',
    pauseReason:'Control Plane inicializado em modo seguro.',
    maxConcurrentAutomationRuns:1,
    maxConcurrentLearningJobs:1,
    updatedBy:'system',
    createdAt:now,
    updatedAt:now
  };
}

export function boundedAutopilotConcurrency(value:number){
  const parsed=Math.round(Number(value));
  if(!Number.isFinite(parsed))return AUTOPILOT_CONCURRENCY_MIN;
  return Math.max(
    AUTOPILOT_CONCURRENCY_MIN,
    Math.min(AUTOPILOT_CONCURRENCY_MAX,parsed)
  );
}

export function normalizeAutopilotControlPayload(
  input:AutopilotControlPayload
):AutopilotControlPayload{
  return {
    ...input,
    id:'global',
    pauseReason:input.pauseReason.trim().slice(0,1000),
    maxConcurrentAutomationRuns:boundedAutopilotConcurrency(
      input.maxConcurrentAutomationRuns
    ),
    maxConcurrentLearningJobs:boundedAutopilotConcurrency(
      input.maxConcurrentLearningJobs
    )
  };
}

export function autopilotControlCanRun(
  control:Pick<AutopilotControl,'status'>
){
  return control.status==='running';
}

export function autopilotControlStatusLabel(status:AutopilotControlStatus){
  return status==='running'?'Running':'Paused';
}

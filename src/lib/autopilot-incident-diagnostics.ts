import type { AutopilotIncident } from './types';

export const STALE_AUTOMATION_THRESHOLD_MS=2*60*60*1000;

export type AutomationRunDiagnosticSource={
  id:string;
  channel_id:string;
  status:string;
  current_step?:string|null;
  worker_token?:unknown;
  lease_until?:string|null;
  updated_at?:string|null;
};

export type RunHealth='stale'|'leased'|'waiting'|'completed'|'terminal'|'recent-unleased'|'unlinked';

export type RunDiagnosis={
  id:string;
  channelId:string;
  status:string;
  step:string;
  lastUpdatedAt:string|null;
  health:RunHealth;
  hasLiveLease:boolean;
  hoursSinceUpdate:number|null;
};

function parsedTime(value:unknown):number|null{
  if(typeof value!=='string'||!value.trim())return null;
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)?timestamp:null;
}

export function diagnoseAutomationRun(
  run:AutomationRunDiagnosticSource|null|undefined,
  nowMs:number,
  staleAfterMs=STALE_AUTOMATION_THRESHOLD_MS
):RunDiagnosis|null{
  if(!run)return null;
  const updated=parsedTime(run.updated_at);
  const leaseUntil=parsedTime(run.lease_until);
  const hasLiveLease=Boolean(run.worker_token)&&leaseUntil!==null&&leaseUntil>nowMs;
  const age=updated===null?null:Math.max(0,nowMs-updated);
  const hoursSinceUpdate=age===null?null:Math.round(age/36000)/100;
  let health:RunHealth;
  if(run.status==='completed')health='completed';
  else if(run.status==='waiting')health='waiting';
  else if(run.status==='cancelled'||run.status==='failed')health='terminal';
  else if(hasLiveLease)health='leased';
  else if((run.status==='active'||run.status==='running')&&age!==null&&age>=staleAfterMs)health='stale';
  else health='recent-unleased';
  return {
    id:run.id,channelId:run.channel_id,status:run.status,
    step:run.current_step??'desconhecida',lastUpdatedAt:run.updated_at??null,
    health,hasLiveLease,hoursSinceUpdate
  };
}

export function canMarkIncidentResolved(input:{
  incidentStatus:string;
  incidentChannelId:string|undefined;
  incidentLastSeenAt:string;
  run:AutomationRunDiagnosticSource|null|undefined;
  nowMs:number;
}):boolean{
  if(input.incidentStatus!=='open'||!input.run
    ||input.run.channel_id!==input.incidentChannelId)return false;
  const run=diagnoseAutomationRun(input.run,input.nowMs);
  const incidentAt=parsedTime(input.incidentLastSeenAt);
  const runAt=parsedTime(input.run.updated_at);
  return Boolean(run&&run.health==='completed'&&!run.hasLiveLease
    &&incidentAt!==null&&runAt!==null&&runAt>=incidentAt);
}

export function incidentRecoveryGuidance(message:string):string{
  if(/insufficient-render-disk/i.test(message)){
    return 'Conferir espaço e reserva de disco no worker de render; depois repetir o preflight, sem retry infinito.';
  }
  if(/Source Router|mapa real aprovado/i.test(message)){
    return 'Selecionar mídia ou mapa autêntico com origem documentada; não gerar mapa sintético para evidência factual.';
  }
  if(/shot-type-concentration|visual-strategy/i.test(message)){
    return 'Variar enquadramentos e classes visuais no storyboard e reexecutar Visual QA, sem desativar a política.';
  }
  if(/reservar uma variante/i.test(message)){
    return 'Auditar reserva de variantes, versões de assets e concorrência antes de nova tentativa.';
  }
  if(/já possui um relatório de Production QA/i.test(message)){
    return 'Verificar relatório e hash já existentes; evitar duplicar Production QA para o mesmo render.';
  }
  if(/response_format.mime_type|image\/png.*image\/jpeg/i.test(message)){
    return 'Revalidar MIME do provedor e usar formato JPEG aceito antes de repetir a geração.';
  }
  return '';
}

export type IncidentDiagnosis=AutopilotIncident&{
  projectName:string;
  run:RunDiagnosis|null;
  diagnosis:'stale-run'|'waiting-operator'|'run-completed'|'active-lease'|'review-required';
  canMarkResolved:boolean;
  recommendedAction:string;
};

export function diagnoseIncidents(
  incidents:AutopilotIncident[],
  runRows:AutomationRunDiagnosticSource[],
  projects:Array<{id:string;payload?:unknown}>,
  nowMs:number
):IncidentDiagnosis[]{
  const byRun=new Map(runRows.map(run=>[run.id,run]));
  const byProject=new Map(projects.map(project=>{
    const payload=project.payload&&typeof project.payload==='object'
      ?project.payload as {name?:unknown}:null;
    const name=typeof payload?.name==='string'&&payload.name.trim()
      ?payload.name.trim().slice(0,140):'Projeto sem nome';
    return [project.id,name] as const;
  }));
  return incidents.map(incident=>{
    const rawRun=byRun.get(incident.entityId);
    // The run must belong to the same project. Never trust entityId alone.
    const run=rawRun&&rawRun.channel_id===incident.channelId
      ?diagnoseAutomationRun(rawRun,nowMs):null;
    const canMarkResolved=incident.area==='episode-automation'
      ?canMarkIncidentResolved({
          incidentStatus:incident.status,
          incidentChannelId:incident.channelId,
          incidentLastSeenAt:incident.lastSeenAt,
          run:rawRun,
          nowMs
        })
      :incident.status==='open';
    let diagnosis:IncidentDiagnosis['diagnosis']='review-required';
    let recommendedAction='Verificar a origem e a execução antes de encerrar o incidente.';
    if(run?.health==='stale'){
      diagnosis='stale-run';
      recommendedAction='Execução sem lease válido e sem progresso recente. Inspecionar worker e estado antes de retomar ou encerrar.';
    }else if(run?.health==='waiting'){
      diagnosis='waiting-operator';
      recommendedAction='Execução aguardando uma condição ou aprovação. Corrigir o bloqueio e retomar pelo fluxo do projeto.';
    }else if(run?.health==='leased'){
      diagnosis='active-lease';
      recommendedAction='Worker possui lease válido. Aguardar/checkpoint; não encerrar incidente durante o processamento.';
    }else if(canMarkResolved){
      diagnosis='run-completed';
      recommendedAction='Execução concluída após a última ocorrência. Conferir o resultado e então registrar a resolução.';
    }else if(run?.health==='completed'){
      diagnosis='review-required';
      recommendedAction='Execução concluída, mas o incidente é posterior ou sem evidência temporal confiável. Revisar manualmente.';
    }
    const guidance=incidentRecoveryGuidance(incident.message);
    if(guidance)recommendedAction+=' '+guidance;
    return {
      ...incident,
      projectName:byProject.get(incident.channelId??'')??'Projeto não identificado',
      run,diagnosis,canMarkResolved,recommendedAction
    };
  });
}

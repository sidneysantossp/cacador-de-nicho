import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AutopilotIncident} from '../src/lib/types';
import {
  canMarkIncidentResolved, diagnoseAutomationRun, diagnoseIncidents
} from '../src/lib/autopilot-incident-diagnostics';

const now=Date.parse('2026-11-05T11:00:00.000Z');
const old='2026-10-07T17:25:00.000Z';
const after='2026-11-05T11:01:00.000Z';
const run=(status:string,overrides:Record<string,unknown>={})=>({
  id:'run-1',channel_id:'project-1',status,current_step:'render',
  updated_at:old,worker_token:null,lease_until:null,...overrides
});
const incident=(overrides:Partial<AutopilotIncident>={}):AutopilotIncident=>({
  id:'incident-1',area:'episode-automation',channelId:'project-1',entityId:'run-1',
  severity:'critical',code:'episode-automation-hold',message:'Render hold',status:'open',
  occurrences:5,firstSeenAt:old,lastSeenAt:old,payload:{},...overrides
});

test('Detecta execução running antiga sem lease como abandonada, sem mudar estado',()=>{
  const original=run('running');
  const diagnosis=diagnoseAutomationRun(original,now);
  assert.equal(diagnosis?.health,'stale');
  assert.equal(diagnosis?.hasLiveLease,false);
  assert.equal(original.status,'running');
});
test('Não acusa abandonada quando há lease válido',()=>{
  assert.equal(diagnoseAutomationRun(run('running',{
    worker_token:'active-token',lease_until:after
  }),now)?.health,'leased');
});
test('Espera por aprovação não é classificada como abandono',()=>{
  assert.equal(diagnoseAutomationRun(run('waiting'),now)?.health,'waiting');
});
test('Nova execução sem lease não vira abandonada prematuramente',()=>{
  assert.equal(diagnoseAutomationRun(run('active',{updated_at:'2026-11-05T10:59:00Z'}),now)?.health,'recent-unleased');
});
test('Active antiga sem lease é marcada stale',()=>{
  assert.equal(diagnoseAutomationRun(run('active'),now)?.health,'stale');
});
test('Incidente só pode ser resolvido com run concluída após último erro, sem lease',()=>{
  const base={incidentStatus:'open',incidentChannelId:'project-1',incidentLastSeenAt:old,nowMs:now};
  assert.equal(canMarkIncidentResolved({...base,run:run('completed',{updated_at:after})}),true);
  assert.equal(canMarkIncidentResolved({...base,run:run('running',{updated_at:after})}),false);
  assert.equal(canMarkIncidentResolved({...base,run:run('waiting',{updated_at:after})}),false);
  assert.equal(canMarkIncidentResolved({...base,run:run('completed',{updated_at:'2026-10-06T00:00:00Z'})}),false);
  assert.equal(canMarkIncidentResolved({...base,run:run('completed',{channel_id:'another',updated_at:after})}),false);
  assert.equal(canMarkIncidentResolved({...base,run:run('completed',{updated_at:after,worker_token:'active',lease_until:'2026-11-05T12:00:00Z'})}),false);
  assert.equal(canMarkIncidentResolved({...base,incidentStatus:'ignored',run:run('completed',{updated_at:after})}),false);
});
test('A interface recebe nome do projeto e diagnóstico sem confundir incidentes',()=>{
  const original=incident();
  const list=diagnoseIncidents([original],[run('running')],[{id:'project-1',payload:{name:'Car Electrical Doctor — PILOTO'}}],now);
  assert.equal(list[0].projectName,'Car Electrical Doctor — PILOTO');
  assert.equal(list[0].diagnosis,'stale-run');
  assert.equal(list[0].canMarkResolved,false);
  assert.equal(list[0].run?.status,'running');
  assert.equal(original.status,'open');
});
test('Run de outro projeto não pode ser associado ao incidente',()=>{
  const list=diagnoseIncidents([incident()],[run('completed',{channel_id:'not-the-same',updated_at:after})],[],now);
  assert.equal(list[0].canMarkResolved,false);
  assert.equal(list[0].run,null);
  assert.equal(list[0].projectName,'Projeto não identificado');
});
test('Run concluída permite revisão explícita, sem fechar incidente automaticamente',()=>{
  const list=diagnoseIncidents([incident()],[run('completed',{updated_at:after})],[{id:'project-1',payload:{name:'Ketlyn'}}],now);
  assert.equal(list[0].diagnosis,'run-completed');
  assert.equal(list[0].canMarkResolved,true);
  assert.equal(list[0].status,'open');
});

test('Orienta correção específica sem relaxar regras de qualidade ou criar novas tentativas',()=>{
  const cases=[
    ['insufficient-render-disk','espaço'],
    ['Source Router pausou #0-31: Nenhum mapa real aprovado','mapa autêntico'],
    ['visual-strategy-shot-type-concentration','enquadramentos'],
    ['Não foi possível reservar uma variante','reserva'],
    ['Este render já possui um relatório de Production QA','duplicar'],
    ['response_format.mime_type image/png','JPEG']
  ];
  for(const [message,expected] of cases){
    const list=diagnoseIncidents([incident({message})],[run('waiting')],[],now);
    assert.ok(list[0].recommendedAction.includes(expected),message);
    assert.equal(list[0].canMarkResolved,false);
  }
});

test('Incidentes de outros subsistemas preservam resolução manual, com confirmação do operador',()=>{
  const list=diagnoseIncidents([incident({area:'render'})],[],[],now);
  assert.equal(list[0].status,'open');
  assert.equal(list[0].canMarkResolved,true);
});

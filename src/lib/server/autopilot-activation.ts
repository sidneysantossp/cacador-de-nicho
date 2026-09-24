import 'server-only';

import type { ManagedChannel } from '@/lib/types';
import { HttpError } from './auth';
import { checked, db } from './db';
import { loadAutopilotReadiness } from './autopilot-readiness';
import { autopilotActivationRequirement } from '@/lib/channel-autopilot-policy';

function issueSummary(
  mode:'assisted'|'autonomous',
  checks:Awaited<ReturnType<typeof loadAutopilotReadiness>>['checks']
){
  const relevant=checks.filter(check=>{
    if(mode==='assisted')return check.requiredFor==='assisted'&&check.status==='blocker';
    return check.status!=='pass';
  });
  return relevant.map(check=>check.label+': '+check.detail).join(' · ');
}

export async function assertAutopilotActivationAllowed(
  channelId:string,
  next:ManagedChannel
){
  const currentRow=checked(await db().from('radar_managed_channels')
    .select('payload').eq('id',channelId).maybeSingle());
  const current=currentRow?.payload as ManagedChannel|undefined;
  const requirement=autopilotActivationRequirement(current??null,next);
  if(requirement==='none')return;

  if(!current){
    throw new HttpError(
      'Salve o canal com Autopilot desligado antes de ativar automações.',
      409
    );
  }

  const readiness=await loadAutopilotReadiness(channelId);
  const ready=requirement==='assisted'
    ?readiness.assistedReady
    :readiness.autonomousReady;
  if(ready)return;

  const detail=issueSummary(requirement,readiness.checks);
  throw new HttpError(
    'Autopilot '+(requirement==='assisted'?'Assisted':'Autonomous')+
    ' bloqueado pelo readiness.'+(detail?' '+detail:''),
    409
  );
}

import 'server-only';

import type { ManagedChannel } from '@/lib/types';
import { HttpError } from './auth';
import { checked, db } from './db';
import { loadAutopilotReadiness } from './autopilot-readiness';
import {
  autopilotActivationReadinessIssues, autopilotActivationRequirement
} from '@/lib/channel-autopilot-policy';

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
  const issues=autopilotActivationReadinessIssues(requirement,readiness);
  if(!issues.length)return;

  const detail=issues.map(check=>check.label+': '+check.detail).join(' · ');
  throw new HttpError(
    'Autopilot '+(requirement==='assisted'?'Assisted':'Autonomous')+
    ' bloqueado pelo readiness.'+(detail?' '+detail:''),
    409
  );
}

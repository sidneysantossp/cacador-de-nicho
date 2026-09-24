import 'server-only';

import { checked, db } from './db';
import { autopilotOperationalIssues } from '@/lib/channel-autopilot-policy';

export async function loadAutopilotOperationalIssues(channelId:string){
  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const [acceptedResult,automationResult]=await Promise.all([
    db().from('radar_learning_loop_jobs')
      .select('id')
      .eq('channel_id',channelId)
      .in('next_episode_action',['accepted','automation-started'])
      .gte('completed_at',since)
      .limit(1),
    db().from('radar_episode_automation_runs')
      .select('id,status')
      .eq('channel_id',channelId)
      .in('status',['active','waiting','running'])
      .limit(1)
  ]);

  const accepted=checked(acceptedResult)??[];
  const automation=checked(automationResult)??[];
  return autopilotOperationalIssues({
    automaticAcceptanceInLast24Hours:accepted.length>0,
    activeEpisodeAutomation:automation.length>0
  });
}

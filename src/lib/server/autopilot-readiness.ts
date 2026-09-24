import 'server-only';

import type { AutopilotReadiness } from '@/lib/types';
import { buildAutopilotReadiness } from '@/lib/autopilot-readiness-policy';
import { checked, db } from './db';
import { HttpError } from './auth';
import { loadChannelBrain } from './channel-brain';
import { loadProductionDna } from './production-dna';
import { providerStatuses } from './providers';
import { loadYouTubeConnection } from './youtube-oauth';
import { youtubeOAuthConfig } from './youtube-secrets';

function workerConfigured(url:string|undefined,secret:string|undefined){
 return Boolean((url??'').trim())&&Boolean((secret??'').trim().length>=32);
}

export async function loadAutopilotReadiness(channelId:string):Promise<AutopilotReadiness>{
 const channel=checked(await db().from('radar_managed_channels')
  .select('id').eq('id',channelId).maybeSingle());
 if(!channel)throw new HttpError('Canal não encontrado.',404);

 const since=new Date(Date.now()-24*60*60*1000).toISOString();
 const [
  brain,
  dna,
  providers,
  youtube,
  recentAcceptResult,
  automationResult,
  learningResult
 ]=await Promise.all([
  loadChannelBrain(channelId),
  loadProductionDna(channelId),
  providerStatuses(),
  loadYouTubeConnection(channelId),
  db().from('radar_learning_loop_jobs')
   .select('id')
   .eq('channel_id',channelId)
   .in('next_episode_action',['accepted','automation-started'])
   .gte('completed_at',since)
   .limit(1),
  db().from('radar_episode_automation_runs')
   .select('id')
   .eq('channel_id',channelId)
   .in('status',['active','waiting','running'])
   .limit(1),
  db().from('radar_learning_loop_jobs')
   .select('id')
   .eq('channel_id',channelId)
   .in('status',['scheduled','processing'])
   .limit(1)
 ]);

 const providerMap=new Map(providers.map(item=>[item.provider,item.configured]));
 const oauth=youtubeOAuthConfig();

 return buildAutopilotReadiness({
  channelId,
  hasBrain:Boolean(brain),
  hasProductionDna:Boolean(dna),
  providers:{
   openai:Boolean(providerMap.get('openai')),
   elevenlabs:Boolean(providerMap.get('elevenlabs')),
   googleai:Boolean(providerMap.get('googleai'))
  },
  workers:{
   automation:workerConfigured(
    process.env.AUTOMATION_WORKER_URL,
    process.env.AUTOMATION_WORKER_SECRET
   ),
   learningLoop:workerConfigured(
    process.env.LEARNING_LOOP_WORKER_URL,
    process.env.LEARNING_LOOP_WORKER_SECRET
   )
  },
  youtube:{
   oauthConfigured:oauth.configured,
   connected:youtube?.status==='connected',
   scopes:youtube?.scopes??[]
  },
  operations:{
   automaticAcceptanceInLast24Hours:(checked(recentAcceptResult)??[]).length>0,
   activeEpisodeAutomation:(checked(automationResult)??[]).length>0,
   activeLearningLoop:(checked(learningResult)??[]).length>0
  }
 });
}

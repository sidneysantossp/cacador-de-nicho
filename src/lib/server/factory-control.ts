import 'server-only';

import type { FactoryControlState } from '@/lib/factory-control';
import { checked, db } from './db';


const stageProgress={planning:3,content:8,script:18,voice:26,transcript:34,scenes:42,render:80,quality:94,packaging:97,publish:98,done:100} as const;

const stageLabels:Record<string,string>={planning:'Planejamento',content:'Content Project',script:'Script',voice:'Voice',transcript:'Transcript',scenes:'Scene Plan','visual-prompts':'Visual Prompts','visual-assets':'Visual Assets',timeline:'Timeline','video-edit':'Video Edit',render:'Render',quality:'Production QA',packaging:'Packaging',publish:'Publish',done:'Concluído'};
type Row=Record<string,unknown>;
function latest(rows:Row[]){const out=new Map<string,Row>();for(const row of rows){const id=String(row.episode_id??'');if(id&&!out.has(id))out.set(id,row);}return out;}
function median(values:number[]){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function metric(payload:unknown,key:string){if(!payload||typeof payload!=='object')return null;const m=(payload as {metrics?:Record<string,unknown>}).metrics,v=m?.[key];return typeof v==='number'&&Number.isFinite(v)?v:null;}

export async function loadFactoryControlState():Promise<FactoryControlState>{
 const [a,c,e,at,mo,au,cp,sc,vo,tr,sp,vp,tl,ve,rj,qr,pp,yp,po]=await Promise.all([
  db().from('radar_agents').select('*').order('display_name'),
  db().from('radar_managed_channels').select('id,payload,updated_at').limit(1000),
  db().from('radar_episodes').select('id,channel_id,status,payload,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_episode_agent_attributions').select('*').limit(3000),
  db().from('radar_agent_operations').select('*').order('updated_at',{ascending:false}).limit(500),
  db().from('radar_episode_automation_runs').select('id,channel_id,episode_id,status,current_step,hold_reason,last_error,updated_at').order('updated_at',{ascending:false}).limit(500),
  db().from('radar_content_projects').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_episode_scripts').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_voice_assets').select('id,episode_id,status,selected,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_transcripts').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_scene_plans').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_visual_prompt_sets').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_timelines').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_video_edits').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_render_jobs').select('id,episode_id,status,progress,stage,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_production_quality_reports').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_publication_packages').select('id,episode_id,status,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_youtube_publish_jobs').select('id,status,progress,stage,package_id,updated_at').order('updated_at',{ascending:false}).limit(1000),
  db().from('radar_performance_observations').select('episode_id,observed_at,payload').order('observed_at',{ascending:false}).limit(3000)
 ]);

 const agentsRaw=(checked(a)??[]) as Row[],channelsRaw=(checked(c)??[]) as Row[],episodesRaw=(checked(e)??[]) as Row[];
 const attrs=(checked(at)??[]) as Row[],manualRaw=(checked(mo)??[]) as Row[],autoRaw=(checked(au)??[]) as Row[];
 const projects=latest((checked(cp)??[]) as Row[]),scripts=latest((checked(sc)??[]) as Row[]);
 const voices=latest(((checked(vo)??[]) as Row[]).filter(row=>row.selected===true));
 const transcripts=latest((checked(tr)??[]) as Row[]),scenes=latest((checked(sp)??[]) as Row[]);
 const visuals=latest((checked(vp)??[]) as Row[]),timelines=latest((checked(tl)??[]) as Row[]);
 const edits=latest((checked(ve)??[]) as Row[]),renders=latest((checked(rj)??[]) as Row[]);
 const qualities=latest((checked(qr)??[]) as Row[]),packages=latest((checked(pp)??[]) as Row[]);
 const observations=latest((checked(po)??[]) as Row[]);

 const channels=new Map<string,{name:string;owned:boolean}>();
 for(const row of channelsRaw){const p=(row.payload??{}) as Record<string,unknown>;channels.set(String(row.id),{name:String(p.name??'Canal'),owned:p.kind!=='competitor'&&typeof p.stage==='string'});}
 const agents=agentsRaw.map(row=>({id:String(row.id),displayName:String(row.display_name),signature:String(row.signature),provider:String(row.provider),model:row.model?String(row.model):null,role:String(row.role),status:String(row.status) as 'active'|'paused'|'retired',description:String(((row.payload??{}) as Record<string,unknown>).description??''),updatedAt:String(row.updated_at)}));
 const agentMap=new Map(agents.map(agent=>[agent.id,agent]));
 const ownerByEpisode=new Map<string,string>();for(const row of attrs)if(row.role==='owner')ownerByEpisode.set(String(row.episode_id),String(row.agent_id));
 const automation=latest(autoRaw);
 const packageById=new Map<string,Row>();for(const row of (checked(pp)??[]) as Row[])packageById.set(String(row.id),row);
 const publishByEpisode=new Map<string,Row>();for(const row of (checked(yp)??[]) as Row[]){const pkg=packageById.get(String(row.package_id)),episodeId=String(pkg?.episode_id??'');if(episodeId&&!publishByEpisode.has(episodeId))publishByEpisode.set(episodeId,row);}

 const episodeOperations:FactoryControlState['operations']=[];
 for(const row of episodesRaw){
  const channelId=String(row.channel_id),channel=channels.get(channelId);if(!channel?.owned)continue;
  const episodeId=String(row.id),payload=(row.payload??{}) as Record<string,unknown>,title=String(payload.title??'Untitled episode');
  const agentId=ownerByEpisode.get(episodeId)??'factory-system',agent=agentMap.get(agentId)??agentMap.get('factory-system');
  let stage='planning',progress=stageProgress.planning,status:'ready'|'processing'|'blocked'|'review'|'completed'|'failed'='ready';
  let summary='Episódio aguardando próxima etapa.',blocker:string|null=null,updatedAt=String(row.updated_at);
  if(projects.has(episodeId)){stage='content';progress=stageProgress.content;}
  if(scripts.has(episodeId)){stage='script';progress=stageProgress.script;}
  if(voices.has(episodeId)){stage='voice';progress=stageProgress.voice;}
  if(transcripts.has(episodeId)){stage='transcript';progress=stageProgress.transcript;}
  if(scenes.has(episodeId)){stage='scenes';progress=stageProgress.scenes;}
  if(visuals.has(episodeId)){stage='visual-prompts';progress=45;}
  if(timelines.has(episodeId)){stage='timeline';progress=65;}
  if(edits.has(episodeId)){stage='video-edit';progress=73;}
  const render=renders.get(episodeId);
  if(render){stage='render';progress=Math.max(80,Math.min(92,80+Math.round(Number(render.progress??0)*.12)));updatedAt=String(render.updated_at??updatedAt);if(render.status==='failed'){status='failed';blocker='Render failed.';}else if(render.status!=='completed')status='processing';}
  if(qualities.has(episodeId)){stage='quality';progress=94;}
  const pkg=packages.get(episodeId);if(pkg){stage='packaging';progress=97;updatedAt=String(pkg.updated_at??updatedAt);}
  const publish=publishByEpisode.get(episodeId);
  if(publish){stage='publish';progress=Math.max(98,Math.min(100,98+Math.round(Number(publish.progress??0)*.02)));updatedAt=String(publish.updated_at??updatedAt);if(publish.status==='completed'){stage='done';progress=100;status='completed';}else if(publish.status==='failed'){status='failed';blocker='Publish failed.';}else status='processing';}
  const run=automation.get(episodeId);
  if(run){stage=String(run.current_step??stage);progress=Math.max(progress,stageProgress[stage as keyof typeof stageProgress]??progress);updatedAt=String(run.updated_at??updatedAt);if(run.status==='completed'){status='completed';progress=100;}else if(run.status==='failed'){status='failed';blocker=String(run.last_error??'Automation failed.');}else if(run.status==='waiting'){status='blocked';blocker=String(run.hold_reason??'Aguardando intervenção.');}else{status='processing';summary='Automation Run em '+(stageLabels[stage]??stage)+'.';}}
  episodeOperations.push({id:'episode:'+episodeId,source:'episode',operationKey:'episode:'+episodeId,agentId,agentName:agent?.displayName??'Factory System',agentSignature:agent?.signature??'@factory',channelId,channelName:channel.name,episodeId,videoTitle:title,batchKey:null,stage,stageLabel:stageLabels[stage]??stage,status,progress,summary,blocker,updatedAt});
 }

 const perfRows=checked(await db().from('radar_agent_performance_v').select('*'))??[];
 const performance=perfRows.map(row=>({
  agentId:String(row.agent_id),
  attributedEpisodes:Number(row.attributed_episodes??0),
  publishedSamples:Number(row.published_samples??0),
  medianViews:row.median_views===null?null:Number(row.median_views),
  medianCtrPercent:row.median_ctr_percent===null?null:Number(row.median_ctr_percent),
  medianAveragePercentageViewed:row.median_average_percentage_viewed===null?null:Number(row.median_average_percentage_viewed),
  medianRpm:row.median_rpm===null?null:Number(row.median_rpm),
  totalRevenue:row.total_revenue===null?null:Number(row.total_revenue),
  bestEpisode:null
 }));

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

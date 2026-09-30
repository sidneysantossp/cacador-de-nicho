import 'server-only';

import type { FactoryControlState } from '@/lib/factory-control';
import { checked, db } from './db';


const stageProgress={planning:3,content:8,script:18,voice:26,transcript:34,scenes:42,render:80,quality:94,packaging:97,publish:98,done:100} as const;

const stageLabels:Record<string,string>={planning:'Planejamento',content:'Content Project',script:'Script',voice:'Voice',transcript:'Transcript',scenes:'Scene Plan','visual-prompts':'Visual Prompts','visual-assets':'Visual Assets',timeline:'Timeline','video-edit':'Video Edit',render:'Render',quality:'Production QA',packaging:'Packaging',publish:'Publish',done:'Concluído'};
type Row=Record<string,unknown>;
function latest(rows:Row[]){const out=new Map<string,Row>();for(const row of rows){const id=String(row.episode_id??'');if(id&&!out.has(id))out.set(id,row);}return out;}
function median(values:number[]){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function metric(payload:unknown,key:string){if(!payload||typeof payload!=='object')return null;const m=(payload as {metrics?:Record<string,unknown>}).metrics,v=m?.[key];return typeof v==='number'&&Number.isFinite(v)?v:null;}

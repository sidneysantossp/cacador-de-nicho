import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { RadarData, Channel, Settings } from '@/lib/types';
import { defaultSettings } from '@/lib/types';
import { buildOpportunityGaps } from '@/lib/reference-catalog';
import { qualifiesOpportunityCandidate } from '@/lib/opportunity-criteria';
import { HttpError } from './auth';
export const dbConfigured=()=>!!process.env.SUPABASE_URL&&!!process.env.SUPABASE_SERVICE_ROLE_KEY;
export const policyApproved=()=>process.env.YOUTUBE_ANALYTICS_APPROVED==='true';
export function db(){if(!dbConfigured())throw new HttpError('Configure o Supabase e aplique docs/schema.sql.',503);return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});}
export function checked<T>(result:{data:T;error:unknown}):T{if(result.error)throw new HttpError('Falha no Supabase. Verifique a conexão e o schema instalado.',502);return result.data;}
export async function put(table:string,id:string,payload:unknown){checked(await db().from(table).upsert({id,payload,updated_at:new Date().toISOString()}));}
export async function list<T>(table:string,limit=200):Promise<T[]>{const data=checked(await db().from(table).select('payload').order('updated_at',{ascending:false}).limit(limit));return (data??[]).map(x=>x.payload as T);}
async function optionalList<T>(table:string,limit=200):Promise<T[]>{try{return await list<T>(table,limit);}catch{return [];}}
export async function settings():Promise<Settings>{const saved=(await list<Partial<Settings>>('radar_settings',1))[0];return {...defaultSettings,...saved,languages:['en']};}
export async function channel(id:string):Promise<Channel>{const data=checked(await db().from('radar_channels').select('payload').eq('id',id).maybeSingle());if(!data)throw new HttpError('Canal não encontrado.',404);return data.payload as Channel;}
export async function cleanup(){checked(await db().rpc('prune_radar_data',{analytics_approved:policyApproved()}));}
export async function loadRadar():Promise<Pick<RadarData,'channels'|'gaps'|'managedChannels'|'decisions'|'contexts'|'scripts'|'runs'|'settings'|'lastUpdated'>>{await cleanup();const [allChannels,managedChannels,decisions,contexts,scripts,runs,config]=await Promise.all([list<RadarData['channels'][number]>('radar_channels',1000),optionalList<RadarData['managedChannels'][number]>('radar_managed_channels'),list<RadarData['decisions'][number]>('radar_decisions'),list<RadarData['contexts'][number]>('radar_contexts'),list<RadarData['scripts'][number]>('radar_scripts'),list<RadarData['runs'][number]>('radar_runs',30),settings()]);const references=allChannels.filter(c=>c.discoverySource==='reference');const channels=allChannels.filter(c=>c.discoverySource==='reference-adjacent'&&qualifiesOpportunityCandidate(c,config));const gaps=buildOpportunityGaps([...references,...channels]);return {channels,gaps,managedChannels,decisions,contexts,scripts,runs,settings:config,lastUpdated:channels[0]?.observedAt??references[0]?.observedAt??null};}




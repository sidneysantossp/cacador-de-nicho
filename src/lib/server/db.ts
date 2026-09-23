import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { RadarData, Channel, ChannelStudy, MissionBrief, OpportunityReport, Settings } from '@/lib/types';
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
export async function settings():Promise<Settings>{const saved=(await list<Partial<Settings>>('radar_settings',1))[0];const merged={...defaultSettings,...saved,languages:['en'] as string[]};const allowed=new Set(['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol']);return {...merged,analysisModel:allowed.has(merged.analysisModel)?merged.analysisModel:defaultSettings.analysisModel,scriptModel:allowed.has(merged.scriptModel)?merged.scriptModel:defaultSettings.scriptModel} as Settings;}
export async function channel(id:string):Promise<Channel>{const data=checked(await db().from('radar_channels').select('payload').eq('id',id).maybeSingle());if(!data)throw new HttpError('Canal não encontrado.',404);return data.payload as Channel;}
export async function cleanup(){checked(await db().rpc('prune_radar_data',{analytics_approved:policyApproved()}));}
function normalizeChannelStudy(study:ChannelStudy):ChannelStudy{
 const topicGenome=study.anatomy?.topicGenome??{winningEntities:[],recurringAngles:[],curiosityMechanisms:[],titleTokens:[],underperformingContrasts:[]};
 const sustainability=study.anatomy?.sustainability??{score:0,classification:'fragile' as const,rationale:'Análise anterior à métrica de sustentabilidade.',supportingSignals:[],riskSignals:['Reexecute a análise para calcular sustentabilidade com a metodologia atual.']};
 return {
  ...study,
  topSampleScope:study.topSampleScope??'global-search-candidates',
  comparisonSampleSize:study.comparisonSampleSize??0,
  weakRecentVideos:(study.weakRecentVideos??[]).map(video=>({...video,snapshots:video.snapshots??[],velocity:video.velocity??{baseline:true,deltaViews:null,deltaHours:null,viewsPerHour:null}})),
  sequences:study.sequences??[],
  topVideos:(study.topVideos??[]).map(video=>({...video,snapshots:video.snapshots??[],velocity:video.velocity??{baseline:true,deltaViews:null,deltaHours:null,viewsPerHour:null}})),
  metrics:{
   ...study.metrics,
   weakMedianViews:study.metrics?.weakMedianViews??null,
   hitToWeakMedianRatio:study.metrics?.hitToWeakMedianRatio??null,
   velocityTrackedVideos:study.metrics?.velocityTrackedVideos??0
  },
  thumbnailAnalysis:study.thumbnailAnalysis??{inspected:false,hitPatterns:[],weakPatterns:[],visualContrasts:[],compositionPatterns:[],textUsage:[],recurringSubjects:[],visualHooks:[],consistencySignals:[],limitations:['Análise anterior à inspeção visual de thumbnails.']},
  anatomy:{
   ...study.anatomy,
   commentDemand:study.anatomy?.commentDemand??{requestedTopics:[],repeatedQuestions:[],confusionPoints:[],emotionalTriggers:[],objectionsAndDebates:[]},
   topicGenome,
   sustainability,
   sequenceInsights:study.anatomy?.sequenceInsights??[],
   weakVideoContrasts:study.anatomy?.weakVideoContrasts??[]
  }
 };
}

export async function loadRadar():Promise<Pick<RadarData,'channels'|'channelStudies'|'opportunityReports'|'missionBrief'|'gaps'|'managedChannels'|'decisions'|'contexts'|'scripts'|'runs'|'settings'|'lastUpdated'>>{await cleanup();const [allChannels,allAnalyses,managedChannels,decisions,contexts,scripts,runs,config]=await Promise.all([list<RadarData['channels'][number]>('radar_channels',1000),optionalList<unknown>('radar_analyses',200),optionalList<RadarData['managedChannels'][number]>('radar_managed_channels'),list<RadarData['decisions'][number]>('radar_decisions'),list<RadarData['contexts'][number]>('radar_contexts'),list<RadarData['scripts'][number]>('radar_scripts'),list<RadarData['runs'][number]>('radar_runs',30),settings()]);const channelStudies=allAnalyses.filter((item):item is ChannelStudy=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='channel-study').map(normalizeChannelStudy);const opportunityReports=allAnalyses.filter((item):item is OpportunityReport=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='opportunity-report');const missionBrief=allAnalyses.find((item):item is MissionBrief=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='mission-brief')??null;const references=allChannels.filter(c=>c.discoverySource==='reference');const channels=allChannels.filter(c=>c.discoverySource==='reference-adjacent'&&qualifiesOpportunityCandidate(c,config));const gaps=buildOpportunityGaps([...references,...channels]);return {channels,channelStudies,opportunityReports,missionBrief,gaps,managedChannels,decisions,contexts,scripts,runs,settings:config,lastUpdated:channels[0]?.observedAt??references[0]?.observedAt??null};}




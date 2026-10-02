import 'server-only';

import { createHash } from 'node:crypto';
import type { OpportunityReport, UniverseMarketIntelligence } from '@/lib/types';
import {
  evaluateProductionAutonomy,
  type ProductionAutonomyAssessment,
  type ProductionAutonomyInput,
  type VisualSimulationTitle,
  type VisualSupplyEvidence
} from '@/lib/production-autonomy-policy';
import {
  productionAutonomySubjectKey,
  type ProductionAutonomySubject,
  type StoredProductionAutonomy
} from '@/lib/production-autonomy-contract';
import { checked, db, list } from './db';
import { HttpError } from './auth';

type SubjectInput=ProductionAutonomySubject;
type AssessmentRow={id:string;subject_key:string;source_fingerprint:string;status:string;payload:unknown;created_at:string;expires_at:string};

const now=()=>new Date();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const refs=(...values:unknown[])=>values.flatMap(value=>Array.isArray(value)?value:typeof value==='string'?[value]:[]).map(String).filter(Boolean);
const titleVariants=(values:string[],prefix:string)=>{
  const seen=new Set<string>(); const out:string[]=[];
  for(const value of values){const clean=String(value).trim();if(!clean)continue;const key=clean.toLowerCase();if(!seen.has(key)){seen.add(key);out.push(clean);}}
  for(let i=out.length;i<10;i++)out.push(prefix+' — evidence-led test '+String(i+1).padStart(2,'0'));
  return out.slice(0,Math.max(10,out.length));
};

function beatTitles(titles:string[],marketRefs:string[]):VisualSimulationTitle[]{
  return titles.map((title,index)=>{
    const duration=240;
    const beats=Array.from({length:Math.ceil(duration/4)},(_,beatIndex)=>({
      id:`title-${index+1}-beat-${beatIndex+1}`,durationSeconds:4,
      query:title, generationAllowed:false, factuality:'unknown' as const, evidenceRefs:marketRefs
    }));
    return {id:`title-${index+1}`,title,durationSeconds:duration,beats};
  });
}

function normalizeAsset(row:Record<string,unknown>,titles:VisualSimulationTitle[]):VisualSupplyEvidence|null{
  const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;
  const license=(payload.license&&typeof payload.license==='object'?payload.license:{}) as Record<string,unknown>;
  const stock=(payload.stock&&typeof payload.stock==='object'?payload.stock:{}) as Record<string,unknown>;
  const source=String(row.source_type??'owned')==='stock'?'stock':'owned';
  const sourceIdentity=source==='stock'&&stock.providerAssetId
    ?source+':'+String(stock.providerAssetId):String(row.id);
  const text=[row.original_name,row.title,row.tags,row.search_text,payload.prompt,payload.title,payload.assetTitle].filter(Boolean).join(' ').toLowerCase();
  const matches=titles.flatMap(title=>{
    const tokens=title.title.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>3);
    const relevance=tokens.length?tokens.filter(t=>text.includes(t)).length/tokens.length:0;
    return title.beats.filter(beat=>relevance>=.7).slice(0,1).map(beat=>({titleId:title.id,beatId:beat.id,relevance,identityVerified:false}));
  });
  const owned=source==='owned';
  return {id:String(row.id),sourceIdentity,source,kind:String(row.asset_kind)==='video'?'video':'image',
    ready:String(row.status??'ready')==='ready',availability:'available',storagePath:source==='owned'?String(row.storage_path??''):undefined,
    durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds??0),rights:source==='owned'||license.type==='owned'||license.type==='licensed'||license.type==='provider-terms'?'verified':'unknown',
    license:license.label?String(license.label):(owned?'Owned / operator supplied':null),provenanceRef:payload.provenanceRef?String(payload.provenanceRef):(owned?'asset:'+String(row.id):null),matches,maxUses:1};
}

async function loadSubject(subject:SubjectInput):Promise<{input:ProductionAutonomyInput;fingerprint:string}>{
  const analyses=await list<unknown>('radar_analyses',500);
  const market=analyses.find(item=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='universe-market-intelligence') as UniverseMarketIntelligence|undefined;
  const report=subject.subjectType==='opportunity-report'
    ?analyses.find(item=>!!item&&typeof item==='object'&&(item as {id?:string}).id===subject.subjectId) as OpportunityReport|undefined
    :undefined;
  let marketValidated=false; let marketStatus='unavailable'; let marketRefs:string[]=[]; let titles:string[]=[];
  if(subject.subjectType==='universe-gap'){
    const gap=market?.gaps.find(item=>item.id===subject.subjectId); const curve=gap&&market?.curves.find(item=>item.id===gap.curveId);
    marketValidated=!!gap&&!!curve&&curve.classification==='structural'&&gap.demandStatus==='observed';
    marketStatus=gap?.demandStatus??'unavailable'; marketRefs=refs(gap?.demandEvidence,curve?.evidence);
    titles=titleVariants(gap?.firstTests??[],gap?.title??'Validated market opportunity');
  }else if(subject.subjectType==='opportunity-report'){
    marketValidated=!!report&&report.validation.classification==='structural'&&report.viralDNA.demand.level!=='uncertain'&&report.viralDNA.repeatability.level!=='uncertain';
    marketStatus=report?.validation.classification??'unavailable'; marketRefs=refs(report?.evidence.topVideos.map(v=>v.id),report?.validation.evidence);
    titles=titleVariants([...(report?.channelConcept.firstEpisodes??[]),...(report?.transfers.flatMap(item=>item.titles)??[])],report?.title??'Validated market opportunity');
  }else{
    const row=checked(await db().from('radar_next_episode_plans').select('payload').eq('id',subject.subjectId).maybeSingle());
    const plan=(row?.payload??{}) as Record<string,unknown>; const context=(plan.context??{}) as Record<string,unknown>;
    const snapshot=Array.isArray(context.evidenceSnapshot)?context.evidenceSnapshot as Record<string,unknown>[]:[];
    marketRefs=snapshot.filter(item=>item.type==='market').map(item=>String(item.ref)).filter(Boolean);
    marketValidated=String(context.marketSignal??'unavailable')!=='unavailable'&&marketRefs.length>0;
    marketStatus=marketValidated?'validated':'unavailable';
    const candidate=Array.isArray(plan.candidates)?plan.candidates.find(item=>!!item&&typeof item==='object'&&String((item as Record<string,unknown>).id)===subject.candidateId) as Record<string,unknown>|undefined:undefined;
    titles=titleVariants(candidate?.workingTitle?[String(candidate.workingTitle)]:[],String(candidate?.workingTitle??'Next episode'));
  }
  const [sceneRows,ownedRows]=await Promise.all([
    db().from('radar_scene_assets').select('id,status,source_type,asset_kind,storage_path,original_name,duration_seconds,payload').eq('status','ready').limit(500),
    db().from('radar_owned_media_assets').select('id,status,source_type,asset_kind,storage_path,original_name,duration_seconds,title,tags,search_text,payload').eq('status','ready').limit(500)
  ]);
  if(sceneRows.error||ownedRows.error)throw new HttpError('Não foi possível consultar a biblioteca visual para o Production Autonomy Fit.',502);
  const rows=[...(sceneRows.data??[]),...(ownedRows.data??[])];
  const titleSet=beatTitles(titles,marketRefs);
  const supply=(rows??[]).map(row=>normalizeAsset(row as Record<string,unknown>,titleSet)).filter((item):item is VisualSupplyEvidence=>!!item);
  const input:ProductionAutonomyInput={
    market:{validated:marketValidated,status:marketStatus,evidenceRefs:marketRefs},
    titles:titleSet,supply,
    providers:[{id:'r2',status:process.env.R2_BUCKET?'available':'unknown',evidenceRef:process.env.R2_BUCKET?'env:R2_BUCKET':undefined},
      {id:'stock-media',status:'unknown'}],
    economics:{costUsd:null,cycleMinutes:null,operatorMinutes:null,evidenceRefs:[],basis:'unknown'},
    automation:['research','claims','script','voice','transcript','scenes','asset-sourcing','rights','timeline','render','quality','packaging','publish','learning'].map(stage=>({stage:stage as ProductionAutonomyInput['automation'][number]['stage'],status:'unknown' as const})),
    generation:{available:null},repeatability:[15,50,100].map(episodes=>({episodes:episodes as 15|50|100,distinctTitleCount:null,supplyCoveragePercent:null,evidenceRefs:[]}))};
  return {input,fingerprint:hash({subject,input})};
}

function asStored(subject:SubjectInput,input:ProductionAutonomyInput,fingerprint:string,assessment:ProductionAutonomyAssessment):StoredProductionAutonomy{
  const createdAt=now().toISOString(); const expiresAt=new Date(Date.now()+7*86400000).toISOString();
  return {...assessment,id:crypto.randomUUID(),subject,sourceFingerprint:fingerprint,createdAt,expiresAt,diagnostics:assessment.reasons.map(item=>item.message),input};
}

export function productionAutonomySummary(assessment:StoredProductionAutonomy){
  return {status:assessment.status,score:assessment.score,assessmentId:assessment.id,updatedAt:assessment.createdAt,reasons:assessment.reasons.slice(0,6).map(item=>item.message)};
}

export async function loadProductionAutonomy(subject:SubjectInput):Promise<StoredProductionAutonomy|null>{
  const key=productionAutonomySubjectKey(subject); let row:AssessmentRow|null;
  try{row=checked(await db().from('radar_production_autonomy_assessments').select('*').eq('subject_key',key).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle()) as AssessmentRow|null;}catch{return null;}
  return row?(row.payload as StoredProductionAutonomy):null;
}

export async function evaluateProductionAutonomyForSubject(subject:SubjectInput){
  const {input,fingerprint}=await loadSubject(subject); const assessment=asStored(subject,input,fingerprint,evaluateProductionAutonomy(input));
  checked(await db().from('radar_production_autonomy_assessments').insert({id:assessment.id,subject_key:productionAutonomySubjectKey(subject),source_fingerprint:fingerprint,status:assessment.status,payload:assessment,expires_at:assessment.expiresAt}));
  return assessment;
}

export async function enqueueProductionAutonomy(subject:SubjectInput){
  try{
    const key=productionAutonomySubjectKey(subject);
    const existing=await loadProductionAutonomy(subject); if(existing)return existing;
    const id=crypto.randomUUID();
    checked(await db().from('radar_production_autonomy_jobs').upsert({id,subject_key:key,subject,status:'queued',available_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'subject_key'}));
    return null;
  }catch{return null;}
}

type ClaimedProductionAutonomyJob={id:string;subject:SubjectInput;worker_token:string};
export async function claimProductionAutonomyJob(workerToken:string){
  const result=checked(await db().rpc('claim_production_autonomy_job',{p_worker_token:workerToken}));
  return result?(result as ClaimedProductionAutonomyJob):null;
}
export async function processClaimedProductionAutonomyJob(job:ClaimedProductionAutonomyJob){
  try{
    const assessment=await evaluateProductionAutonomyForSubject(job.subject);
    checked(await db().from('radar_production_autonomy_jobs').update({status:'completed',assessment_id:assessment.id,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('worker_token',job.worker_token));
    return assessment;
  }catch(error){
    await db().from('radar_production_autonomy_jobs').update({status:'failed',last_error:error instanceof Error?error.message.slice(0,500):'assessment failed',lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('worker_token',job.worker_token);
    throw error;
  }
}

export async function assertProductionAutonomyApproved(subject:SubjectInput){
  // Recompute at the authorization boundary. A cached score is useful for
  // dashboards, but it must never authorize a pilot after Market, assets,
  // rights or provider state have changed.
  const assessment=await evaluateProductionAutonomyForSubject(subject);
  if(assessment.status!=='approved')throw new HttpError(`Production Autonomy Fit ${assessment.status}: ${assessment.reasons.slice(0,3).map(item=>item.message).join(' · ')}`,409);
  return assessment;
}

export async function productionAutonomyForApi(subject:SubjectInput){
  const assessment=await loadProductionAutonomy(subject);
  return {assessment,summary:assessment?productionAutonomySummary(assessment):null};
}

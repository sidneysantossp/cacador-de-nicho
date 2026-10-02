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
import { providerSecret } from './providers';

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
const VISUAL_STOP_WORDS=new Set(['a','an','and','are','as','at','be','by','every','explained','for','from','has','have','how','in','into','is','it','need','of','on','or','the','to','type','types','what','why','with']);
const visualTokens=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,' ').split(/[^a-z0-9]+/).filter(Boolean).map(token=>token.length>4&&token.endsWith('s')?token.slice(0,-1):token).filter(token=>token.length>2&&!VISUAL_STOP_WORDS.has(token));
const visualRelevance=(query:string,text:string)=>{
  const wanted=[...new Set(visualTokens(query))]; if(!wanted.length)return 0;
  const hay=new Set(visualTokens(text)); const matched=wanted.filter(token=>hay.has(token)).length;
  if(!matched)return 0; const ratio=matched/wanted.length;
  return Math.min(1,.4+ratio*.6);
};
const visualQuery=(value:string)=>[...new Set(visualTokens(value))].join(' ').slice(0,100);
const distinctQueries=(values:string[])=>[...new Set(values.map(visualQuery).filter(Boolean))].slice(0,10);

function beatTitles(titles:string[],marketRefs:string[],queries:string[]):VisualSimulationTitle[]{
  return titles.map((title,index)=>{
    const duration=240;
    const titleQueries=distinctQueries([visualQuery(title),...queries]);
    const usable=titleQueries.length?titleQueries:[visualQuery(title)||title];
    const beats=Array.from({length:Math.ceil(duration/4)},(_,beatIndex)=>({
      id:`title-${index+1}-beat-${beatIndex+1}`,durationSeconds:4,
      query:usable[beatIndex%usable.length], generationAllowed:false, factuality:'not-required' as const, evidenceRefs:marketRefs
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
  const matches=titles.flatMap(title=>title.beats.flatMap(beat=>{
    const relevance=visualRelevance(beat.query,text);
    return relevance>=.7?[{titleId:title.id,beatId:beat.id,relevance,identityVerified:false}]:[];
  }));
  const owned=source==='owned';
  const ready=String(row.status??'ready')==='ready';
  const kind=String(row.asset_kind)==='video'?'video' as const:'image' as const;
  const duration=row.duration_seconds===null?null:Number(row.duration_seconds??0);
  const maxUses=kind==='video'&&duration&&duration>0?Math.max(1,Math.floor(duration/4)):1;
  const provider=String(row.provider??stock.provider??'stock-media');
  const licenseLabel=license.label?String(license.label):(owned?'Owned / operator supplied':null);
  const provenance=payload.provenanceRef?String(payload.provenanceRef):(owned?'asset:'+String(row.id):null);
  const licensingState=license.type==='owned'||license.type==='licensed'||license.type==='provider-terms'?'verified':license.type==='restricted'?'restricted':'unknown';
  return {id:String(row.id),sourceIdentity,source,kind,
    ready,availability:'available',storagePath:String(row.storage_path??'')||undefined,
    durationSeconds:duration,rights:source==='owned'||licensingState==='verified'?'verified':licensingState==='restricted'?'restricted':'unknown',
    license:licenseLabel,provenanceRef:provenance,matches,maxUses,
    discovery:source==='stock'&&!ready?{provider,sourceIdentity:stock.providerAssetId?sourceIdentity:null,licensingState,candidateRelevance:Math.max(...matches.map(match=>match.relevance),0),acquisition:payload.acquisition==='not-materializable'?'not-materializable':payload.acquisition==='materializable'?'materializable':'unknown',evidenceRef:provenance??undefined}:undefined};
}

function normalizeStockSearch(row:Record<string,unknown>,titles:VisualSimulationTitle[]):VisualSupplyEvidence[]{
  const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;
  const provider=String(row.provider??'stock-media');
  const raw=Array.isArray(payload.results)?payload.results:Array.isArray(payload.items)?payload.items:Array.isArray(payload.data)?payload.data:[];
  return raw.flatMap((item,index)=>{
    if(!item||typeof item!=='object')return [];
    const value=item as Record<string,unknown>;
    const identity=String(value.id??value.url??value.sourceIdentity??'').trim(); if(!identity)return [];
    const text=[row.query,value.title,value.description,value.tags].filter(Boolean).join(' ').toLowerCase();
    const matches=titles.flatMap(title=>title.beats.flatMap(beat=>{const relevance=visualRelevance(beat.query,text);return relevance>=.7?[{titleId:title.id,beatId:beat.id,relevance,identityVerified:false}]:[];}));
    const licenseValue=String(value.licenseType??value.license??'').toLowerCase();
    const licensingState=licenseValue.includes('restricted')?'restricted' as const:licenseValue.includes('commercial')||licenseValue.includes('free')||licenseValue.includes('provider')?'verified' as const:'unknown' as const;
    const acquisition=value.downloadUrl||value.download_url?'materializable' as const:'unknown' as const;
    return [{id:`stock-search:${String(row.id)}:${index}`,sourceIdentity:`${provider}:${identity}`,source:'stock' as const,kind:String(value.mediaKind??row.media_kind)==='video'?'video' as const:'image' as const,ready:false,availability:'available' as const,storagePath:undefined,durationSeconds:null,rights:'unknown' as const,license:null,provenanceRef:null,matches,maxUses:1,discovery:{provider,sourceIdentity:`${provider}:${identity}`,licensingState,candidateRelevance:Math.max(...matches.map(match=>match.relevance),0),acquisition,evidenceRef:`stock-search:${String(row.id)}`}}];
  });
}

type LiveStockDiscovery={
  supply:VisualSupplyEvidence[];
  providers:ProductionAutonomyInput['providers'];
  evidenceRefs:string[];
};

function discoveryMatches(titles:VisualSimulationTitle[],query:string,relevance:number){
  return titles.flatMap(title=>title.beats.filter(beat=>beat.query===query).map(beat=>({
    titleId:title.id,beatId:beat.id,relevance,identityVerified:false
  })));
}

async function discoverLiveStock(titles:VisualSimulationTitle[],queries:string[]):Promise<LiveStockDiscovery>{
  const supply:VisualSupplyEvidence[]=[]; const providers:ProductionAutonomyInput['providers']=[]; const evidenceRefs:string[]=[];
  const selected=distinctQueries(queries).slice(0,8);
  for(const provider of ['pexels','pixabay'] as const){
    let key:string;
    try{key=await providerSecret(provider);}catch{providers.push({id:provider,status:'unavailable',evidenceRef:`provider:${provider}:not-configured`});continue;}
    let successfulSearch=false;
    for(const query of selected){
      try{
        let items:Record<string,unknown>[]=[];
        if(provider==='pexels'){
          const params=new URLSearchParams({query,per_page:'12',page:'1',orientation:'landscape'});
          const response=await fetch('https://api.pexels.com/v1/videos/search?'+params,{headers:{Authorization:key},signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {videos?:Record<string,unknown>[]}; items=body.videos??[];
        }else{
          const params=new URLSearchParams({key,q:query,per_page:'20',safesearch:'true'});
          const response=await fetch('https://pixabay.com/api/videos/?'+params,{signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {hits?:Record<string,unknown>[]}; items=body.hits??[];
        }
        successfulSearch=true;
        for(const [index,item] of items.slice(0,12).entries()){
          const identity=String(item.id??'').trim(); if(!identity)continue;
          const pageUrl=String(item.url??item.pageURL??'').trim()||`provider:${provider}:${identity}`;
          const duration=Number(item.duration??0)||null;
          const relevance=Math.max(.7,.94-index*.02);
          const matches=discoveryMatches(titles,query,relevance); if(!matches.length)continue;
          const sourceIdentity=`${provider}:${identity}`;
          const license=provider==='pexels'?'Pexels License':'Pixabay Content License';
          const maxUses=duration?Math.max(1,Math.min(5,Math.floor(duration/4))):2;
          supply.push({id:`preflight:${sourceIdentity}:${visualQuery(query)}`,sourceIdentity,source:'stock',kind:'video',ready:false,
            availability:'available',durationSeconds:duration,rights:'unknown',license,provenanceRef:pageUrl,matches,maxUses,
            discovery:{provider,sourceIdentity,licensingState:'verified',candidateRelevance:relevance,acquisition:'materializable',evidenceRef:pageUrl}});
          evidenceRefs.push(pageUrl);
        }
      }catch{/* one provider query must not invalidate the whole preflight */}
    }
    providers.push(successfulSearch?{id:provider,status:'available',evidenceRef:`provider:${provider}:live-search`}:{id:provider,status:'unknown'});
  }
  return {supply,providers,evidenceRefs:[...new Set(evidenceRefs)].slice(0,50)};
}

async function loadSubject(subject:SubjectInput):Promise<{input:ProductionAutonomyInput;fingerprint:string}>{
  const analyses=await list<unknown>('radar_analyses',500);
  const market=analyses.find(item=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='universe-market-intelligence') as UniverseMarketIntelligence|undefined;
  const report=subject.subjectType==='opportunity-report'
    ?analyses.find(item=>!!item&&typeof item==='object'&&(item as {id?:string}).id===subject.subjectId) as OpportunityReport|undefined
    :undefined;
  let marketValidated=false; let marketStatus='unavailable'; let marketRefs:string[]=[]; let titles:string[]=[]; let visualQueries:string[]=[];
  if(subject.subjectType==='universe-gap'){
    const gap=market?.gaps.find(item=>item.id===subject.subjectId); const curve=gap&&market?.curves.find(item=>item.id===gap.curveId);
    marketValidated=!!gap&&!!curve&&curve.classification==='structural'&&gap.demandStatus==='observed';
    marketStatus=gap?.demandStatus??'unavailable'; marketRefs=refs(gap?.demandEvidence,curve?.evidence);
    const keywordTitles=(gap?.targetKeywords??[]).map(keyword=>keyword+' — explained');
    titles=titleVariants([...(gap?.firstTests??[]),...keywordTitles],gap?.title??'Validated market opportunity');
    visualQueries=distinctQueries([...(gap?.targetKeywords??[]),gap?.targetSpace??'',...(gap?.firstTests??[])]);
  }else if(subject.subjectType==='opportunity-report'){
    marketValidated=!!report&&report.validation.classification==='structural'&&report.viralDNA.demand.level!=='uncertain'&&report.viralDNA.repeatability.level!=='uncertain';
    marketStatus=report?.validation.classification??'unavailable'; marketRefs=refs(report?.evidence.topVideos.map(v=>v.id),report?.validation.evidence);
    titles=titleVariants([...(report?.channelConcept.firstEpisodes??[]),...(report?.transfers.flatMap(item=>item.titles)??[])],report?.title??'Validated market opportunity');
    visualQueries=distinctQueries(titles);
  }else{
    const row=checked(await db().from('radar_next_episode_plans').select('payload').eq('id',subject.subjectId).maybeSingle());
    const plan=(row?.payload??{}) as Record<string,unknown>; const context=(plan.context??{}) as Record<string,unknown>;
    const snapshot=Array.isArray(context.evidenceSnapshot)?context.evidenceSnapshot as Record<string,unknown>[]:[];
    marketRefs=snapshot.filter(item=>item.type==='market').map(item=>String(item.ref)).filter(Boolean);
    marketValidated=String(context.marketSignal??'unavailable')!=='unavailable'&&marketRefs.length>0;
    marketStatus=marketValidated?'validated':'unavailable';
    const candidate=Array.isArray(plan.candidates)?plan.candidates.find(item=>!!item&&typeof item==='object'&&String((item as Record<string,unknown>).id)===subject.candidateId) as Record<string,unknown>|undefined:undefined;
    titles=titleVariants(candidate?.workingTitle?[String(candidate.workingTitle)]:[],String(candidate?.workingTitle??'Next episode'));
    visualQueries=distinctQueries(titles);
  }
  const [sceneRows,ownedRows,stockSearchRows]=await Promise.all([
    db().from('radar_scene_assets').select('id,status,source_type,asset_kind,provider,storage_path,original_name,duration_seconds,payload').in('status',['ready','queued','processing']).limit(1000),
    db().from('radar_owned_media_assets').select('id,status,source_type,asset_kind,storage_path,original_name,duration_seconds,title,tags,search_text,payload').eq('status','ready').limit(500)
    ,db().from('radar_stock_searches').select('id,provider,media_kind,query,result_count,payload').order('created_at',{ascending:false}).limit(100)
  ]);
  if(sceneRows.error||ownedRows.error||stockSearchRows.error)throw new HttpError('Não foi possível consultar a biblioteca visual para o Production Autonomy Fit.',502);
  const rows=[...(sceneRows.data??[]),...(ownedRows.data??[])];
  if(!visualQueries.length)visualQueries=distinctQueries(titles);
  const titleSet=beatTitles(titles,marketRefs,visualQueries);
  const liveDiscovery=marketValidated?await discoverLiveStock(titleSet,visualQueries):{supply:[],providers:[],evidenceRefs:[]};
  const supply=[...(rows??[]).map(row=>normalizeAsset(row as Record<string,unknown>,titleSet)).filter((item):item is VisualSupplyEvidence=>!!item),...(stockSearchRows.data??[]).flatMap(row=>normalizeStockSearch(row as Record<string,unknown>,titleSet)),...liveDiscovery.supply];
  const representativeBeatIds=titleSet.slice(0,10).map(title=>title.beats[0]?.id).filter((id):id is string=>!!id);
  const materializedAssetCount=supply.filter(asset=>asset.ready&&asset.storagePath&&asset.provenanceRef&&asset.license).length;
  const discoverableAssetCount=supply.filter(asset=>asset.discovery).length;
  const measurements=rows.map(row=>{const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;const economics=(payload.economics&&typeof payload.economics==='object'?payload.economics:{}) as Record<string,unknown>;return {costUsd:Number(economics.costUsd),cycleMinutes:Number(economics.cycleMinutes),operatorMinutes:Number(economics.operatorMinutes),ref:economics.evidenceRef?String(economics.evidenceRef):`asset:${String(row.id)}`};}).filter(item=>Number.isFinite(item.costUsd)&&Number.isFinite(item.cycleMinutes)&&Number.isFinite(item.operatorMinutes)&&item.cycleMinutes>0&&item.operatorMinutes>=0);
  const economics=measurements.length?{costUsd:measurements.reduce((sum,item)=>sum+item.costUsd,0)/measurements.length,cycleMinutes:measurements.reduce((sum,item)=>sum+item.cycleMinutes,0)/measurements.length,operatorMinutes:measurements.reduce((sum,item)=>sum+item.operatorMinutes,0)/measurements.length,evidenceRefs:measurements.map(item=>item.ref),basis:'observed' as const}:{costUsd:null,cycleMinutes:null,operatorMinutes:null,evidenceRefs:[],basis:'unknown' as const};
  const input:ProductionAutonomyInput={
    market:{validated:marketValidated,status:marketStatus,evidenceRefs:marketRefs},
    titles:titleSet,supply,
    providers:[{id:'r2',status:process.env.R2_BUCKET?'available':'unknown',evidenceRef:process.env.R2_BUCKET?'env:R2_BUCKET':undefined},...liveDiscovery.providers],
    economics,
    automation:['research','claims','script','voice','transcript','scenes','asset-sourcing','rights','timeline','render','quality','packaging','publish','learning'].map(stage=>({stage:stage as ProductionAutonomyInput['automation'][number]['stage'],status:'unknown' as const})),
    generation:{available:null},repeatability:[15,50,100].map(episodes=>({episodes:episodes as 15|50|100,distinctTitleCount:null,supplyCoveragePercent:null,evidenceRefs:[]})),
    preflight:{status:marketValidated?'completed':'blocked',sampledBeatCount:representativeBeatIds.length,representativeBeatIds,materializedAssetCount,discoverableAssetCount,evidenceRefs:[...marketRefs,...liveDiscovery.evidenceRefs]}};
  return {input,fingerprint:hash({subject,input})};
}

function asStored(subject:SubjectInput,input:ProductionAutonomyInput,fingerprint:string,assessment:ProductionAutonomyAssessment):StoredProductionAutonomy{
  const createdAt=now().toISOString(); const expiresAt=new Date(Date.now()+7*86400000).toISOString();
  return {...assessment,id:crypto.randomUUID(),subject,sourceFingerprint:fingerprint,createdAt,expiresAt,diagnostics:assessment.reasons.map(item=>item.message),input};
}

export function productionAutonomySummary(assessment:StoredProductionAutonomy){
  return {status:assessment.status,supplyStatus:assessment.supplyStatus,score:assessment.score,assessmentId:assessment.id,updatedAt:assessment.createdAt,reasons:assessment.reasons.slice(0,6).map(item=>item.message)};
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

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
import { headMedia, putMedia, r2StoragePath } from './media-storage';
import { stockDownloadHostAllowed } from '@/lib/stock-media-policy';
import { autonomousAutomationPolicy } from '@/lib/episode-automation-policy';

type SubjectInput=ProductionAutonomySubject;
type AssessmentRow={id:string;subject_key:string;source_fingerprint:string;status:string;payload:unknown;created_at:string;expires_at:string};

const now=()=>new Date();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const refs=(...values:unknown[])=>values.flatMap(value=>Array.isArray(value)?value:typeof value==='string'?[value]:[]).map(String).filter(Boolean);
const titleVariants=(values:string[],prefix:string,minimum=10)=>{
  const seen=new Set<string>(); const out:string[]=[];
  for(const value of values){const clean=String(value).trim();if(!clean)continue;const key=clean.toLowerCase();if(!seen.has(key)){seen.add(key);out.push(clean);}}
  for(let i=out.length;i<minimum;i++)out.push(prefix+' — evidence-led test '+String(i+1).padStart(2,'0'));
  return out.slice(0,Math.max(minimum,out.length));
};
const VISUAL_STOP_WORDS=new Set(['a','an','and','are','as','at','be','by','every','explained','for','from','has','have','how','in','into','is','it','need','of','on','or','the','to','type','types','what','why','with']);
const visualTokens=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,' ').split(/[^a-z0-9]+/).filter(Boolean).map(token=>token.length>4&&token.endsWith('s')&&!token.endsWith('ss')?token.slice(0,-1):token).filter(token=>token.length>2&&!VISUAL_STOP_WORDS.has(token));
const visualRelevance=(query:string,text:string)=>{
  const wanted=[...new Set(visualTokens(query))]; if(!wanted.length)return 0;
  const hay=new Set(visualTokens(text)); const matched=wanted.filter(token=>hay.has(token)).length;
  if(!matched)return 0; const ratio=matched/wanted.length;
  return Math.min(1,.4+ratio*.6);
};
const visualQuery=(value:string)=>[...new Set(visualTokens(value))].join(' ').slice(0,100);
const distinctQueries=(values:string[])=>[...new Set(values.map(visualQuery).filter(Boolean))].slice(0,10);
const evidenceRowRef=(result:{data?:Array<Record<string,unknown>>|null;error?:unknown},table:string)=>{
  const row=result.error?null:result.data?.[0];
  return row?.id?`db:${table}:${String(row.id)}`:null;
};

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
  materialization:{
    attempted:number;
    succeeded:number;
    totalBytes:number;
    cycleSeconds:number;
    operatorMinutes:number;
    evidenceRefs:string[];
  };
};

const PREFLIGHT_SAMPLE_MAX_BYTES=80*1024*1024;
const PREFLIGHT_SAMPLE_TOTAL=4;
const R2_STANDARD_STORAGE_USD_PER_GB_MONTH=0.015;
const R2_CLASS_A_USD_PER_MILLION=4.5;
const R2_CLASS_B_USD_PER_MILLION=0.36;
const R2_PRICING_REF='https://developers.cloudflare.com/r2/pricing/';
const PEXELS_API_PRICING_REF='https://help.pexels.com/hc/en-us/articles/47677890260761-Is-the-Pexels-API-free-to-use';
const PIXABAY_API_PRICING_REF='https://pixabay.com/api/docs/';

async function safePreflightDownload(url:string,provider:'pexels'|'pixabay'){
  let current=new URL(url);
  for(let redirects=0;redirects<6;redirects++){
    if(current.protocol!=='https:'||!stockDownloadHostAllowed(provider,current.hostname))throw new Error('preflight-source-host-not-allowed');
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(120000),cache:'no-store'});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location'); if(!location)throw new Error('preflight-invalid-redirect');
      current=new URL(location,current); continue;
    }
    if(!response.ok)throw new Error('preflight-download-failed');
    const declared=Number(response.headers.get('content-length')??0);
    if(declared>PREFLIGHT_SAMPLE_MAX_BYTES)throw new Error('preflight-sample-too-large');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>PREFLIGHT_SAMPLE_MAX_BYTES)throw new Error('preflight-sample-too-large');
    return {bytes,mimeType:(response.headers.get('content-type')||'video/mp4').split(';')[0]||'video/mp4'};
  }
  throw new Error('preflight-too-many-redirects');
}

function sampleDownloadUrl(provider:'pexels'|'pixabay',kind:'image'|'video',item:Record<string,unknown>){
  if(kind==='image'){
    if(provider==='pexels'){
      const src=(item.src&&typeof item.src==='object'?item.src:{}) as Record<string,unknown>;
      return String(src.large2x??src.large??src.original??'')||null;
    }
    return String(item.largeImageURL??item.webformatURL??'')||null;
  }
  if(provider==='pexels'){
    const files=Array.isArray(item.video_files)?item.video_files as Record<string,unknown>[]:[];
    const usable=files
      .filter(file=>String(file.file_type??'').startsWith('video/mp4')&&typeof file.link==='string')
      .map(file=>({url:String(file.link),width:Number(file.width??0),bytes:Number(file.file_size??0)}))
      .filter(file=>!file.bytes||file.bytes<=PREFLIGHT_SAMPLE_MAX_BYTES)
      .sort((a,b)=>{
        const aw=a.width>0&&a.width<=1920?a.width:-a.width;
        const bw=b.width>0&&b.width<=1920?b.width:-b.width;
        return bw-aw;
      });
    return usable[0]?.url??null;
  }
  const videos=(item.videos&&typeof item.videos==='object'?item.videos:{}) as Record<string,Record<string,unknown>>;
  for(const key of ['medium','large','small','tiny']){
    const url=videos[key]?.url;
    if(typeof url==='string'&&url)return url;
  }
  return null;
}

async function materializePreflightSample(input:{
  provider:'pexels'|'pixabay';
  kind:'image'|'video';
  item:Record<string,unknown>;
  sourceIdentity:string;
  pageUrl:string;
  matches:VisualSupplyEvidence['matches'];
  durationSeconds:number|null;
  maxUses:number;
}):Promise<{asset:VisualSupplyEvidence;bytes:number;seconds:number;evidenceRef:string}|null>{
  const downloadUrl=sampleDownloadUrl(input.provider,input.kind,input.item);
  if(!downloadUrl)return null;
  try{await providerSecret('r2');}catch{return null;}
  const extension=input.kind==='image'?'.jpg':'.mp4';
  const key='production-autonomy/preflight/'+input.provider+'/'+input.sourceIdentity.split(':').slice(1).join(':')+extension;
  const storagePath=r2StoragePath(key);
  const started=Date.now();
  let bytes=0;
  try{
    const existing=await headMedia(storagePath);
    bytes=existing.bytes;
  }catch{
    const downloaded=await safePreflightDownload(downloadUrl,input.provider);
    bytes=downloaded.bytes.length;
    const persisted=await putMedia(key,downloaded.bytes,downloaded.mimeType,{cacheControl:'604800'});
    if(persisted!==storagePath)return null;
    await headMedia(storagePath);
  }
  const seconds=Math.max(.001,(Date.now()-started)/1000);
  const license=input.provider==='pexels'?'Pexels License':'Pixabay Content License';
  const licenseUrl=input.provider==='pexels'?'https://www.pexels.com/license/':'https://pixabay.com/service/license-summary/';
  return {
    asset:{
      id:'preflight-ready:'+input.sourceIdentity,
      sourceIdentity:input.sourceIdentity,
      source:'stock',
      kind:input.kind,
      ready:true,
      availability:'available',
      storagePath,
      durationSeconds:input.durationSeconds,
      rights:'verified',
      license,
      provenanceRef:input.pageUrl,
      matches:input.matches,
      maxUses:input.maxUses,
      discovery:{
        provider:input.provider,
        sourceIdentity:input.sourceIdentity,
        licensingState:'verified',
        candidateRelevance:Math.max(...input.matches.map(match=>match.relevance),0),
        acquisition:'materializable',
        evidenceRef:input.pageUrl
      }
    },
    bytes,seconds,
    evidenceRef:licenseUrl
  };
}

function discoveryMatches(titles:VisualSimulationTitle[],query:string,relevance:number){
  return titles.flatMap(title=>title.beats.flatMap(beat=>{
    const queryRelevance=visualRelevance(beat.query,query);
    return queryRelevance>=.7?[{titleId:title.id,beatId:beat.id,relevance:Math.min(relevance,queryRelevance),identityVerified:false}]:[];
  }));
}

async function discoverLiveStock(titles:VisualSimulationTitle[],queries:string[]):Promise<LiveStockDiscovery>{
  const supply:VisualSupplyEvidence[]=[]; const providers:ProductionAutonomyInput['providers']=[]; const evidenceRefs:string[]=[];
  const materialization={attempted:0,succeeded:0,totalBytes:0,cycleSeconds:0,operatorMinutes:0,evidenceRefs:[] as string[]};
  const providerSamples=new Map<'pexels'|'pixabay',number>();
  const selected=distinctQueries(queries).slice(0,10);
  for(const provider of ['pexels','pixabay'] as const){
    let key:string;
    try{key=await providerSecret(provider);}catch{providers.push({id:provider,status:'unavailable',evidenceRef:`provider:${provider}:not-configured`});continue;}
    let successfulSearch=false;
    for(const query of selected){
      try{
        let items:Record<string,unknown>[]=[];
        if(provider==='pexels'){
          const params=new URLSearchParams({query,per_page:'24',page:'1',orientation:'landscape'});
          const response=await fetch('https://api.pexels.com/v1/videos/search?'+params,{headers:{Authorization:key},signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {videos?:Record<string,unknown>[]}; items=body.videos??[];
        }else{
          const params=new URLSearchParams({key,q:query,per_page:'24',safesearch:'true'});
          const response=await fetch('https://pixabay.com/api/videos/?'+params,{signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {hits?:Record<string,unknown>[]}; items=body.hits??[];
        }
        successfulSearch=true;
        for(const [index,item] of items.slice(0,24).entries()){
          const identity=String(item.id??'').trim(); if(!identity)continue;
          const pageUrl=String(item.url??item.pageURL??'').trim()||`provider:${provider}:${identity}`;
          const duration=Number(item.duration??0)||null;
          const relevance=Math.max(.7,.94-index*.02);
          const matches=discoveryMatches(titles,query,relevance); if(!matches.length)continue;
          const sourceIdentity=`${provider}:${identity}`;
          const license=provider==='pexels'?'Pexels License':'Pixabay Content License';
          const maxUses=duration?Math.max(1,Math.min(5,Math.floor(duration/4))):2;
          let candidate:VisualSupplyEvidence={id:`preflight:${sourceIdentity}:${visualQuery(query)}`,sourceIdentity,source:'stock',kind:'video',ready:false,
            availability:'available',durationSeconds:duration,rights:'unknown',license,provenanceRef:pageUrl,matches,maxUses,
            discovery:{provider,sourceIdentity,licensingState:'verified',candidateRelevance:relevance,acquisition:'materializable',evidenceRef:pageUrl}};
          const providerSampleCount=providerSamples.get(provider)??0;
          if(index===0&&materialization.succeeded<PREFLIGHT_SAMPLE_TOTAL&&providerSampleCount<2){
            materialization.attempted++;
            const sample=await materializePreflightSample({provider,kind:'video',item,sourceIdentity,pageUrl,matches,durationSeconds:duration,maxUses});
            if(sample){
              candidate=sample.asset;
              materialization.succeeded++;
              materialization.totalBytes+=sample.bytes;
              materialization.cycleSeconds+=sample.seconds;
              materialization.evidenceRefs.push(sample.evidenceRef,pageUrl,candidate.storagePath??'');
              providerSamples.set(provider,providerSampleCount+1);
            }
          }
          supply.push(candidate);
          evidenceRefs.push(pageUrl);
        }
      }catch{/* one provider query must not invalidate the whole preflight */}
    }
    providers.push(successfulSearch?{id:provider,status:'available',evidenceRef:`provider:${provider}:live-search`}:{id:provider,status:'unknown'});
  }
  return {supply,providers,evidenceRefs:[...new Set(evidenceRefs)].slice(0,50),materialization:{...materialization,cycleSeconds:Math.round(materialization.cycleSeconds*1000)/1000,evidenceRefs:[...new Set(materialization.evidenceRefs)].filter(Boolean)}};
}

async function discoverLiveImages(titles:VisualSimulationTitle[],queries:string[]){
  const supply:VisualSupplyEvidence[]=[]; const evidenceRefs:string[]=[];
  const selected=distinctQueries(queries).slice(0,10);
  for(const provider of ['pexels','pixabay'] as const){
    let key:string;
    try{key=await providerSecret(provider);}catch{continue;}
    for(const query of selected){
      try{
        let items:Record<string,unknown>[]=[];
        if(provider==='pexels'){
          const params=new URLSearchParams({query,per_page:'24',page:'1',orientation:'landscape'});
          const response=await fetch('https://api.pexels.com/v1/search?'+params,{headers:{Authorization:key},signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {photos?:Record<string,unknown>[]}; items=body.photos??[];
        }else{
          const params=new URLSearchParams({key,q:query,per_page:'24',safesearch:'true',orientation:'horizontal'});
          const response=await fetch('https://pixabay.com/api/?'+params,{signal:AbortSignal.timeout(15000),cache:'no-store'});
          if(!response.ok)continue;
          const body=await response.json() as {hits?:Record<string,unknown>[]}; items=body.hits??[];
        }
        for(const [index,item] of items.slice(0,24).entries()){
          const identity=String(item.id??'').trim(); if(!identity)continue;
          const pageUrl=String(item.url??item.pageURL??'').trim()||`provider:${provider}:image:${identity}`;
          const relevance=Math.max(.7,.94-index*.02);
          const matches=discoveryMatches(titles,query,relevance); if(!matches.length)continue;
          const sourceIdentity=`${provider}:image:${identity}`;
          const license=provider==='pexels'?'Pexels License':'Pixabay Content License';
          supply.push({
            id:`preflight:${sourceIdentity}:${visualQuery(query)}`,
            sourceIdentity,source:'stock',kind:'image',ready:false,availability:'available',
            durationSeconds:null,rights:'unknown',license,provenanceRef:pageUrl,matches,maxUses:1,
            discovery:{provider,sourceIdentity,licensingState:'verified',candidateRelevance:relevance,acquisition:'materializable',evidenceRef:pageUrl}
          });
          evidenceRefs.push(pageUrl);
        }
      }catch{/* image discovery is supplementary and fail-closed */}
    }
  }
  return {supply,evidenceRefs:[...new Set(evidenceRefs)].slice(0,100)};
}

async function loadSubject(subject:SubjectInput):Promise<{input:ProductionAutonomyInput;fingerprint:string}>{
  const analyses=await list<unknown>('radar_analyses',500);
  const researchCapability=analyses.find(item=>{
    if(!item||typeof item!=='object')return false;
    const value=item as Record<string,unknown>;
    if(value.kind!=='production-autonomy-capability-evidence'||value.capability!=='research-claims'||value.status!=='completed')return false;
    if(String(value.subjectKey??'')!==productionAutonomySubjectKey(subject))return false;
    const sourceCount=Number(value.sourceCount??0);
    const supportedClaimCount=Number(value.supportedClaimCount??0);
    const observedAt=Date.parse(String(value.observedAt??''));
    return sourceCount>=3&&supportedClaimCount>=3&&Number.isFinite(observedAt)&&Date.now()-observedAt<=30*86400000;
  }) as Record<string,unknown>|undefined;
  const researchCapabilityRef=researchCapability
    ?'analysis:production-autonomy-capability:research-claims:'+String(researchCapability.observedAt)
    :undefined;
  const market=analyses.find(item=>!!item&&typeof item==='object'&&(item as {kind?:string}).kind==='universe-market-intelligence') as UniverseMarketIntelligence|undefined;
  const report=subject.subjectType==='opportunity-report'
    ?analyses.find(item=>!!item&&typeof item==='object'&&(item as {id?:string}).id===subject.subjectId) as OpportunityReport|undefined
    :undefined;
  let marketValidated=false; let marketStatus='unavailable'; let marketRefs:string[]=[]; let titles:string[]=[]; let visualQueries:string[]=[];
  if(subject.subjectType==='universe-gap'){
    const gap=market?.gaps.find(item=>item.id===subject.subjectId); const curve=gap&&market?.curves.find(item=>item.id===gap.curveId);
    marketValidated=!!gap&&!!curve&&curve.classification==='structural'&&gap.demandStatus==='observed';
    marketStatus=gap?.demandStatus??'unavailable'; marketRefs=refs(gap?.demandEvidence,curve?.evidence);
    const keywordTitles=(gap?.targetKeywords??[]).flatMap(keyword=>[
      keyword+' explained',
      'How '+keyword+' work'
    ]);
    titles=titleVariants([...(gap?.firstTests??[]),...keywordTitles],gap?.title??'Validated market opportunity',15).slice(0,15);
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
  const [
    sceneRows,ownedRows,stockSearchRows,
    scriptEvidence,voiceEvidence,transcriptEvidence,scenePlanEvidence,timelineEvidence,
    renderEvidence,qualityEvidence,packageEvidence,publishEvidence,learningEvidence,
    renderBenchmarks,priorAutonomyAssessments
  ]=await Promise.all([
    db().from('radar_scene_assets').select('id,status,source_type,asset_kind,provider,storage_path,original_name,duration_seconds,payload').in('status',['ready','queued','processing']).limit(1000),
    db().from('radar_owned_media_assets').select('id,status,source_type,asset_kind,storage_path,original_name,duration_seconds,title,tags,search_text,payload').eq('status','ready').limit(500),
    db().from('radar_stock_searches').select('id,provider,media_kind,query,result_count,payload').order('created_at',{ascending:false}).limit(100),
    db().from('radar_episode_scripts').select('id').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_voice_assets').select('id').eq('source_type','generated').eq('provider','elevenlabs').eq('status','ready').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_transcripts').select('id').eq('source_type','alignment').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_scene_plans').select('id').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_timelines').select('id').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_render_jobs').select('id').eq('status','completed').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_production_quality_reports').select('id').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_publication_packages').select('id').eq('status','approved').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_youtube_publish_jobs').select('id').eq('status','completed').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_learning_loop_jobs').select('id').eq('status','completed').order('updated_at',{ascending:false}).limit(1),
    db().from('radar_render_jobs').select('id,payload').eq('status','completed').order('updated_at',{ascending:false}).limit(20),
    db().from('radar_production_autonomy_assessments').select('id,payload').eq('subject_key',productionAutonomySubjectKey(subject)).order('created_at',{ascending:false}).limit(20)
  ]);
  if(sceneRows.error||ownedRows.error||stockSearchRows.error)throw new HttpError('Não foi possível consultar a biblioteca visual para o Production Autonomy Fit.',502);
  const rows=[...(sceneRows.data??[]),...(ownedRows.data??[])];
  if(!visualQueries.length)visualQueries=distinctQueries(titles);
  const titleSet=beatTitles(titles,marketRefs,visualQueries);
  const liveDiscovery=marketValidated?await discoverLiveStock(titleSet,visualQueries):{supply:[],providers:[],evidenceRefs:[],materialization:{attempted:0,succeeded:0,totalBytes:0,cycleSeconds:0,operatorMinutes:0,evidenceRefs:[]}};
  const liveImages=marketValidated?await discoverLiveImages(titleSet,visualQueries):{supply:[],evidenceRefs:[]};
  const supply=[...(rows??[]).map(row=>normalizeAsset(row as Record<string,unknown>,titleSet)).filter((item):item is VisualSupplyEvidence=>!!item),...(stockSearchRows.data??[]).flatMap(row=>normalizeStockSearch(row as Record<string,unknown>,titleSet)),...liveDiscovery.supply,...liveImages.supply];
  const representativeBeatIds=titleSet.slice(0,10).map(title=>title.beats[0]?.id).filter((id):id is string=>!!id);
  const materializedAssetCount=supply.filter(asset=>asset.ready&&asset.storagePath&&asset.provenanceRef&&asset.license).length;
  const discoverableAssetCount=supply.filter(asset=>asset.discovery).length;
  const measurements=rows.map(row=>{const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;const economics=(payload.economics&&typeof payload.economics==='object'?payload.economics:{}) as Record<string,unknown>;return {costUsd:Number(economics.costUsd),cycleMinutes:Number(economics.cycleMinutes),operatorMinutes:Number(economics.operatorMinutes),ref:economics.evidenceRef?String(economics.evidenceRef):`asset:${String(row.id)}`};}).filter(item=>Number.isFinite(item.costUsd)&&Number.isFinite(item.cycleMinutes)&&Number.isFinite(item.operatorMinutes)&&item.cycleMinutes>0&&item.operatorMinutes>=0);
  let economics:ProductionAutonomyInput['economics']=measurements.length?{costUsd:measurements.reduce((sum,item)=>sum+item.costUsd,0)/measurements.length,cycleMinutes:measurements.reduce((sum,item)=>sum+item.cycleMinutes,0)/measurements.length,operatorMinutes:measurements.reduce((sum,item)=>sum+item.operatorMinutes,0)/measurements.length,evidenceRefs:measurements.map(item=>item.ref),basis:'observed'}:{costUsd:null,cycleMinutes:null,operatorMinutes:null,evidenceRefs:[],basis:'unknown'};
  if(!measurements.length&&marketValidated){
    const historicalSamples=(priorAutonomyAssessments.error?[]:priorAutonomyAssessments.data??[]).flatMap(row=>{
      const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;
      const preflight=(payload.preflight&&typeof payload.preflight==='object'?payload.preflight:{}) as Record<string,unknown>;
      const materialization=(preflight.materialization&&typeof preflight.materialization==='object'?preflight.materialization:{}) as Record<string,unknown>;
      const succeeded=Number(materialization.succeeded??0);
      const totalBytes=Number(materialization.totalBytes??0);
      const cycleSeconds=Number(materialization.cycleSeconds??0);
      return succeeded>0&&totalBytes>0&&cycleSeconds>0?[{succeeded,totalBytes,cycleSeconds,evidenceRef:`db:radar_production_autonomy_assessments:${String(row.id)}`}]:[];
    });
    const currentSample=liveDiscovery.materialization.succeeded>0&&liveDiscovery.materialization.totalBytes>0&&liveDiscovery.materialization.cycleSeconds>0
      ?[{succeeded:liveDiscovery.materialization.succeeded,totalBytes:liveDiscovery.materialization.totalBytes,cycleSeconds:liveDiscovery.materialization.cycleSeconds,evidenceRef:'preflight:current-materialization'}]:[];
    const coldSample=[...historicalSamples,...currentSample].sort((a,b)=>(b.cycleSeconds/b.succeeded)-(a.cycleSeconds/a.succeeded))[0];
    const renderSamples=(renderBenchmarks.error?[]:renderBenchmarks.data??[]).flatMap(row=>{
      const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;
      const metrics=(payload.metrics&&typeof payload.metrics==='object'?payload.metrics:{}) as Record<string,unknown>;
      const realTimeFactor=Number(metrics.realTimeFactor??0);
      return realTimeFactor>0&&Number.isFinite(realTimeFactor)?[{realTimeFactor,evidenceRef:`db:radar_render_jobs:${String(row.id)}`}]:[];
    }).sort((a,b)=>a.realTimeFactor-b.realTimeFactor);
    const renderSample=renderSamples.length?renderSamples[Math.floor(renderSamples.length/2)]:null;
    if(coldSample&&renderSample){
      const targetDurationSeconds=titleSet[0]?.durationSeconds??240;
      const beatsPerEpisode=Math.ceil(targetDurationSeconds/4);
      const averageAssetBytes=coldSample.totalBytes/coldSample.succeeded;
      const averageAssetSeconds=coldSample.cycleSeconds/coldSample.succeeded;
      const projectedStorageGb=averageAssetBytes*beatsPerEpisode/1_000_000_000;
      const projectedStorageCost=projectedStorageGb*R2_STANDARD_STORAGE_USD_PER_GB_MONTH;
      const projectedOperationsCost=beatsPerEpisode/1_000_000*(R2_CLASS_A_USD_PER_MILLION+R2_CLASS_B_USD_PER_MILLION);
      const acquisitionMinutes=averageAssetSeconds*beatsPerEpisode/60;
      const renderMinutes=targetDurationSeconds*renderSample.realTimeFactor/60;
      economics={
        costUsd:Math.round((projectedStorageCost+projectedOperationsCost)*10000)/10000,
        cycleMinutes:Math.round((acquisitionMinutes+renderMinutes)*100)/100,
        operatorMinutes:liveDiscovery.materialization.operatorMinutes,
        evidenceRefs:[
          coldSample.evidenceRef,renderSample.evidenceRef,R2_PRICING_REF,
          PEXELS_API_PRICING_REF,PIXABAY_API_PRICING_REF,
          ...liveDiscovery.materialization.evidenceRefs.slice(0,6)
        ],
        basis:'quoted'
      };
    }
  }
  let r2Status:ProductionAutonomyInput['providers'][number]={id:'r2',status:'unknown'};
  try{await providerSecret('r2');r2Status={id:'r2',status:'available',evidenceRef:'provider:r2:configured'};}catch{}

  const scriptRef=evidenceRowRef(scriptEvidence as never,'radar_episode_scripts');
  const voiceRef=evidenceRowRef(voiceEvidence as never,'radar_voice_assets');
  const transcriptRef=evidenceRowRef(transcriptEvidence as never,'radar_transcripts');
  const scenePlanRef=evidenceRowRef(scenePlanEvidence as never,'radar_scene_plans');
  const timelineRef=evidenceRowRef(timelineEvidence as never,'radar_timelines');
  const renderRef=evidenceRowRef(renderEvidence as never,'radar_render_jobs');
  const qualityRef=evidenceRowRef(qualityEvidence as never,'radar_production_quality_reports');
  const packageRef=evidenceRowRef(packageEvidence as never,'radar_publication_packages');
  const publishRef=evidenceRowRef(publishEvidence as never,'radar_youtube_publish_jobs');
  const learningRef=evidenceRowRef(learningEvidence as never,'radar_learning_loop_jobs');
  const stockEvidenceRef=liveDiscovery.materialization.succeeded>0
    ?liveDiscovery.materialization.evidenceRefs.find(ref=>ref.startsWith('r2:'))??'preflight:stock-materialization'
    :undefined;
  const rightsEvidenceRef=liveDiscovery.materialization.succeeded>0
    ?liveDiscovery.materialization.evidenceRefs.find(ref=>ref.includes('/license')||ref.includes('license-summary'))??'preflight:stock-rights'
    :undefined;
  const automatic=(stage:ProductionAutonomyInput['automation'][number]['stage'],enabled:boolean,evidenceRef:string|null|undefined):ProductionAutonomyInput['automation'][number]=>
    enabled&&evidenceRef?{stage,status:'automatic',evidenceRef}:{stage,status:'unknown'};
  const automation:ProductionAutonomyInput['automation']=[
    researchCapabilityRef?{stage:'research',status:'automatic',evidenceRef:researchCapabilityRef}:{stage:'research',status:'unknown'},
    researchCapabilityRef?{stage:'claims',status:'automatic',evidenceRef:researchCapabilityRef}:{stage:'claims',status:'unknown'},
    automatic('script',autonomousAutomationPolicy.autoGenerateScript,scriptRef),
    automatic('voice',autonomousAutomationPolicy.autoGenerateVoice,voiceRef),
    automatic('transcript',autonomousAutomationPolicy.autoCreateTranscript,transcriptRef),
    automatic('scenes',autonomousAutomationPolicy.autoCreateScenes,scenePlanRef),
    automatic('asset-sourcing',autonomousAutomationPolicy.autoGenerateVisualAssets,stockEvidenceRef),
    automatic('rights',autonomousAutomationPolicy.autoGenerateVisualAssets,rightsEvidenceRef),
    automatic('timeline',autonomousAutomationPolicy.autoBuildTimeline,timelineRef),
    automatic('render',autonomousAutomationPolicy.autoRender,renderRef),
    automatic('quality',autonomousAutomationPolicy.autoRunQuality,qualityRef),
    automatic('packaging',autonomousAutomationPolicy.autoCreatePackage,packageRef),
    publishRef?{stage:'publish',status:'automatic',evidenceRef:publishRef}:{stage:'publish',status:'unknown'},
    learningRef?{stage:'learning',status:'automatic',evidenceRef:learningRef}:{stage:'learning',status:'unknown'}
  ];

  const input:ProductionAutonomyInput={
    market:{validated:marketValidated,status:marketStatus,evidenceRefs:marketRefs},
    titles:titleSet,supply,
    providers:[r2Status,...liveDiscovery.providers],
    economics,
    automation,
    generation:{available:null},repeatability:[15,50,100].map(episodes=>({episodes:episodes as 15|50|100,distinctTitleCount:null,supplyCoveragePercent:null,evidenceRefs:[]})),
    preflight:{status:marketValidated?'completed':'blocked',sampledBeatCount:representativeBeatIds.length,representativeBeatIds,materializedAssetCount,discoverableAssetCount,materialization:liveDiscovery.materialization,evidenceRefs:[...marketRefs,...liveDiscovery.evidenceRefs,...liveImages.evidenceRefs,...liveDiscovery.materialization.evidenceRefs]}};
  return {input,fingerprint:hash({subject,input})};
}

const MAX_PERSISTED_SUPPLY_CANDIDATES=180;
const MAX_PERSISTED_MATCHES_PER_SUPPLY=8;

function compactInputForPersistence(input:ProductionAutonomyInput,assessment:ProductionAutonomyAssessment):ProductionAutonomyInput{
  const allocatedIds=new Set(
    assessment.coverage.allocations
      .map(item=>item.assetId)
      .filter((id):id is string=>!!id)
  );
  const allocatedBeatKeys=new Map<string,Set<string>>();
  for(const allocation of assessment.coverage.allocations){
    if(!allocation.assetId)continue;
    const beats=allocatedBeatKeys.get(allocation.assetId)??new Set<string>();
    beats.add(allocation.titleId+'\u0000'+allocation.beatId);
    allocatedBeatKeys.set(allocation.assetId,beats);
  }
  const priority=(asset:VisualSupplyEvidence)=>{
    if(allocatedIds.has(asset.id))return 0;
    if(asset.ready)return 1;
    if(asset.discovery?.licensingState==='verified'&&asset.discovery.acquisition==='materializable')return 2;
    return 3;
  };
  const persistedSupply=[...input.supply]
    .sort((a,b)=>priority(a)-priority(b))
    .slice(0,MAX_PERSISTED_SUPPLY_CANDIDATES)
    .map(asset=>{
      const allocated=allocatedBeatKeys.get(asset.id);
      const selectedMatches=[
        ...asset.matches.filter(match=>allocated?.has(match.titleId+'\u0000'+match.beatId)),
        ...asset.matches.filter(match=>!allocated?.has(match.titleId+'\u0000'+match.beatId))
      ].slice(0,MAX_PERSISTED_MATCHES_PER_SUPPLY);
      return {...asset,matches:selectedMatches};
    });
  return {...input,supply:persistedSupply};
}

function asStored(subject:SubjectInput,input:ProductionAutonomyInput,fingerprint:string,assessment:ProductionAutonomyAssessment):StoredProductionAutonomy{
  const createdAt=now().toISOString(); const expiresAt=new Date(Date.now()+7*86400000).toISOString();
  const persistedInput=compactInputForPersistence(input,assessment);
  return {...assessment,id:crypto.randomUUID(),subject,sourceFingerprint:fingerprint,createdAt,expiresAt,diagnostics:assessment.reasons.map(item=>item.message),input:persistedInput};
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
  const loaded=await loadSubject(subject);
  const input=loaded.input;
  const preliminary=evaluateProductionAutonomy(input);
  if(subject.subjectType==='universe-gap'&&preliminary.marketEligible){
    const distinctTitleCount=new Set(input.titles.map(title=>title.title.trim().toLowerCase())).size;
    if(distinctTitleCount>=15){
      input.repeatability=input.repeatability.map(item=>item.episodes===15?{
        episodes:15,
        distinctTitleCount,
        supplyCoveragePercent:preliminary.coverage.projectedAutonomousCoverage.percent,
        evidenceRefs:[
          'repeatability:15-title-simulation:'+subject.subjectId,
          ...input.preflight?.evidenceRefs.slice(0,5)??[]
        ]
      }:item);
    }
  }
  const fingerprint=hash({subject,input});
  const assessment=asStored(subject,input,fingerprint,evaluateProductionAutonomy(input));
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

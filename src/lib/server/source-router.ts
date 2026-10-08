import 'server-only';

import { createHash } from 'node:crypto';

import { checked, db } from './db';
import { HttpError } from './auth';
import { downloadMedia } from './media-storage';
import { verifyStillImageWithOpenAI, type ImageVerification } from './visual-image-verification';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { loadScenePlan } from './scene-timecode';
import { loadProductionDna } from './production-dna';
import {
  deleteSceneAsset, generateGoogleImage, resolveOwnedMediaForScene, selectSceneAsset
} from './asset-factory';
import {
  importStockMedia, searchStockMedia, stockProviderSearchShouldTrip
} from './stock-media';
import {
  enqueueVerifiedStockJob, loadVerifiedStockJob, restartVerifiedStockJob
} from './verified-stock-jobs';
import {
  rankStockMediaResults, STOCK_DISCOVERY_POLICY_VERSION, stockDiscoveryQuery,
  verifiedStockGapNeedsTransientRecovery, verifiedStockGapNeedsVisualModelRecovery
} from '@/lib/stock-media-policy';
import {
  applyDocumentarySourcePolicy, archiveTemporalEvidence, routePrefersMotion, sourceReuseDecision,
  sourceRouteExecutionKey, sourceRouteForScene, sourceRouteRequiresAuthenticEvidence,
  VIDEO_FIRST_FALLBACK_POLICY_VERSION, type SourceRouteAction, type SourceRoutePlan
} from '@/lib/source-router-policy';
import type { SceneAsset, StockMediaProvider } from '@/lib/types';
import {
  isYouTubeSearchQuotaError, searchYouTubeCreativeCommonsSources
} from './youtube';
import {
  visualGenerationBudgetDecision, type VisualCostSnapshot
} from '@/lib/production-cost-policy';
import { stockVisualProxyQuery } from '@/lib/stock-visual-proxy-policy';
import { scoreVisualSegment } from '@/lib/media-library-policy';
import { ensureSceneAssetVisualQa } from './visual-asset-preflight';

const STOCK_IMAGE_PROVIDERS:StockMediaProvider[]=['vecteezy','pexels','pixabay'];
const STOCK_VIDEO_PROVIDERS:StockMediaProvider[]=['vecteezy','pexels','pixabay'];
const AUTOMATION_STOCK_CANDIDATES_PER_PROVIDER=(()=>{
  const value=Number(process.env.AUTOMATION_STOCK_CANDIDATES_PER_PROVIDER??1);
  return Number.isFinite(value)?Math.max(1,Math.min(3,Math.floor(value))):1;
})();

const VISUAL_EPISODE_BUDGET_USD=(()=>{
  const value=Number(process.env.AUTOMATION_VISUAL_EPISODE_BUDGET_USD??.50);
  return Number.isFinite(value)?Math.max(0,Math.min(100,value)):.50;
})();
const GOOGLE_IMAGE_ESTIMATED_COST_USD=(()=>{
  const value=Number(process.env.AUTOMATION_GOOGLE_IMAGE_ESTIMATED_COST_USD);
  return Number.isFinite(value)&&value>=0?value:null;
})();

async function visualCostSnapshot(promptSetId:string):Promise<VisualCostSnapshot>{
  const rows=checked(await db().from('radar_scene_assets')
    .select('source_type,status,payload')
    .eq('visual_prompt_set_id',promptSetId)
    .limit(5000));
  let incurredUsd=0;
  let unknownPaidAssets=0;
  let paidAssetCount=0;

  for(const row of rows??[]){
    if(row.source_type!=='generated')continue;
    const status=String(row.status??'');
    if(status==='failed'||status==='rejected')continue;
    paidAssetCount++;
    const payload=(row.payload??{}) as Record<string,unknown>;
    const raw=payload.costUsd;
    if(typeof raw==='number'&&Number.isFinite(raw)&&raw>=0){
      incurredUsd+=raw;
    }else{
      unknownPaidAssets++;
    }
  }
  return {incurredUsd,unknownPaidAssets,paidAssetCount};
}

async function imageAsset(assetId:string){
  const row=checked(await db().from('radar_scene_assets')
    .select('id,asset_kind,status,storage_path,mime_type,bytes,payload')
    .eq('id',assetId).maybeSingle());
  if(!row)throw new HttpError('Asset visual não encontrado para validação.',404);
  if(row.asset_kind!=='image'||row.status!=='ready'||!row.storage_path){
    throw new HttpError('A validação still-image exige uma imagem pronta.',409);
  }
  return row;
}


async function verifyStillImage(assetId:string,query:string):Promise<ImageVerification>{
  const asset=await imageAsset(assetId);
  const bytes=await downloadMedia(String(asset.storage_path));
  if(!bytes.length)throw new HttpError('A imagem ficou vazia durante a validação visual.',502);
  return verifyStillImageWithOpenAI({bytes,mimeType:String(asset.mime_type||'image/jpeg'),query});
}

async function persistImageVerification(assetId:string,query:string,verification:ImageVerification){
  const row=checked(await db().from('radar_scene_assets').select('payload').eq('id',assetId).maybeSingle());
  const payload=(row?.payload??{}) as Record<string,unknown>;
  checked(await db().from('radar_scene_assets').update({
    payload:{
      ...payload,
      sourceRouterVerification:{
        query,
        model:verification.model,
        relevance:verification.relevance,
        qualityScore:verification.qualityScore,
        editorialUsefulness:verification.editorialUsefulness,
        summary:verification.summary,
        matchedEvidence:verification.matchedEvidence,
        mismatchReason:verification.mismatchReason,
        focusX:verification.focusX,
        focusY:verification.focusY,
        focusLabel:verification.focusLabel,
        placeholderLike:verification.placeholderLike,
        templateLike:verification.templateLike,
        staticGraphic:verification.staticGraphic,
        visualClass:verification.visualClass,
        issues:verification.issues,
        verifiedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',assetId));
}

async function markVideoFirstFallback(input:{
  assetId:string;
  query:string;
  stockJobId?:string|null;
}){
  const row=checked(await db().from('radar_scene_assets')
    .select('payload').eq('id',input.assetId).maybeSingle());
  const payload=(row?.payload??{}) as Record<string,unknown>;
  checked(await db().from('radar_scene_assets').update({
    payload:{
      ...payload,
      videoFirstFallback:{
        policyVersion:VIDEO_FIRST_FALLBACK_POLICY_VERSION,
        videoExhausted:true,
        reason:'stock-video-exhausted',
        query:input.query,
        stockJobId:input.stockJobId??null,
        acceptedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',input.assetId));
}

async function markSourceRouteTerminal(input:{
  stockJobId:string;
  route:SourceRoutePlan;
  sourceQuery:string;
  status:'gap'|'operator-source-required';
  action:SourceRouteAction|null;
  reason:string;
}){
  const row=checked(await db().from('radar_verified_stock_jobs')
    .select('result')
    .eq('id',input.stockJobId)
    .maybeSingle());
  const result=row?.result&&typeof row.result==='object'
    ?row.result as Record<string,unknown>
    :{};
  checked(await db().from('radar_verified_stock_jobs').update({
    result:{
      ...result,
      sourceRouteTerminal:{
        key:sourceRouteExecutionKey(input.route,input.sourceQuery),
        status:input.status,
        action:input.action,
        reason:input.reason,
        completedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',input.stockJobId));
}

async function revalidateExistingUploadedStill(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
}){
  const promptSet=await loadVisualPromptSet(input.promptSetId);
  if(!promptSet)return null;
  const visual=promptSet.scenePrompts.find(item=>item.sceneId===input.sceneId);
  if(!visual)return null;
  const row=checked(await db().from('radar_scene_assets')
    .select('id,source_type,asset_kind,status,selected,payload')
    .eq('visual_prompt_set_id',input.promptSetId)
    .eq('scene_id',input.sceneId)
    .eq('selected',true)
    .eq('status','ready')
    .maybeSingle());
  if(!row||row.source_type!=='uploaded'||row.asset_kind!=='image'||!row.selected)return null;

  const verification=await verifyStillImage(String(row.id),input.query);
  await persistImageVerification(String(row.id),input.query,verification);
  if(verification.relevance<.46)return {status:'rejected' as const,verification};

  const fresh=checked(await db().from('radar_scene_assets')
    .select('payload').eq('id',String(row.id)).maybeSingle());
  const payload=(fresh?.payload??row.payload??{}) as Record<string,unknown>;
  checked(await db().from('radar_scene_assets').update({
    payload:{
      ...payload,
      promptSetVersion:promptSet.version,
      prompt:visual.prompt,
      sourceRouterRevalidatedAt:new Date().toISOString()
    },
    updated_at:new Date().toISOString()
  }).eq('id',String(row.id)));
  return {status:'matched' as const,assetId:String(row.id),verification};
}

async function selectedStockReuseObservations(
  promptSetId:string,
  sequenceByScene:Map<string,number>
){
  const rows=checked(await db().from('radar_scene_assets')
    .select('scene_id,provider,payload')
    .eq('visual_prompt_set_id',promptSetId)
    .eq('source_type','stock')
    .eq('selected',true)
    .eq('status','ready')
    .limit(1000));
  const uses=new Map<string,Array<{
    sceneSequence:number;
    sourceStartSeconds?:number|null;
    sourceEndSeconds?:number|null;
  }>>();
  for(const row of rows??[]){
    const payload=(row.payload??{}) as Record<string,unknown>;
    const stock=payload.stock&&typeof payload.stock==='object'
      ?payload.stock as Record<string,unknown>
      :{};
    const verified=payload.verifiedStock&&typeof payload.verifiedStock==='object'
      ?payload.verifiedStock as Record<string,unknown>
      :{};
    const providerAssetId=String(stock.providerAssetId??verified.providerAssetId??'').trim();
    const provider=String(verified.provider??row.provider??'').trim();
    const sceneSequence=sequenceByScene.get(String(row.scene_id));
    if(!provider||!providerAssetId||!Number.isFinite(sceneSequence))continue;
    const key=provider+':'+providerAssetId;
    const observations=uses.get(key)??[];
    observations.push({
      sceneSequence:Number(sceneSequence),
      sourceStartSeconds:verified.sourceStartSeconds===undefined?null:Number(verified.sourceStartSeconds),
      sourceEndSeconds:verified.sourceEndSeconds===undefined?null:Number(verified.sourceEndSeconds)
    });
    uses.set(key,observations);
  }
  return uses;
}

async function resolveStillCandidates(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
  provider:StockMediaProvider;
  minimumRelevance:number;
  requireTemporalProvenance?:boolean;
  targetSequence:number;
  stockUses:Map<string,Array<{
    sceneSequence:number;
    sourceStartSeconds?:number|null;
    sourceEndSeconds?:number|null;
  }>>;
}){
  const discovered=await searchStockMedia({
    promptSetId:input.promptSetId,
    sceneId:input.sceneId,
    provider:input.provider,
    kind:'image',
    query:stockDiscoveryQuery(input.query),
    orientation:'landscape'
  });
  const ranked=rankStockMediaResults({
    query:input.query,
    results:discovered.results,
    desiredDurationSeconds:5,
    orientation:'landscape'
  }).slice(0,4);
  const attempts:Array<Record<string,unknown>>=[];

  for(const candidate of ranked){
    const reuse=sourceReuseDecision({
      sourceType:'stock',
      targetSequence:input.targetSequence,
      observations:input.stockUses.get(
        input.provider+':'+candidate.result.providerAssetId
      )??[]
    });
    if(!reuse.ok){
      attempts.push({
        provider:input.provider,
        providerAssetId:candidate.result.providerAssetId,
        stage:'source-diversity',
        reason:reuse.reason,
        usageCount:reuse.usageCount,
        maxUses:reuse.maxUses
      });
      continue;
    }

    let asset:SceneAsset|null=null;
    try{
      if(input.requireTemporalProvenance){
        const temporal=archiveTemporalEvidence({
          query:input.query,
          sourceDate:candidate.result.sourceDate,
          title:candidate.result.title
        });
        if(!temporal.ok){
          attempts.push({
            provider:input.provider,
            providerAssetId:candidate.result.providerAssetId,
            stage:'temporal-provenance',
            sourceDate:candidate.result.sourceDate??null,
            title:candidate.result.title,
            ...temporal
          });
          continue;
        }
      }

      asset=await importStockMedia({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        provider:input.provider,
        kind:'image',
        providerAssetId:candidate.result.providerAssetId,
        selectIfNone:false
      });
      if(!asset)continue;
      const verification=await verifyStillImage(asset.id,input.query);
      await persistImageVerification(asset.id,input.query,verification);
      const combined=candidate.score*.35+verification.relevance*.65;
      attempts.push({
        provider:input.provider,
        providerAssetId:candidate.result.providerAssetId,
        searchScore:candidate.score,
        visualRelevance:verification.relevance,
        combinedScore:combined,
        summary:verification.summary
      });
      if(verification.relevance>=input.minimumRelevance&&combined>=.42){
        await selectSceneAsset(asset.id);
        return {status:'matched' as const,asset,verification,candidate:candidate.result,attempts};
      }
      await deleteSceneAsset(asset.id);
      asset=null;
    }catch(error){
      if(asset)await deleteSceneAsset(asset.id).catch(()=>{});
      attempts.push({
        provider:input.provider,
        providerAssetId:candidate.result.providerAssetId,
        error:error instanceof Error?error.message:'Falha ao validar imagem.'
      });
    }
  }
  return {status:'gap' as const,asset:null,attempts};
}


const PRIOR_VIDEO_REUSE_POLICY_VERSION='prior-scene-video-reuse@2';

type PriorVideoRow={
  id:string;scene_id:string;source_type:string;provider:string|null;storage_path:string|null;
  mime_type:string|null;original_name:string|null;bytes:number|string|null;width:number|string|null;
  height:number|string|null;duration_seconds:number|string|null;payload:unknown;
};

function objectValue(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'?value as Record<string,unknown>:{};
}

function priorVideoSearchText(row:PriorVideoRow){
  const payload=objectValue(row.payload);
  const verified=objectValue(payload.verifiedStock);
  const router=objectValue(payload.sourceRouterVerification);
  const qa=objectValue(payload.visualQa);
  const evidence=Array.isArray(qa.evidence)?qa.evidence.map(String).join(' '):'';
  return [
    verified.query,
    router.query,
    router.summary,
    qa.query,
    qa.summary,
    evidence,
    payload.prompt
  ].map(value=>String(value??'').trim()).filter(Boolean).join(' ');
}

function priorVideoProviderIdentity(row:PriorVideoRow){
  const payload=objectValue(row.payload);
  const stock=objectValue(payload.stock);
  const verified=objectValue(payload.verifiedStock);
  const provider=String(verified.provider??row.provider??'').trim();
  const providerAssetId=String(stock.providerAssetId??verified.providerAssetId??'').trim();
  return provider&&providerAssetId?{provider,providerAssetId}:null;
}

async function priorVersionVideoRows(promptSetId:string,currentSceneIds:Set<string>){
  const rows=checked(await db().from('radar_scene_assets')
    .select('id,scene_id,source_type,provider,storage_path,mime_type,original_name,bytes,width,height,duration_seconds,payload')
    .eq('visual_prompt_set_id',promptSetId)
    .eq('asset_kind','video')
    .eq('source_type','stock')
    .eq('status','ready')
    .eq('selected',true)
    .limit(2500)) as PriorVideoRow[];
  return (rows??[]).filter(row=>{
    if(!row.storage_path)return false;
    const payload=objectValue(row.payload);
    const qa=objectValue(payload.visualQa);
    const motion=objectValue(qa.motion);
    const license=objectValue(payload.license);
    return qa.status==='pass'&&motion.meaningfulMotion!==false&&String(license.type??'unknown')!=='unknown';
  }).sort((a,b)=>
    Number(currentSceneIds.has(String(b.scene_id)))-Number(currentSceneIds.has(String(a.scene_id)))
  );
}

async function attachPriorVersionVideo(input:{
  promptSet:Awaited<ReturnType<typeof loadVisualPromptSet>>;
  scene:NonNullable<Awaited<ReturnType<typeof loadScenePlan>>>['scenes'][number];
  visual:NonNullable<Awaited<ReturnType<typeof loadVisualPromptSet>>>['scenePrompts'][number];
  query:string;
  candidateRows:PriorVideoRow[];
  stockUses:Awaited<ReturnType<typeof selectedStockReuseObservations>>;
  usedCandidateIds:Set<string>;
}){
  if(!input.promptSet)return {status:'gap' as const,reason:'prompt-set-missing' as const};
  const ranked=input.candidateRows.flatMap(row=>{
    const identity=priorVideoProviderIdentity(row);
    if(!identity)return [];
    const sourceKey=identity.provider+':'+identity.providerAssetId;
    if(input.usedCandidateIds.has(row.id)||input.usedCandidateIds.has('source:'+sourceKey))return [];
    const payload=objectValue(row.payload);
    const verified=objectValue(payload.verifiedStock);
    const observations=input.stockUses.get(sourceKey)??[];
    const verifiedStart=Number(verified.sourceStartSeconds??0);
    const verifiedEnd=Number(verified.sourceEndSeconds??verifiedStart);
    const duration=Number(row.duration_seconds??0);
    const desired=Math.max(.5,Number(input.scene.durationSeconds)||.5);
    const windows:Array<{start:number;end:number}>=[];
    if(Number.isFinite(verifiedStart)&&Number.isFinite(verifiedEnd)&&verifiedEnd-verifiedStart>=.20){
      windows.push({start:verifiedStart,end:verifiedEnd});
    }
    if(Number.isFinite(duration)&&duration>=desired){
      const maxStart=Math.max(0,duration-desired);
      for(const fraction of [0,.25,.5,.75,1]){
        const start=maxStart*fraction;
        const end=Math.min(duration,start+desired);
        if(end-start<.20)continue;
        if(windows.some(item=>Math.abs(item.start-start)<.05&&Math.abs(item.end-end)<.05))continue;
        windows.push({start,end});
      }
    }
    const window=windows.find(item=>sourceReuseDecision({
      sourceType:'stock',
      targetSequence:Number(input.scene.sequence),
      observations,
      candidateStartSeconds:item.start,
      candidateEndSeconds:item.end
    }).ok);
    if(!window)return [];
    const score=scoreVisualSegment(input.query,priorVideoSearchText(row));
    return score>=.25?[{
      row,score,identity,sourceKey,
      sourceStartSeconds:window.start,
      sourceEndSeconds:window.end
    }]:[];
  }).sort((a,b)=>b.score-a.score);

  for(const item of ranked.slice(0,3)){
    const row=item.row;
    const sourceReservationKey='source:'+item.sourceKey;
    if(input.usedCandidateIds.has(row.id)||input.usedCandidateIds.has(sourceReservationKey))continue;
    input.usedCandidateIds.add(row.id);
    input.usedCandidateIds.add(sourceReservationKey);
    const sourcePayload=objectValue(row.payload);
    const sourceVerified=objectValue(sourcePayload.verifiedStock);
    const verifiedStock={
      ...sourceVerified,
      sourceStartSeconds:item.sourceStartSeconds,
      sourceEndSeconds:item.sourceEndSeconds,
      cachedFromAssetId:String(sourceVerified.cachedFromAssetId??row.id)
    };
    const id=crypto.randomUUID();
    const payload={
      ...sourcePayload,
      timecodeLabel:input.visual.timecodeLabel,
      promptSetVersion:input.promptSet.version,
      prompt:input.visual.prompt,
      promptHash:createHash('sha256').update(input.visual.prompt,'utf8').digest('hex'),
      verifiedStock,
      visualQa:undefined,
      videoFirstFallback:undefined,
      priorVersionReuse:{
        policyVersion:PRIOR_VIDEO_REUSE_POLICY_VERSION,
        sourceAssetId:row.id,
        sourceSceneId:row.scene_id,
        score:Number(item.score.toFixed(4)),
        query:input.query,
        reusedAt:new Date().toISOString()
      }
    };
    const reservation=await db().rpc('reserve_scene_asset',{
      p_id:id,
      p_channel_id:input.promptSet.channelId,
      p_episode_id:input.promptSet.episodeId,
      p_scene_plan_id:input.promptSet.scenePlanId,
      p_visual_prompt_set_id:input.promptSet.id,
      p_scene_id:input.scene.id,
      p_asset_kind:'video',
      p_source_type:'stock',
      p_provider:row.provider,
      p_mime_type:String(row.mime_type??'video/mp4'),
      p_original_name:row.original_name,
      p_payload:payload
    });
    if(reservation.error)continue;
    const ready=await db().from('radar_scene_assets').update({
      status:'ready',
      selected:false,
      storage_path:row.storage_path,
      mime_type:row.mime_type??'video/mp4',
      bytes:Number(row.bytes??0),
      width:row.width===null?null:Number(row.width),
      height:row.height===null?null:Number(row.height),
      duration_seconds:row.duration_seconds===null?null:Number(row.duration_seconds),
      payload,
      updated_at:new Date().toISOString()
    }).eq('id',id);
    if(ready.error)continue;

    try{
      const review=await ensureSceneAssetVisualQa(id);
      if(review.status==='pass'){
        await selectSceneAsset(id);
        input.usedCandidateIds.add(row.id);
        return {
          status:'matched' as const,
          assetId:id,
          sourceAssetId:row.id,
          score:item.score,
          provider:row.provider
        };
      }
      await db().from('radar_scene_assets').update({
        status:'rejected',selected:false,updated_at:new Date().toISOString()
      }).eq('id',id);
    }catch{
      await db().from('radar_scene_assets').update({
        status:'rejected',selected:false,updated_at:new Date().toISOString()
      }).eq('id',id);
    }
  }

  return {status:'gap' as const,reason:'no-prior-video-passed-current-visual-qa' as const};
}

export async function remediateMotionCoverageFromPriorVideos(input:{
  promptSetId:string;
  maxScenes?:number;
}){
  const promptSet=await loadVisualPromptSet(input.promptSetId);
  if(!promptSet||promptSet.status!=='approved')throw new HttpError('Visual Prompt Set aprovado não encontrado.',409);
  const [plan,dna]=await Promise.all([
    loadScenePlan(promptSet.scenePlanId),
    loadProductionDna(promptSet.channelId)
  ]);
  if(!plan||plan.status!=='approved')throw new HttpError('Scene Plan aprovado não encontrado.',409);
  const currentSceneIds=new Set(plan.scenes.map(scene=>scene.id));
  const selected=checked(await db().from('radar_scene_assets')
    .select('id,scene_id,asset_kind,payload')
    .eq('visual_prompt_set_id',promptSet.id)
    .eq('selected',true)
    .eq('status','ready')
    .limit(2500)) as Array<{id:string;scene_id:string;asset_kind:string;payload:unknown}>;
  const selectedByScene=new Map(
    (selected??[]).filter(row=>currentSceneIds.has(String(row.scene_id))).map(row=>[String(row.scene_id),row])
  );
  const documentaryMode=dna?.research?.documentaryMode===true;
  const promptByScene=new Map(promptSet.scenePrompts.map(prompt=>[prompt.sceneId,prompt]));
  const motionSceneIds=new Set(plan.scenes.flatMap(scene=>{
    const prompt=promptByScene.get(scene.id);
    const route=applyDocumentarySourcePolicy(
      sourceRouteForScene(scene,prompt?.direction),
      documentaryMode
    );
    return routePrefersMotion(route)?[scene.id]:[];
  }));
  const kindByScene=new Map<string,'video'|'image'>();
  for(const scene of plan.scenes){
    if(!motionSceneIds.has(scene.id))continue;
    const row=selectedByScene.get(scene.id);
    kindByScene.set(scene.id,row?.asset_kind==='video'?'video':'image');
  }

  const stats=()=>{
    let videoSeconds=0,imageSeconds=0,currentRun=0,longestImageRunSeconds=0;
    for(const scene of [...plan.scenes].sort((a,b)=>a.sequence-b.sequence)){
      if(!motionSceneIds.has(scene.id)){currentRun=0;continue;}
      if(kindByScene.get(scene.id)==='video'){
        videoSeconds+=scene.durationSeconds;
        currentRun=0;
      }else{
        imageSeconds+=scene.durationSeconds;
        currentRun+=scene.durationSeconds;
        longestImageRunSeconds=Math.max(longestImageRunSeconds,currentRun);
      }
    }
    const total=videoSeconds+imageSeconds;
    return {
      videoSeconds,imageSeconds,
      videoRatio:total?videoSeconds/total:0,
      longestImageRunSeconds
    };
  };
  const targetReached=()=>stats().videoRatio>=.52&&stats().longestImageRunSeconds<=28;
  if(targetReached())return {targetReached:true,exhausted:false,attempted:0,matched:0,...stats()};

  const candidateRows=await priorVersionVideoRows(promptSet.id,currentSceneIds);
  const sequenceByScene=new Map(plan.scenes.map(scene=>[scene.id,Number(scene.sequence)]));
  const stockUses=await selectedStockReuseObservations(promptSet.id,sequenceByScene);
  const usedCandidateIds=new Set<string>();
  for(const row of selected??[]){
    const payload=objectValue(row.payload);
    const reuse=objectValue(payload.priorVersionReuse);
    const sourceAssetId=String(reuse.sourceAssetId??'').trim();
    if(sourceAssetId)usedCandidateIds.add(sourceAssetId);
  }

  const exhaustedSceneIds=new Set<string>();
  for(const row of selected??[]){
    const payload=objectValue(row.payload);
    const retry=objectValue(payload.priorVideoReuseAttempt);
    if(retry.policyVersion===PRIOR_VIDEO_REUSE_POLICY_VERSION&&retry.status==='exhausted'){
      exhaustedSceneIds.add(String(row.scene_id));
    }
  }

  const maxScenes=Math.max(1,Math.min(96,Math.floor(input.maxScenes??24)));
  const concurrency=3;
  let attempted=0,matched=0;
  const attemptingSceneIds=new Set<string>();

  const chooseScene=()=>{
    const ordered=[...plan.scenes].sort((a,b)=>a.sequence-b.sequence);
    const runs:Array<{scenes:typeof ordered;duration:number}>=[];
    let current:typeof ordered=[];
    let duration=0;
    const flush=()=>{if(current.length)runs.push({scenes:current,duration});current=[];duration=0;};
    for(const scene of ordered){
      if(
        motionSceneIds.has(scene.id)&&
        kindByScene.get(scene.id)==='image'&&
        selectedByScene.has(scene.id)&&
        promptByScene.has(scene.id)&&
        !exhaustedSceneIds.has(scene.id)&&
        !attemptingSceneIds.has(scene.id)
      ){
        current.push(scene);duration+=scene.durationSeconds;
      }else flush();
    }
    flush();
    runs.sort((a,b)=>b.duration-a.duration);
    const run=runs[0];
    if(!run?.scenes.length)return null;
    return run.scenes[Math.floor(run.scenes.length/2)];
  };

  while(attempted<maxScenes&&!targetReached()){
    const batch:NonNullable<ReturnType<typeof chooseScene>>[]=[];
    while(batch.length<concurrency&&attempted+batch.length<maxScenes){
      const scene=chooseScene();
      if(!scene)break;
      attemptingSceneIds.add(scene.id);
      batch.push(scene);
    }
    if(!batch.length)break;

    const results=await Promise.all(batch.map(async scene=>{
      const visual=promptByScene.get(scene.id)!;
      const selectedRow=selectedByScene.get(scene.id)!;
      const route=applyDocumentarySourcePolicy(
        sourceRouteForScene(scene,visual.direction),
        documentaryMode
      );
      const query=sourceRouteRequiresAuthenticEvidence(route)
        ?route.query
        :stockVisualProxyQuery({canonical:route.query,direction:visual.direction});
      const result=await attachPriorVersionVideo({
        promptSet,scene,visual,query,candidateRows,stockUses,usedCandidateIds
      });
      return {scene,selectedRow,query,result};
    }));

    attempted+=results.length;
    for(const item of results){
      attemptingSceneIds.delete(item.scene.id);
      if(item.result.status==='matched'){
        matched++;
        kindByScene.set(item.scene.id,'video');
        continue;
      }
      exhaustedSceneIds.add(item.scene.id);
      const payload=objectValue(item.selectedRow.payload);
      await db().from('radar_scene_assets').update({
        payload:{
          ...payload,
          priorVideoReuseAttempt:{
            policyVersion:PRIOR_VIDEO_REUSE_POLICY_VERSION,
            status:'exhausted',
            query:item.query,
            attemptedAt:new Date().toISOString()
          }
        },
        updated_at:new Date().toISOString()
      }).eq('id',item.selectedRow.id);
    }
  }

  const finalStats=stats();
  const remaining=plan.scenes.filter(scene=>
    motionSceneIds.has(scene.id)&&
    kindByScene.get(scene.id)==='image'&&
    !exhaustedSceneIds.has(scene.id)
  ).length;
  return {
    targetReached:finalStats.videoRatio>=.52&&finalStats.longestImageRunSeconds<=28,
    exhausted:remaining===0&&!(
      finalStats.videoRatio>=.52&&finalStats.longestImageRunSeconds<=28
    ),
    attempted,matched,remaining,...finalStats
  };
}

export async function resolveSourceForScene(input:{
  promptSetId:string;
  sceneId:string;
  forceSelectedReplacement?:boolean;
}){
  const promptSet=await loadVisualPromptSet(input.promptSetId);
  if(!promptSet||promptSet.status!=='approved')throw new HttpError('Visual Prompt Set aprovado não encontrado.',409);
  const plan=await loadScenePlan(promptSet.scenePlanId);
  if(!plan||plan.status!=='approved')throw new HttpError('Scene Plan aprovado não encontrado.',409);
  const scene=plan.scenes.find(item=>item.id===input.sceneId);
  if(!scene)throw new HttpError('Cena não encontrada no Scene Plan.',404);
  const sequenceByScene=new Map(plan.scenes.map(item=>[item.id,Number(item.sequence)]));
  const stockUses=await selectedStockReuseObservations(
    input.promptSetId,
    sequenceByScene
  );

  const visual=promptSet.scenePrompts.find(item=>item.sceneId===scene.id);
  const dna=await loadProductionDna(promptSet.channelId);
  const route=applyDocumentarySourcePolicy(
    sourceRouteForScene(scene,visual?.direction),
    dna?.research?.documentaryMode===true
  );
  const sourceQuery=sourceRouteRequiresAuthenticEvidence(route)
    ?route.query
    :stockVisualProxyQuery({
      canonical:route.query,
      direction:visual?.direction
    });
  const attempts:Array<Record<string,unknown>>=[];
  if(sourceQuery!==route.query){
    attempts.push({
      action:'query-proxy',
      status:'compiled',
      canonicalQuery:route.query,
      sourceQuery
    });
  }
  const videoFirst=routePrefersMotion(route);
  let videoExhausted=false;
  let exhaustedStockJobId:string|null=null;

  for(const action of route.actions){
    if(action==='owned'){
      const result=await resolveOwnedMediaForScene({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:sourceQuery,
        preferredKind:videoFirst?'video':undefined,
        force:input.forceSelectedReplacement===true
      });
      attempts.push({action,status:result.status,reason:result.reason});
      if(result.status==='matched'||result.status==='skipped'){
        return {status:'matched' as const,route,action,result,attempts};
      }

      continue;
    }

    if(action==='wikimedia'){
      const result=await resolveStillCandidates({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:route.query,
        provider:'wikimedia',
        minimumRelevance:.46,
        requireTemporalProvenance:true,
        targetSequence:Number(scene.sequence),
        stockUses
      });
      attempts.push({action,status:result.status,details:result.attempts});
      if(result.status==='matched'){
        if(videoFirst&&videoExhausted&&result.asset){
          await markVideoFirstFallback({
            assetId:result.asset.id,
            query:route.query,
            stockJobId:exhaustedStockJobId
          });
        }
        return {status:'matched' as const,route,action,result,attempts};
      }
      continue;
    }

    if(action==='stock-image'){
      if(videoFirst&&videoExhausted){
        const currentSceneIds=new Set(plan.scenes.map(item=>item.id));
        const priorRows=await priorVersionVideoRows(promptSet.id,currentSceneIds);
        const reused=await attachPriorVersionVideo({
          promptSet,
          scene,
          visual:visual!,
          query:sourceQuery,
          candidateRows:priorRows,
          stockUses,
          usedCandidateIds:new Set<string>()
        });
        attempts.push({action:'prior-video-reuse',status:reused.status,details:reused});
        if(reused.status==='matched'){
          return {status:'matched' as const,route,action:'prior-video-reuse' as const,result:reused,attempts};
        }
      }
      for(const provider of STOCK_IMAGE_PROVIDERS){
        let result:Awaited<ReturnType<typeof resolveStillCandidates>>;
        try{
          result=await resolveStillCandidates({
            promptSetId:input.promptSetId,
            sceneId:input.sceneId,
            query:sourceQuery,
            provider,
            minimumRelevance:.42,
            targetSequence:Number(scene.sequence),
            stockUses
          });
        }catch(error){
          if(stockProviderSearchShouldTrip(error)){
            attempts.push({
              action,
              provider,
              status:'skipped',
              reason:'transient-provider-failure',
              error:error instanceof Error?error.message:'Falha transitória no provider stock.'
            });
            continue;
          }
          throw error;
        }
        attempts.push({action,provider,status:result.status,details:result.attempts});
        if(result.status==='matched'){
          if(videoFirst&&videoExhausted&&result.asset){
            await markVideoFirstFallback({
              assetId:result.asset.id,
              query:sourceQuery,
              stockJobId:exhaustedStockJobId
            });
          }
          return {status:'matched' as const,route,action,provider,result,attempts};
        }
      }
      continue;
    }

    if(action==='stock-video'){
      const jobInput={
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:sourceQuery,
        desiredDurationSeconds:Math.max(.25,scene.durationSeconds),
        orientation:'landscape' as const,
        providers:STOCK_VIDEO_PROVIDERS,
        maxCandidatesPerProvider:AUTOMATION_STOCK_CANDIDATES_PER_PROVIDER
      };
      const existing=await loadVerifiedStockJob(input.promptSetId,input.sceneId);
      const queryChanged=existing&&existing.query!==jobInput.query;
      if(queryChanged){
        const queued=await enqueueVerifiedStockJob(jobInput);
        attempts.push({
          action,status:'queued',jobId:queued.id,
          reason:'visual-query-changed'
        });
        return {status:'queued' as const,route,action,job:queued,attempts};
      }
      if(existing?.status==='queued'||existing?.status==='processing'){
        attempts.push({action,status:existing.status,jobId:existing.id});
        return {status:'queued' as const,route,action,job:existing,attempts};
      }
      if(existing?.status==='completed'){
        const completedStatus=String(existing.result?.status??'');
        if(completedStatus==='gap'){
          if(verifiedStockGapNeedsTransientRecovery(existing.result)){
            const restarted=await restartVerifiedStockJob(existing.id);
            attempts.push({
              action,status:'queued',jobId:restarted.id,
              reason:'legacy-transient-gap-recovery'
            });
            return {status:'queued' as const,route,action,job:restarted,attempts};
          }
          if(verifiedStockGapNeedsVisualModelRecovery(existing.result)){
            const restarted=await restartVerifiedStockJob(existing.id);
            attempts.push({
              action,status:'queued',jobId:restarted.id,
              reason:'visual-model-retired'
            });
            return {status:'queued' as const,route,action,job:restarted,attempts};
          }
          const previousPolicyVersion=String(existing.result?.discoveryPolicyVersion??'');
          if(previousPolicyVersion!==STOCK_DISCOVERY_POLICY_VERSION){
            const restarted=await restartVerifiedStockJob(existing.id);
            attempts.push({
              action,status:'queued',jobId:restarted.id,
              reason:'stock-discovery-policy-upgraded'
            });
            return {status:'queued' as const,route,action,job:restarted,attempts};
          }
          const previousCompiledQuery=String(existing.result?.query??'');
          const currentCompiledQuery=stockDiscoveryQuery(sourceQuery);
          if(previousCompiledQuery!==currentCompiledQuery){
            const restarted=await restartVerifiedStockJob(existing.id);
            attempts.push({
              action,status:'queued',jobId:restarted.id,
              reason:'stock-query-compiler-changed'
            });
            return {status:'queued' as const,route,action,job:restarted,attempts};
          }
          videoExhausted=true;
          exhaustedStockJobId=existing.id;
          attempts.push({action,status:'gap',jobId:existing.id});
          continue;
        }
        if(existing.attempts<2){
          const restarted=await restartVerifiedStockJob(existing.id,{resetAttempts:false});
          attempts.push({
            action,
            status:'queued',
            jobId:restarted.id,
            reason:'previous-selection-lost',
            recoveryAttempt:existing.attempts+1
          });
          return {status:'queued' as const,route,action,job:restarted,attempts};
        }
        videoExhausted=true;
        exhaustedStockJobId=existing.id;
        attempts.push({
          action,
          status:'gap',
          jobId:existing.id,
          reason:'selection-recovery-exhausted',
          previousResultStatus:completedStatus,
          attempts:existing.attempts
        });
        continue;
      }
      if(existing?.status==='failed'){
        if(
          existing.lastError==='superseded-by-upload-revalidation'||
          existing.lastError==='frozen-after-timeline-v5'
        ){
          const restarted=await restartVerifiedStockJob(existing.id);
          attempts.push({
            action,status:'queued',jobId:restarted.id,
            reason:existing.lastError==='frozen-after-timeline-v5'
              ?'legacy-frozen-video-first-reprocess'
              :'upload-revalidation-rejected'
          });
          return {status:'queued' as const,route,action,job:restarted,attempts};
        }
        attempts.push({action,status:'failed',jobId:existing.id,error:existing.lastError});
        continue;
      }
      const queued=await enqueueVerifiedStockJob(jobInput);
      attempts.push({action,status:'queued',jobId:queued.id});
      return {status:'queued' as const,route,action,job:queued,attempts};
    }

    if(action==='youtube-cc'){
      try{
        const candidates=await searchYouTubeCreativeCommonsSources(sourceQuery,6);
        attempts.push({
          action,
          status:candidates.length?'operator-source-required':'gap',
          candidates
        });
        if(candidates.length){
          const reason='Foram encontrados vídeos Creative Commons no YouTube. A plataforma preservou provenance e exige uma origem direta autorizada para ingestão do arquivo, sem baixar a watch page por scraping.';
          if(exhaustedStockJobId){
            await markSourceRouteTerminal({
              stockJobId:exhaustedStockJobId,
              route,
              sourceQuery,
              status:'operator-source-required',
              action,
              reason
            });
          }
          return {
            status:'operator-source-required' as const,
            route,
            action,
            reason,
            candidates,
            attempts
          };
        }
      }catch(error){
        if(isYouTubeSearchQuotaError(error)){
          attempts.push({
            action,
            status:'skipped',
            reason:'youtube-search-budget-unavailable'
          });
          continue;
        }
        attempts.push({
          action,
          status:'failed',
          error:error instanceof Error?error.message:'Falha ao buscar fontes Creative Commons no YouTube.'
        });
      }
      continue;
    }

    if(action==='generated-image'){
      if(!route.syntheticAllowed)continue;
      const cost=visualGenerationBudgetDecision({
        snapshot:await visualCostSnapshot(input.promptSetId),
        budgetUsd:VISUAL_EPISODE_BUDGET_USD,
        estimatedCostUsd:GOOGLE_IMAGE_ESTIMATED_COST_USD
      });
      if(!cost.allowed){
        attempts.push({
          action,
          status:'deferred',
          reason:cost.reason,
          cost
        });
        continue;
      }
      const asset=await generateGoogleImage({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        imageSize:'2K',
        estimatedCostUsd:cost.estimatedCostUsd??undefined
      });
      if(!asset)throw new HttpError('A geração visual não retornou asset persistido.',502);
      await selectSceneAsset(asset.id);
      attempts.push({action,status:'matched',cost});
      return {status:'matched' as const,route,action,result:{asset},attempts};
    }

    if(action==='generated-video'){
      // Reserved for the long-form generation policy. Do not start an expensive video job implicitly yet.
      attempts.push({action,status:'deferred'});
      continue;
    }

    if(action==='manual-archive'||action==='manual-map'||action==='manual-document'){
      attempts.push({action,status:'operator-source-required'});
      return {
        status:'operator-source-required' as const,
        route,
        action,
        reason:action==='manual-archive'
          ?'Nenhuma imagem histórica autêntica e reutilizável foi encontrada automaticamente.'
          :action==='manual-map'
            ?'Nenhum mapa real aprovado foi encontrado automaticamente.'
            :'Nenhum documento/arquivo real aprovado foi encontrado automaticamente.',
        attempts
      };
    }
  }

  try{
      const reused=await revalidateExistingUploadedStill({
      promptSetId:input.promptSetId,
      sceneId:input.sceneId,
      query:sourceQuery
    });
    if(reused?.status==='matched'){
      if(videoFirst&&videoExhausted){
        await markVideoFirstFallback({
          assetId:reused.assetId,
          query:sourceQuery,
          stockJobId:exhaustedStockJobId
        });
      }
      attempts.push({action:'uploaded-revalidation',status:'matched',assetId:reused.assetId,relevance:reused.verification.relevance});
      return {status:'matched' as const,route,action:'owned' as const,result:reused,attempts};
    }
    if(reused?.status==='rejected'){
      attempts.push({action:'uploaded-revalidation',status:'rejected',relevance:reused.verification.relevance});
    }
  }catch(error){
    attempts.push({action:'uploaded-revalidation',status:'failed',error:error instanceof Error?error.message:'Falha ao revalidar upload existente.'});
  }

  const reason=sourceRouteRequiresAuthenticEvidence(route)
    ?'Beat factual sem fonte real validada; geração sintética está bloqueada.'
    :route.syntheticAllowed
      ?'Nenhuma fonte visual passou pelos gates automáticos.'
      :'Nenhuma fonte real motion-first passou pelos gates automáticos; a cena pode ser deferida sem bloquear outras cenas.';
  if(exhaustedStockJobId){
    await markSourceRouteTerminal({
      stockJobId:exhaustedStockJobId,
      route,
      sourceQuery,
      status:'gap',
      action:null,
      reason
    });
  }
  return {
    status:'gap' as const,
    route,
    action:null as SourceRouteAction|null,
    reason,
    attempts
  };
}
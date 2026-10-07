import 'server-only';

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
  importStockMedia, searchStockMedia
} from './stock-media';
import {
  enqueueVerifiedStockJob, loadVerifiedStockJob, restartVerifiedStockJob
} from './verified-stock-jobs';
import { rankStockMediaResults, stockDiscoveryQuery } from '@/lib/stock-media-policy';
import {
  applyDocumentarySourcePolicy, archiveTemporalEvidence, routePrefersMotion, sourceRouteForScene,
  type SourceRouteAction
} from '@/lib/source-router-policy';
import type { SceneAsset, StockMediaProvider } from '@/lib/types';

const STOCK_IMAGE_PROVIDERS:StockMediaProvider[]=['vecteezy','pexels','pixabay'];
const STOCK_VIDEO_PROVIDERS:StockMediaProvider[]=['vecteezy','pexels','pixabay'];

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
        relevance:verification.relevance,
        summary:verification.summary,
        matchedEvidence:verification.matchedEvidence,
        mismatchReason:verification.mismatchReason,
        focusX:verification.focusX,
        focusY:verification.focusY,
        focusLabel:verification.focusLabel,
        verifiedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',assetId));
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

async function resolveStillCandidates(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
  provider:StockMediaProvider;
  minimumRelevance:number;
  requireTemporalProvenance?:boolean;
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

export async function resolveSourceForScene(input:{
  promptSetId:string;
  sceneId:string;
}){
  const promptSet=await loadVisualPromptSet(input.promptSetId);
  if(!promptSet||promptSet.status!=='approved')throw new HttpError('Visual Prompt Set aprovado não encontrado.',409);
  const plan=await loadScenePlan(promptSet.scenePlanId);
  if(!plan||plan.status!=='approved')throw new HttpError('Scene Plan aprovado não encontrado.',409);
  const scene=plan.scenes.find(item=>item.id===input.sceneId);
  if(!scene)throw new HttpError('Cena não encontrada no Scene Plan.',404);

  const visual=promptSet.scenePrompts.find(item=>item.sceneId===scene.id);
  const dna=await loadProductionDna(promptSet.channelId);
  const route=applyDocumentarySourcePolicy(
    sourceRouteForScene(scene,visual?.direction),
    dna?.research?.documentaryMode===true
  );
  const attempts:Array<Record<string,unknown>>=[];
  const videoFirst=routePrefersMotion(route);

  for(const action of route.actions){
    if(action==='owned'){
      const result=await resolveOwnedMediaForScene({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:route.query,
        preferredKind:videoFirst?'video':undefined
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
        requireTemporalProvenance:true
      });
      attempts.push({action,status:result.status,details:result.attempts});
      if(result.status==='matched')return {status:'matched' as const,route,action,result,attempts};
      continue;
    }

    if(action==='stock-image'){
      for(const provider of STOCK_IMAGE_PROVIDERS){
        const result=await resolveStillCandidates({
          promptSetId:input.promptSetId,
          sceneId:input.sceneId,
          query:route.query,
          provider,
          minimumRelevance:.42
        });
        attempts.push({action,provider,status:result.status,details:result.attempts});
        if(result.status==='matched')return {status:'matched' as const,route,action,provider,result,attempts};
      }
      continue;
    }

    if(action==='stock-video'){
      const jobInput={
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:route.query,
        desiredDurationSeconds:Math.max(.25,scene.durationSeconds),
        orientation:'landscape' as const,
        providers:STOCK_VIDEO_PROVIDERS,
        maxCandidatesPerProvider:2
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
          const previousCompiledQuery=String(existing.result?.query??'');
          const currentCompiledQuery=stockDiscoveryQuery(route.query);
          if(previousCompiledQuery!==currentCompiledQuery){
            const restarted=await restartVerifiedStockJob(existing.id);
            attempts.push({
              action,status:'queued',jobId:restarted.id,
              reason:'stock-query-compiler-changed'
            });
            return {status:'queued' as const,route,action,job:restarted,attempts};
          }
          attempts.push({action,status:'gap',jobId:existing.id});
          continue;
        }
        const restarted=await restartVerifiedStockJob(existing.id);
        attempts.push({action,status:'queued',jobId:restarted.id,reason:'previous-selection-lost'});
        return {status:'queued' as const,route,action,job:restarted,attempts};
      }
      if(existing?.status==='failed'){
        if(existing.lastError==='superseded-by-upload-revalidation'){
          const restarted=await restartVerifiedStockJob(existing.id);
          attempts.push({
            action,status:'queued',jobId:restarted.id,
            reason:'upload-revalidation-rejected'
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

    if(action==='generated-image'){
      if(!route.syntheticAllowed)continue;
      const asset=await generateGoogleImage({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        imageSize:'2K'
      });
      if(!asset)throw new HttpError('A geração visual não retornou asset persistido.',502);
      await selectSceneAsset(asset.id);
      attempts.push({action,status:'matched'});
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
      query:route.query
    });
    if(reused?.status==='matched'){
      attempts.push({action:'uploaded-revalidation',status:'matched',assetId:reused.assetId,relevance:reused.verification.relevance});
      return {status:'matched' as const,route,action:'owned' as const,result:reused,attempts};
    }
    if(reused?.status==='rejected'){
      attempts.push({action:'uploaded-revalidation',status:'rejected',relevance:reused.verification.relevance});
    }
  }catch(error){
    attempts.push({action:'uploaded-revalidation',status:'failed',error:error instanceof Error?error.message:'Falha ao revalidar upload existente.'});
  }

  return {
    status:'gap' as const,
    route,
    action:null as SourceRouteAction|null,
    reason:route.syntheticAllowed
      ?'Nenhuma fonte visual passou pelos gates automáticos.'
      :'Beat factual sem fonte real validada; geração sintética está bloqueada.',
    attempts
  };
}
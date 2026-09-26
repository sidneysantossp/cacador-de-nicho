import 'server-only';

import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { downloadMedia } from './media-storage';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { loadScenePlan } from './scene-timecode';
import {
  deleteSceneAsset, generateGoogleImage, resolveOwnedMediaForScene, selectSceneAsset
} from './asset-factory';
import {
  importStockMedia, resolveVerifiedStockMediaForScene, searchStockMedia
} from './stock-media';
import { rankStockMediaResults, stockDiscoveryQuery } from '@/lib/stock-media-policy';
import { sourceRouteForScene, type SourceRouteAction } from '@/lib/source-router-policy';
import type { SceneAsset, StockMediaProvider } from '@/lib/types';

type ImageVerification={
  relevance:number;
  summary:string;
  matchedEvidence:string[];
  mismatchReason:string;
};

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
  const key=await providerSecret('googleai');
  const model=(process.env.VISUAL_INTELLIGENCE_MODEL??'gemini-2.5-flash').replace(/^models\//,'');
  const schema={
    type:'OBJECT',
    properties:{
      relevance:{type:'NUMBER'},
      summary:{type:'STRING'},
      matchedEvidence:{type:'ARRAY',items:{type:'STRING'}},
      mismatchReason:{type:'STRING'}
    },
    required:['relevance','summary','matchedEvidence','mismatchReason']
  };
  let response:Response;
  try{
    response=await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',
      {
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({
          contents:[{role:'user',parts:[
            {text:[
              'Validate this candidate image against the editorial visual intent below.',
              'Judge only what is visibly supported. Do not infer an exact person, place, event or date unless visual evidence supports it.',
              'relevance is 0..1. Use high scores only when the image clearly satisfies the requested subject/context.',
              'EDITORIAL INTENT: '+query
            ].join('\n')},
            {inline_data:{mime_type:String(asset.mime_type||'image/jpeg'),data:bytes.toString('base64')}}
          ]}],
          generationConfig:{temperature:.1,responseMimeType:'application/json',responseSchema:schema}
        }),
        signal:AbortSignal.timeout(90000),
        cache:'no-store'
      }
    );
  }catch{throw new HttpError('A validação visual da imagem excedeu o tempo.',504);}
  if(response.status===429)throw new HttpError('A Google AI atingiu o limite durante a validação da imagem.',429);
  if(response.status===401||response.status===403)throw new HttpError('A Google AI recusou a validação da imagem.',422);
  if(!response.ok)throw new HttpError('A Google AI falhou ao validar a imagem candidata.',502);
  const body=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>} ;
  const raw=(body.candidates?.[0]?.content?.parts??[]).map(part=>part.text??'').join('').trim();
  if(!raw)throw new HttpError('A validação visual não retornou resultado.',502);
  try{
    const parsed=JSON.parse(raw) as Partial<ImageVerification>;
    return {
      relevance:Math.max(0,Math.min(1,Number(parsed.relevance??0))),
      summary:String(parsed.summary??'').trim().slice(0,1200),
      matchedEvidence:Array.isArray(parsed.matchedEvidence)
        ?parsed.matchedEvidence.map(String).map(value=>value.trim()).filter(Boolean).slice(0,20)
        :[],
      mismatchReason:String(parsed.mismatchReason??'').trim().slice(0,1200)
    };
  }catch{throw new HttpError('A validação visual retornou JSON inválido.',502);}
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
        verifiedAt:new Date().toISOString()
      }
    },
    updated_at:new Date().toISOString()
  }).eq('id',assetId));
}

async function resolveStillCandidates(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
  provider:StockMediaProvider;
  minimumRelevance:number;
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

  const route=sourceRouteForScene(scene);
  const attempts:Array<Record<string,unknown>>=[];

  for(const action of route.actions){
    if(action==='owned'){
      const result=await resolveOwnedMediaForScene({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:route.query
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
        minimumRelevance:.46
      });
      attempts.push({action,status:result.status,details:result.attempts});
      if(result.status==='matched')return {status:'matched' as const,route,action,result,attempts};
      continue;
    }

    if(action==='stock-image'){
      for(const provider of ['pexels','pixabay'] as const){
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
      const result=await resolveVerifiedStockMediaForScene({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        query:route.query,
        desiredDurationSeconds:Math.max(.25,scene.durationSeconds),
        orientation:'landscape',
        providers:['pexels','pixabay'],
        maxCandidatesPerProvider:2
      });
      attempts.push({action,status:result.status,details:result.attempts});
      if(result.status==='matched')return {status:'matched' as const,route,action,result,attempts};
      continue;
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

    if(action==='manual-map'||action==='manual-document'){
      attempts.push({action,status:'operator-source-required'});
      return {
        status:'operator-source-required' as const,
        route,
        action,
        reason:action==='manual-map'
          ?'Nenhum mapa real aprovado foi encontrado automaticamente.'
          :'Nenhum documento/arquivo real aprovado foi encontrado automaticamente.',
        attempts
      };
    }
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

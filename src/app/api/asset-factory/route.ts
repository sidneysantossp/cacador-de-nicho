import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  attachOwnedMediaToScene, deleteSceneAsset, generateGoogleImage, listSceneAssets, refreshGoogleVideo,
  resolveOwnedMediaForPromptSet, resolveOwnedMediaForScene, selectSceneAsset, startGoogleVideo, uploadSceneAsset
} from '@/lib/server/asset-factory';
import { resolveSourceForScene } from '@/lib/server/source-router';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('generateImage'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    modelId:z.enum(['gemini-3.1-flash-image','gemini-3.1-flash-lite-image','gemini-3-pro-image']).optional(),
    imageSize:z.enum(['1K','2K','4K']).optional()
  }).strict(),
  z.object({
    action:z.literal('startVideo'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    modelId:z.enum(['veo-3.1-generate-preview','veo-3.1-fast-generate-preview','veo-3.1-lite-generate-preview']).optional(),
    resolution:z.enum(['720p','1080p','4k']).optional(),
    durationSeconds:z.union([z.literal(4),z.literal(6),z.literal(8)]).optional()
  }).strict(),
  z.object({
    action:z.literal('resolveOwnedScene'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    query:z.string().trim().min(3).max(2000).optional(),
    minimumScore:z.number().min(.30).max(.90).optional(),
    force:z.boolean().optional(),
    dryRun:z.boolean().optional()
  }).strict(),
  z.object({
    action:z.literal('resolveSource'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('resolveOwnedPlan'),
    promptSetId:z.string().uuid(),
    minimumScore:z.number().min(.30).max(.90).optional(),
    force:z.boolean().optional(),
    dryRun:z.boolean().optional()
  }).strict(),
  z.object({
    action:z.literal('attachOwned'),
    promptSetId:z.string().uuid(),
    sceneId:z.string().uuid(),
    ownedAssetId:z.string().uuid(),
    segmentId:z.string().uuid(),
    sourceStartSeconds:z.number().nonnegative().optional(),
    sourceEndSeconds:z.number().positive().optional(),
    matchScore:z.number().min(0).max(1).optional(),
    visualCoverage:z.number().min(0).max(1).optional(),
    select:z.boolean().optional()
  }).strict(),
  z.object({action:z.literal('refreshVideo'),assetId:z.string().uuid()}).strict(),
  z.object({action:z.literal('select'),assetId:z.string().uuid()}).strict(),
  z.object({action:z.literal('delete'),assetId:z.string().uuid()}).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Asset Factory.',503);
    const promptSetId=new URL(request.url).searchParams.get('promptSetId')?.trim();
    if(!promptSetId||!z.string().uuid().safeParse(promptSetId).success)throw new HttpError('Visual Prompt Set inválido.',400);
    return Response.json({assets:await listSceneAssets(promptSetId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Asset Factory.',503);
    const contentType=request.headers.get('content-type')??'';

    if(contentType.includes('multipart/form-data')){
      const size=Number(request.headers.get('content-length')??0);
      if(size>260*1024*1024)throw new HttpError('Upload maior que 250 MB.',413);
      const form=await request.formData();
      const promptSetId=String(form.get('promptSetId')??'').trim();
      const sceneId=String(form.get('sceneId')??'').trim();
      const file=form.get('file');
      const licenseType=String(form.get('licenseType')??'owned');
      if(!z.string().uuid().safeParse(promptSetId).success||!z.string().uuid().safeParse(sceneId).success)throw new HttpError('Cena ou prompt set inválido.',400);
      if(!(file instanceof File))throw new HttpError('Selecione uma imagem ou vídeo.',400);
      if(!['owned','licensed','unknown'].includes(licenseType))throw new HttpError('Licença de asset inválida.',400);
      const asset=await uploadSceneAsset({
        promptSetId,sceneId,file,
        license:{
          type:licenseType as 'owned'|'licensed'|'unknown',
          label:licenseType==='owned'?'Operator-owned external asset':licenseType==='licensed'?'Externally licensed asset':'License not declared'
        }
      });
      return Response.json({message:'Asset externo salvo como nova variante.',asset,assets:await listSceneAssets(promptSetId)});
    }

    if(Number(request.headers.get('content-length')??0)>20000)throw new HttpError('Solicitação muito extensa.',413);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Asset Factory.',400);
    const body=parsed.data;

    if(body.action==='generateImage'){
      const asset=await generateGoogleImage(body);
      return Response.json({message:'Imagem gerada e salva como nova variante.',asset,assets:await listSceneAssets(body.promptSetId)});
    }
    if(body.action==='startVideo'){
      const asset=await startGoogleVideo(body);
      return Response.json({message:'Job Veo iniciado. Atualize o status até a variante ficar pronta.',asset,assets:await listSceneAssets(body.promptSetId)});
    }
    if(body.action==='resolveOwnedScene'){
      const result=await resolveOwnedMediaForScene(body);
      return Response.json({
        message:result.status==='matched'
          ?result.applied===false
            ?'Library First encontrou um trecho OWNED forte; dry-run não alterou a cena.'
            :'Library First encontrou e selecionou um trecho OWNED.'
          :result.status==='skipped'
            ?'A cena já possui uma mídia selecionada e atual.'
            :'Library First não encontrou match OWNED forte para esta cena.',
        result
      });
    }
    if(body.action==='resolveSource'){
      const result=await resolveSourceForScene({
        promptSetId:body.promptSetId,
        sceneId:body.sceneId
      });
      return Response.json({
        message:result.status==='matched'
          ?'Source Router encontrou e selecionou uma fonte visual validada.'
          :result.status==='queued'
            ?'Source Router enfileirou a validação de vídeo real no worker dedicado.'
            :result.status==='operator-source-required'
              ?'Source Router exige uma fonte documental real do operador.'
              :'Source Router não encontrou fonte visual aprovada.',
        result
      });
    }
    if(body.action==='resolveOwnedPlan'){
      const result=await resolveOwnedMediaForPromptSet(body);
      return Response.json({
        message:'Library First concluído para o Visual Prompt Set.',
        result
      });
    }
    if(body.action==='attachOwned'){
      const asset=await attachOwnedMediaToScene(body);
      return Response.json({
        message:'Trecho da Biblioteca OWNED vinculado à cena sem duplicar o arquivo.',
        asset,
        assets:await listSceneAssets(body.promptSetId)
      });
    }
    if(body.action==='refreshVideo'){
      const asset=await refreshGoogleVideo(body.assetId);
      return Response.json({message:asset?.status==='ready'?'Vídeo Veo concluído e salvo.':asset?.status==='failed'?'O job Veo falhou.':'O vídeo ainda está sendo processado.',asset});
    }
    if(body.action==='select'){
      await selectSceneAsset(body.assetId);
      return Response.json({message:'Variante selecionada para esta cena.'});
    }

    await deleteSceneAsset(body.assetId);
    return Response.json({message:'Variante removida.'});
  }catch(e){return errorResponse(e);}
}

import { z } from 'zod';
import { longFormJsonLimit } from '@/lib/long-form-capacity';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  createVisualPromptSet, generateVisualPromptDrafts, importOperatorVisualPrompts, listVisualPromptSets,
  loadVisualPromptSet, loadVisualPromptSetHistory, loadVisualPromptSetHistoryVersion,
  operatorVisualPromptContext, saveVisualPromptSet
} from '@/lib/server/visual-prompt-engine';
import { listScenePlans, loadScenePlan } from '@/lib/server/scene-timecode';
import { loadProductionDna } from '@/lib/server/production-dna';
import { visualPromptSetPayloadSchema } from '@/lib/server/validation';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const assertProviderAiAllowed=()=>{if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: importe direções visuais do ChatGPT em vez da geração OpenAI.',409);};

const operatorScene=z.object({
  sceneId:z.string().uuid(),
  direction:z.string().trim().min(1).max(10000),
  characterIds:z.array(z.string().trim().min(1).max(120)).max(50).optional()
}).strict();

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),scenePlanId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('importOperatorPrompts'),
    scenePlanId:z.string().uuid(),
    expectedScenePlanVersion:z.number().int().min(1).max(100000),
    expectedProductionDnaVersion:z.number().int().min(1).max(100000),
    expectedSetVersion:z.number().int().min(0).max(100000),
    scenes:z.array(operatorScene).min(1).max(5000)
  }).strict(),
  z.object({action:z.literal('generate'),setId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('approveCurrent'),
    setId:z.string().uuid(),
    expectedVersion:z.number().int().min(1).max(100000)
  }).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    promptSet:visualPromptSetPayloadSchema
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Prompt Engine.',503);
    const url=new URL(request.url);
    const setId=url.searchParams.get('setId')?.trim();
    const historyVersionRaw=url.searchParams.get('historyVersion')?.trim();
    const channelId=url.searchParams.get('channelId')?.trim();
    const scenePlanId=url.searchParams.get('scenePlanId')?.trim();

    if(setId){
      if(!z.string().uuid().safeParse(setId).success)throw new HttpError('Visual Prompt Set inválido.',400);
      if(historyVersionRaw){
        const historyVersion=Number(historyVersionRaw);
        if(!Number.isInteger(historyVersion)||historyVersion<1||historyVersion>100000){
          throw new HttpError('Versão histórica inválida.',400);
        }
        const version=await loadVisualPromptSetHistoryVersion(setId,historyVersion);
        if(!version)throw new HttpError('Versão histórica não encontrada.',404);
        return Response.json({historyVersion:version},{headers:{'Cache-Control':'no-store'}});
      }
      const [promptSet,history]=await Promise.all([
        loadVisualPromptSet(setId),
        loadVisualPromptSetHistory(setId,20)
      ]);
      if(!promptSet)throw new HttpError('Visual Prompt Set não encontrado.',404);
      const [scenePlan,productionDna]=await Promise.all([
        loadScenePlan(promptSet.scenePlanId),
        loadProductionDna(promptSet.channelId)
      ]);
      return Response.json({promptSet,history,scenePlan,productionDna},{headers:{'Cache-Control':'no-store'}});
    }

    if(scenePlanId&&url.searchParams.get('context')==='operator'){
      if(!z.string().uuid().safeParse(scenePlanId).success)throw new HttpError('Scene Plan inválido.',400);
      return Response.json(await operatorVisualPromptContext(scenePlanId),{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    const [promptSets,scenePlans]=await Promise.all([
      listVisualPromptSets(channelId),
      listScenePlans(channelId)
    ]);
    return Response.json({
      promptSets,
      scenePlans:scenePlans.filter(item=>item.status==='approved')
    },{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Visual Prompt Engine.',503);
    if(Number(request.headers.get('content-length')??0)>longFormJsonLimit('visualPromptSet'))throw new HttpError('Visual Prompt Set muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Visual Prompt Engine.',400);
    const body=parsed.data;

    let promptSet;
    if(body.action==='create')promptSet=await createVisualPromptSet(body.scenePlanId);
    else if(body.action==='importOperatorPrompts')promptSet=await importOperatorVisualPrompts(body);
    else if(body.action==='generate'){assertProviderAiAllowed();promptSet=await generateVisualPromptDrafts(body.setId);}
    else if(body.action==='approveCurrent'){
      const current=await loadVisualPromptSet(body.setId);
      if(!current)throw new HttpError('Visual Prompt Set não encontrado.',404);
      if(current.version!==body.expectedVersion){
        throw new HttpError('Visual Prompt Set desatualizado. Recarregue antes de aprovar.',409);
      }
      const {version:_version,status:_status,...payload}=current;
      promptSet=await saveVisualPromptSet(payload,'approved',body.expectedVersion);
    }else promptSet=await saveVisualPromptSet(body.promptSet,body.status,body.expectedVersion);

    return Response.json({
      message:body.action==='create'
        ?'Visual Prompt Set criado.'
        :body.action==='importOperatorPrompts'
          ?'Direções visuais do ChatGPT operador compiladas com Style Lock e salvas como draft.'
        :body.action==='generate'
          ?promptSet.aiPlanning
            ?'Planejamento visual IA: '+promptSet.aiPlanning.completedScenes+'/'+promptSet.aiPlanning.totalScenes+' cenas concluídas.'
            :'Direções visuais atualizadas sem alterar os timecodes.'
          :body.action==='approveCurrent'
            ?'Visual Prompt Set atual aprovado.'
            :body.status==='approved'
              ?'Visual Prompt Set aprovado.'
              :'Visual Prompt Set salvo.',
      promptSet,
      history:await loadVisualPromptSetHistory(promptSet.id,20)
    });
  }catch(e){return errorResponse(e);}
}
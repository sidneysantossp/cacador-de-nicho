import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  acceptNextEpisodeCandidate, generateNextEpisodePlan, importOperatorNextEpisodePlan,
  loadNextEpisodePlan, loadNextEpisodePlanHistory, nextEpisodeChannelState,
  nextEpisodeOperatorContext
} from '@/lib/server/next-episode';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const assertProviderAiAllowed=()=>{if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: use a importação do ChatGPT em vez da geração OpenAI.',409);};

const operatorCandidate=z.object({
  workingTitle:z.string().min(1).max(250),
  theme:z.string().min(1).max(1000),
  thesis:z.string().min(1).max(2000),
  angle:z.string().min(1).max(2000),
  promise:z.string().min(1).max(2000),
  thumbnailConcept:z.string().min(1).max(2000),
  targetAudience:z.string().min(1).max(1200),
  objective:z.string().min(1).max(2000),
  previousEpisodeConnection:z.string().max(2000),
  arcRef:z.string().nullable(),
  prerequisiteConceptRefs:z.array(z.string()).max(15),
  introducesConceptRefs:z.array(z.string()).max(15),
  reinforcesConceptRefs:z.array(z.string()).max(15),
  opensThreads:z.array(z.string().min(1).max(600)).max(15),
  resolvesThreadRefs:z.array(z.string()).max(15),
  repetitionKeys:z.array(z.string().min(1).max(300)).max(20),
  evidenceRefs:z.array(z.string()).min(1).max(20),
  rationale:z.string().min(1).max(2500),
  risks:z.array(z.string().min(1).max(800)).max(12),
  originality:z.object({
    discovery:z.string().min(60).max(2500),
    addedValue:z.string().min(60).max(2500),
    copyResistance:z.string().min(60).max(2500),
    sourcePlan:z.string().min(60).max(2500)
  }).strict()
}).strict();

const schema=z.discriminatedUnion('action',[
  z.object({
    action:z.literal('generate'),
    channelId:z.string().uuid()
  }).strict(),
  z.object({
    action:z.literal('import-operator-plan'),
    channelId:z.string().uuid(),
    expectedBrainVersion:z.number().int().min(1),
    model:z.object({
      candidates:z.array(operatorCandidate).length(3),
      recommendedIndex:z.number().int().min(0).max(2),
      recommendationRationale:z.string().min(1).max(2500)
    }).strict()
  }).strict(),
  z.object({
    action:z.literal('accept'),
    planId:z.string().uuid(),
    candidateId:z.string().uuid(),
    expectedVersion:z.number().int().min(1),
    notes:z.string().max(5000).default('')
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Next Episode Strategist.',503);
    const url=new URL(request.url);
    const planId=url.searchParams.get('planId')?.trim();
    if(planId){
      if(!z.string().uuid().safeParse(planId).success)throw new HttpError('Next Episode Plan inválido.',400);
      const plan=await loadNextEpisodePlan(planId);
      if(!plan)throw new HttpError('Next Episode Plan não encontrado.',404);
      return Response.json({
        plan,
        history:await loadNextEpisodePlanHistory(planId)
      },{headers:{'Cache-Control':'no-store'}});
    }

    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    if(url.searchParams.get('context')==='operator'){
      return Response.json(await nextEpisodeOperatorContext(channelId),{
        headers:{'Cache-Control':'no-store'}
      });
    }
    return Response.json(await nextEpisodeChannelState(channelId),{
      headers:{'Cache-Control':'no-store'}
    });
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Next Episode Strategist.',503);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os dados do Next Episode Strategist.',400);
    const body=parsed.data;

    if(body.action==='generate'){
      assertProviderAiAllowed();
      const result=await generateNextEpisodePlan(body.channelId);
      return Response.json({
        message:result.created
          ?'Next Episode Plan gerado com evidências do Channel Brain.'
          :'O Brain não mudou; o plano ativo existente foi reutilizado.',
        ...result
      });
    }

    if(body.action==='import-operator-plan'){
      const result=await importOperatorNextEpisodePlan(body);
      return Response.json({
        message:'Next Episode Plan criado pelo operador/ChatGPT e validado contra o contexto atual.',
        ...result
      });
    }

    const result=await acceptNextEpisodeCandidate(body);
    const baseMessage=result.alreadyAccepted
      ?'Este plano já havia sido aceito.'
      :'Próximo episódio criado e enviado ao Content OS como brief.';
    const automationMessage=result.automationStarted
      ?' Episode Automation disponível em modo '+result.automationMode+'.'
      :result.automationError
        ?' O episódio foi criado, mas o Autopilot não iniciou: '+result.automationError
        :'';
    return Response.json({
      message:baseMessage+automationMessage,
      ...result
    });
  }catch(error){return errorResponse(error);}
}

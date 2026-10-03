import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import {
  generateScriptForProject, importOperatorScript, loadEpisodeScript, loadEpisodeScriptHistory,
  loadEpisodeScriptHistoryVersion, loadEpisodeScripts, operatorScriptContext,
  regenerateScriptSection, saveEpisodeScript
} from '@/lib/server/episode-script';
import { episodeScriptPayloadSchema } from '@/lib/server/validation';
import { loadContentProject } from '@/lib/server/content-os';
import { loadProductionDna } from '@/lib/server/production-dna';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const assertProviderAiAllowed=()=>{if(process.env.CACADORES_AI_AUTORUN!=='1')throw new HttpError('Operator-first ativo: use importOperatorScript em vez da geração OpenAI.',409);};

const retentionRole=z.enum([
  'hook','setup','proof','rehook','midpoint-reframe','second-question',
  'synthesis','callback','close'
]);
const retentionBeat=z.object({
  role:retentionRole,
  questionOpened:z.string().trim().max(2000),
  payoffDelivered:z.string().trim().max(2000),
  nextQuestion:z.string().trim().max(2000)
}).strict();
const retentionMap=z.object({
  macroQuestion:z.string().trim().min(1).max(3000),
  promisedPayoff:z.string().trim().min(1).max(3000),
  midpointReframe:z.string().trim().min(1).max(3000),
  endingCallback:z.string().trim().min(1).max(3000)
}).strict();

const operatorSection=z.object({
  label:z.string().trim().min(1).max(120),
  purpose:z.string().trim().max(1000),
  content:z.string().trim().min(1).max(40000),
  claimIds:z.array(z.string().uuid()).max(100).optional(),
  retention:retentionBeat.optional()
}).strict();

const postSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('generate'),projectId:z.string().uuid()}).strict(),
  z.object({
    action:z.literal('importOperatorScript'),
    projectId:z.string().uuid(),
    expectedProjectVersion:z.number().int().min(1).max(100000),
    expectedBrainVersion:z.number().int().min(0).max(100000),
    expectedScriptVersion:z.number().int().min(0).max(100000),
    title:z.string().trim().min(1).max(300),
    language:z.string().trim().min(2).max(80),
    sections:z.array(operatorSection).min(1).max(80),
    retention:retentionMap.optional(),
    continuityNotes:z.array(z.string().trim().max(1000)).max(100).default([]),
    factCheckWarnings:z.array(z.string().trim().max(1000)).max(100).default([])
  }).strict(),
  z.object({
    action:z.literal('save'),
    expectedVersion:z.number().int().min(0).max(100000).nullable(),
    status:z.enum(['draft','review','approved']),
    script:episodeScriptPayloadSchema
  }).strict(),
  z.object({
    action:z.literal('regenerateSection'),
    scriptId:z.string().uuid(),
    sectionId:z.string().uuid()
  }).strict()
]);

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Script Engine.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    const scriptId=url.searchParams.get('scriptId')?.trim();
    const projectId=url.searchParams.get('projectId')?.trim();
    const historyVersionRaw=url.searchParams.get('historyVersion')?.trim();

    if(scriptId){
      if(!z.string().uuid().safeParse(scriptId).success)throw new HttpError('Roteiro inválido.',400);
      if(historyVersionRaw){
        const historyVersion=Number(historyVersionRaw);
        if(!Number.isInteger(historyVersion)||historyVersion<1||historyVersion>100000){
          throw new HttpError('Versão histórica inválida.',400);
        }
        const version=await loadEpisodeScriptHistoryVersion(scriptId,historyVersion);
        if(!version)throw new HttpError('Versão histórica não encontrada.',404);
        return Response.json({historyVersion:version},{headers:{'Cache-Control':'no-store'}});
      }
      const [script,history]=await Promise.all([
        loadEpisodeScript(scriptId),
        loadEpisodeScriptHistory(scriptId,20)
      ]);
      if(!script)throw new HttpError('Roteiro não encontrado.',404);
      const [project,productionDna]=await Promise.all([
        loadContentProject(script.contentProjectId),
        loadProductionDna(script.channelId)
      ]);
      return Response.json({script,history,project,productionDna},{headers:{'Cache-Control':'no-store'}});
    }

    if(projectId&&url.searchParams.get('context')==='operator'){
      if(!z.string().uuid().safeParse(projectId).success)throw new HttpError('Content Project inválido.',400);
      return Response.json(await operatorScriptContext(projectId),{headers:{'Cache-Control':'no-store'}});
    }

    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
    return Response.json({scripts:await loadEpisodeScripts(channelId)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
  try{
    requireOperator(request);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Script Engine.',503);
    if(Number(request.headers.get('content-length')??0)>280000)throw new HttpError('Roteiro muito extenso.',413);
    const parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)throw new HttpError('Revise os campos do Script Engine e tente novamente.',400);
    const body=parsed.data;

    let script;
    if(body.action==='generate'){assertProviderAiAllowed();script=await generateScriptForProject(body.projectId);}
    else if(body.action==='importOperatorScript')script=await importOperatorScript(body);
    else if(body.action==='regenerateSection'){assertProviderAiAllowed();script=await regenerateScriptSection(body.scriptId,body.sectionId);}
    else script=await saveEpisodeScript(body.script,body.status,body.expectedVersion);

    const [history,project,productionDna]=await Promise.all([
      loadEpisodeScriptHistory(script.id,20),
      loadContentProject(script.contentProjectId),
      loadProductionDna(script.channelId)
    ]);
    return Response.json({
      message:body.action==='importOperatorScript'
        ?'Roteiro criado pelo ChatGPT operador, validado e salvo como draft.'
        :body.action==='generate'
        ?script.generation
          ?script.generation.stage==='complete'
            ?'Roteiro concluído: '+script.generation.completedSections+'/'+script.generation.totalSections+' seções geradas.'
            :'Roteiro em geração: '+script.generation.completedSections+'/'+script.generation.totalSections+' seções concluídas.'
          :'Roteiro gerado e salvo como draft.'
        :body.action==='regenerateSection'
          ?'Trecho regenerado e salvo como nova versão.'
          :body.status==='approved'
            ?'Roteiro aprovado.'
            :'Roteiro salvo.',
      script,
      history,
      project,
      productionDna
    });
  }catch(e){return errorResponse(e);}
}

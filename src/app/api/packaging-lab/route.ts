import { z } from 'zod';
import { authenticated, errorResponse, HttpError, requireOperator } from '@/lib/server/auth';
import { checked, db, dbConfigured } from '@/lib/server/db';
import type { ManagedChannel } from '@/lib/types';
import {
 createPackagingExperiment, recordPackagingSnapshot, packagingDiagnosis, packagingLearning,
 type PackagingExperiment, type PackagingSnapshot
} from '@/lib/packaging-experiment-policy';
import {
 createDefaultChannelBrain,loadChannelBrain,saveChannelBrain
} from '@/lib/server/channel-brain';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const uuid=z.string().uuid(),yt=z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),vid=z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const create=z.object({action:z.literal('create'),channelId:uuid,youtubeChannelId:yt,videoId:vid,
 kind:z.enum(['thumbnail','title']),baseline:z.object({title:z.string().min(1).max(100),thumbnailRef:z.string().min(1).max(300)}).strict(),
 candidate:z.object({title:z.string().max(100).optional(),thumbnailRef:z.string().max(300).optional()}).strict(),
 hypothesis:z.string().min(12).max(1200)}).strict();
const snapshot=z.object({action:z.literal('snapshot'),id:uuid,expectedRevision:z.number().int().positive(),snapshot:z.unknown()}).strict();
const conclude=z.object({action:z.literal('native-result'),id:uuid,expectedRevision:z.number().int().positive(),
 nativeResult:z.enum(['winner-baseline','winner-candidate','performed-same','inconclusive']),
 nativeReportRef:z.string().min(10).max(500),decision:z.string().min(5).max(1200)}).strict();
const learn=z.object({action:z.literal('learn'),id:uuid,expectedRevision:z.number().int().positive(),
 confirmation:z.literal('APROVO_APRENDIZADO_PARA_PROXIMO_VIDEO')}).strict();
const schema=z.discriminatedUnion('action',[create,snapshot,conclude,learn]);
const columns='id,channel_id,youtube_channel_id,video_id,phase,revision,payload,created_at,updated_at';
function normalize(row:Record<string,unknown>){
 return {...row.payload as PackagingExperiment,id:String(row.id),channelId:String(row.channel_id),
 youtubeChannelId:String(row.youtube_channel_id),videoId:String(row.video_id),
 phase:String(row.phase),revision:Number(row.revision),updatedAt:String(row.updated_at)} as PackagingExperiment;
}
async function managed(id:string){
 const row=checked(await db().from('radar_managed_channels').select('payload').eq('id',id).maybeSingle());
 if(!row)throw new HttpError('Projeto não encontrado na Gestão de Canais.',404);
 return row.payload as ManagedChannel;
}
async function load(id:string){
 const row=checked(await db().from('radar_packaging_experiments').select(columns).eq('id',id).maybeSingle());
 if(!row)throw new HttpError('Experimento não encontrado.',404);
 return normalize(row as Record<string,unknown>);
}
async function update(x:PackagingExperiment,oldRevision:number){
 const rows=checked(await db().from('radar_packaging_experiments').update({
  revision:x.revision,payload:x,phase:x.phase,updated_at:x.updatedAt
 }).eq('id',x.id).eq('revision',oldRevision).select('id'));
 if(!rows?.length)throw new HttpError('Experimento desatualizado. Recarregue antes de salvar.',409);
 return x;
}
export async function GET(request:Request){
 try{
  if(!authenticated(request))throw new HttpError('Autenticação necessária.',401);
  if(!dbConfigured())throw new HttpError('Banco indisponível.',503);
  const channelId=new URL(request.url).searchParams.get('channelId')??'';
  if(!uuid.safeParse(channelId).success)throw new HttpError('Canal inválido.',400);
  await managed(channelId);
  const rows=checked(await db().from('radar_packaging_experiments').select(columns)
   .eq('channel_id',channelId).order('updated_at',{ascending:false}).limit(100));
  const experiments=(rows??[]).map(row=>normalize(row as Record<string,unknown>));
  return Response.json({schema:'packaging-lab-v1',channelId,
   experiments:experiments.map(experiment=>({...experiment,diagnosis:packagingDiagnosis(experiment)})),
   readOnly:false,automaticPublication:false},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
export async function POST(request:Request){
 try{
  requireOperator(request);
  if(!dbConfigured())throw new HttpError('Banco indisponível.',503);
  if(Number(request.headers.get('content-length')??0)>60000)throw new HttpError('Requisição grande demais.',413);
  const parsed=schema.safeParse(await request.json());
  if(!parsed.success)throw new HttpError('Revise a estrutura do experimento.',400);
  const body=parsed.data;
  if(body.action==='create'){
   const channel=await managed(body.channelId);
   if(channel.sourceChannelId&&channel.sourceChannelId!==body.youtubeChannelId)
    throw new HttpError('ID YouTube diferente do projeto.',409);
   const experiment=createPackagingExperiment(body);
   checked(await db().from('radar_packaging_experiments').insert({
    id:experiment.id,channel_id:body.channelId,youtube_channel_id:body.youtubeChannelId,video_id:body.videoId,
    phase:experiment.phase,revision:1,payload:experiment,created_at:experiment.createdAt,updated_at:experiment.updatedAt
   }));
   return Response.json({experiment,diagnosis:packagingDiagnosis(experiment),message:'Hipótese registrada. Nenhuma alteração feita no YouTube.'});
  }
  const current=await load(body.id);
  if(current.revision!==body.expectedRevision)throw new HttpError('Revisão desatualizada.',409);
  if(body.action==='snapshot'){
   if(current.phase==='learned')throw new HttpError('Experimento já consolidado.',409);
   const next=recordPackagingSnapshot(current,body.snapshot as PackagingSnapshot);
   await update(next,current.revision);
   return Response.json({experiment:next,diagnosis:packagingDiagnosis(next)});
  }
  if(body.action==='native-result'){
   if(current.phase==='learned')throw new HttpError('Experimento já consolidado.',409);
   const next:PackagingExperiment={...current,nativeResult:body.nativeResult,nativeReportRef:body.nativeReportRef,
    decision:body.decision,phase:body.nativeResult==='inconclusive'||body.nativeResult==='performed-same'?'inconclusive':'evaluated',
    revision:current.revision+1,updatedAt:new Date().toISOString()};
   await update(next,current.revision);
   return Response.json({experiment:next,diagnosis:packagingDiagnosis(next),
    message:'Resultado registrado. Ainda não foi integrado ao Channel Brain.'});
  }
  if(!current.nativeResult||!current.nativeReportRef)throw new HttpError('Sem resultado nativo para promover.',409);
  const learning=packagingLearning(current);
  let brain=await loadChannelBrain(current.channelId);
  if(!brain){const channel=await managed(current.channelId);brain={
    ...createDefaultChannelBrain(channel),version:0
  };}
  const alreadyApplied=brain.learnings.some(item=>item.id===learning.id);
  if(!alreadyApplied){
   if(brain.learnings.length>=300)throw new HttpError('Channel Brain atingiu limite de aprendizados.',409);
   await saveChannelBrain({...brain,learnings:[...brain.learnings,learning]},brain.version||null);
  }
  const next:PackagingExperiment={...current,phase:'learned',learningId:learning.id,
   revision:current.revision+1,updatedAt:new Date().toISOString()};
  await update(next,current.revision);
  return Response.json({experiment:next,learning,alreadyApplied,
   message:'Aprendizado registrado no Channel Brain. O Next Episode poderá utilizá-lo; não publica nem altera vídeo.'});
 }catch(e){return errorResponse(e);}
}

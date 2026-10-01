import 'server-only';

import { checked, db } from './db';

export const currentProductionAgentId=()=>process.env.CACADORES_AGENT_ID?.trim().toLowerCase()||'atlas';

function safeSignature(id:string){
  const cleaned=id.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'agent';
  return '@'+cleaned.slice(0,48);
}

export async function ensureProductionAgent(agentId=currentProductionAgentId()){
  const existing=checked(await db().from('radar_agents').select('id').eq('id',agentId).maybeSingle());
  if(existing)return agentId;
  checked(await db().from('radar_agents').insert({
    id:agentId,
    display_name:(process.env.CACADORES_AGENT_NAME?.trim()||agentId).slice(0,120),
    signature:(process.env.CACADORES_AGENT_SIGNATURE?.trim()||safeSignature(agentId)).slice(0,80),
    provider:process.env.CACADORES_AGENT_PROVIDER?.trim()||'platform',
    model:process.env.CACADORES_AGENT_MODEL?.trim()||null,
    role:process.env.CACADORES_AGENT_ROLE?.trim()||'producer',
    status:'active',
    payload:{productionSystem:'factory-mode@1.1.0'}
  }));
  return agentId;
}

export async function registerProductionAgent(input:{
  id:string;displayName:string;signature:string;provider:string;model?:string|null;role:string;description?:string;
}){
  const id=input.id.trim().toLowerCase();
  checked(await db().from('radar_agents').upsert({
    id,
    display_name:input.displayName.trim(),
    signature:input.signature.trim(),
    provider:input.provider.trim(),
    model:input.model?.trim()||null,
    role:input.role.trim(),
    status:'active',
    payload:{description:input.description?.trim()||'',productionSystem:'factory-mode@1.1.0'},
    updated_at:new Date().toISOString()
  }));
  return id;
}

export async function episodeOwnerAgentId(episodeId:string){
  const row=checked(await db().from('radar_episode_agent_attributions')
    .select('agent_id').eq('episode_id',episodeId).eq('role','owner').maybeSingle());
  return row?String(row.agent_id):null;
}

export async function ensureEpisodeOwnerAttribution(input:{episodeId:string;channelId:string;agentId?:string;basis?:string;}){
  const existing=await episodeOwnerAgentId(input.episodeId);
  if(existing)return existing;
  const agentId=await ensureProductionAgent(input.agentId??currentProductionAgentId());
  checked(await db().from('radar_episode_agent_attributions').insert({
    episode_id:input.episodeId,
    channel_id:input.channelId,
    agent_id:agentId,
    role:'owner',
    weight:1,
    contribution:{basis:input.basis??'Factory Control assignment',productionSystem:'factory-mode@1.1.0'}
  }));
  return agentId;
}

export async function assignEpisodeOwner(input:{episodeId:string;channelId:string;agentId:string;basis?:string;}){
  await ensureProductionAgent(input.agentId);
  const current=checked(await db().from('radar_episode_agent_attributions')
    .select('id').eq('episode_id',input.episodeId).eq('role','owner').maybeSingle());
  const row={
    channel_id:input.channelId,
    agent_id:input.agentId,
    weight:1,
    contribution:{basis:input.basis??'Factory Control reassignment',productionSystem:'factory-mode@1.1.0'},
    updated_at:new Date().toISOString()
  };
  if(current){
    checked(await db().from('radar_episode_agent_attributions').update(row).eq('id',String(current.id)));
  }else{
    checked(await db().from('radar_episode_agent_attributions').insert({
      ...row,episode_id:input.episodeId,role:'owner'
    }));
  }
}

export async function reportAgentOperation(input:{
 operationKey:string;agentId:string;channelId?:string;episodeId?:string;batchKey?:string;
 stage:string;status:'ready'|'processing'|'blocked'|'review'|'completed'|'failed';
 progress:number;summary:string;blocker?:string;
}){
 const agentId=await ensureProductionAgent(input.agentId);
 const now=new Date().toISOString();
 checked(await db().from('radar_agent_operations').upsert({
  operation_key:input.operationKey,agent_id:agentId,channel_id:input.channelId??null,
  episode_id:input.episodeId??null,batch_key:input.batchKey??null,stage:input.stage,
  status:input.status,progress:Math.max(0,Math.min(100,Math.round(input.progress))),
  summary:input.summary.slice(0,4000),blocker:input.blocker?.slice(0,4000)??null,
  started_at:input.status==='processing'?now:null,completed_at:input.status==='completed'?now:null,
  updated_at:now
 },{onConflict:'operation_key'}));
 return agentId;
}

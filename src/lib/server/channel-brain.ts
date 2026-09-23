import 'server-only';

import type { ChannelBrain, ChannelBrainPayload, ChannelBrainVersion, ManagedChannel } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';

export function createDefaultChannelBrain(channel:ManagedChannel):ChannelBrainPayload{
  const now=new Date().toISOString();
  return {
    kind:'channel-brain',
    channelId:channel.id,
    constitution:{
      premise:channel.description||'',
      audience:'',
      editorialPromise:channel.description||'',
      worldview:'',
      tone:[],
      languageRules:[],
      humor:[],
      universeRules:[],
      forbidden:[],
      metaphors:[]
    },
    characters:[],
    narrative:{
      currentArc:'',
      stateSummary:'',
      establishedConcepts:[],
      partialConcepts:[],
      unknownConcepts:[],
      openThreads:[],
      resolvedThreads:[],
      doNotRepeat:[],
      nextConcepts:[]
    },
    learnings:[],
    createdAt:now,
    updatedAt:now
  };
}

export async function listChannelBrains():Promise<ChannelBrain[]>{
  const rows=checked(await db().from('radar_channel_brains')
    .select('id,version,payload,created_at,updated_at')
    .order('updated_at',{ascending:false})
    .limit(300));
  return (rows??[]).map(row=>({
    ...(row.payload as ChannelBrainPayload),
    channelId:row.id as string,
    version:Number(row.version)
  }));
}

export async function loadChannelBrain(channelId:string):Promise<ChannelBrain|null>{
  const row=checked(await db().from('radar_channel_brains')
    .select('id,version,payload')
    .eq('id',channelId)
    .maybeSingle());
  if(!row)return null;
  return {
    ...(row.payload as ChannelBrainPayload),
    channelId:row.id as string,
    version:Number(row.version)
  };
}

export async function loadChannelBrainHistory(channelId:string,limit=20):Promise<ChannelBrainVersion[]>{
  const rows=checked(await db().from('radar_channel_brain_versions')
    .select('version,payload,created_at')
    .eq('channel_id',channelId)
    .order('version',{ascending:false})
    .limit(Math.max(1,Math.min(limit,50))));
  return (rows??[]).map(row=>({
    version:Number(row.version),
    payload:row.payload as ChannelBrainPayload,
    createdAt:String(row.created_at)
  }));
}

export async function saveChannelBrain(
  payload:ChannelBrainPayload,
  expectedVersion:number|null
):Promise<ChannelBrain>{
  const now=new Date().toISOString();
  const current=await loadChannelBrain(payload.channelId);
  const normalized:ChannelBrainPayload={
    ...payload,
    createdAt:current?.createdAt??payload.createdAt??now,
    updatedAt:now
  };
  const result=checked(await db().rpc('save_channel_brain',{
    p_channel_id:payload.channelId,
    p_payload:normalized,
    p_expected_version:expectedVersion
  }));
  const version=Number(result);
  if(!Number.isFinite(version)||version<1)throw new HttpError('Falha ao versionar o Channel Brain.',502);
  return {...normalized,version};
}

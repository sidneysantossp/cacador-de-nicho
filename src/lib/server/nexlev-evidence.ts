import 'server-only';

import type { ManagedChannel } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { callNexLevTool, listNexLevTools } from './nexlev';

export type NexLevEvidenceSource={
  ref:string;
  type:'market';
  summary:string;
  confidence:'low'|'medium'|'high';
};

export type NexLevEvidenceItem={
  id:string;
  kind:'video'|'channel';
  title:string;
  channelTitle:string;
  url:string;
  views:number|null;
  subscribers:number|null;
  outlierScore:number|null;
  publishedAt:string|null;
  score:number|null;
  sourceTool:string;
};export type NexLevEvidencePack={
  kind:'nexlev-evidence-pack';
  id:string;
  channelId:string;
  channelName:string;
  profileKey:string;
  generatedAt:string;
  queries:{broad:string;focused:string;channels:string};
  tools:string[];
  items:NexLevEvidenceItem[];
  conclusions:string[];
  limitations:string[];
};

type Profile={key:string;broad:string;focused:string;channels:string};

function profileFor(channel:ManagedChannel):Profile{
  const name=channel.name.toLowerCase();
  if(name.includes('grug'))return {
    key:'grug-personal-finance',
    broad:'personal finance explained simply budgeting investing debt money psychology financial education visual metaphors',
    focused:'debt leverage collateral borrowing against assets productive debt personal finance explained',
    channels:'personal finance simple money psychology budgeting investing financial education'
  };  if(name.includes('dino'))return {
    key:'dino-future-ai',
    broad:'artificial intelligence future of humanity robots jobs automation extinction technology risks human civilization',
    focused:'humanoid robots AI gets a body automation jobs future humans robots workforce',
    channels:'artificial intelligence future humanity robots automation technology future society'
  };
  const fallback=[channel.niche,channel.description,channel.format].filter(Boolean).join(' ').slice(0,500);
  return {key:'managed-channel',broad:fallback,focused:fallback,channels:fallback};
}

function numberOrNull(value:unknown){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}
function stringOrNull(value:unknown){
  return typeof value==='string'&&value.trim()?value.trim():null;
}
function structured(result:unknown){
  const value=result as {structuredContent?:Record<string,unknown>}|null;
  return value?.structuredContent??{};
}
function toolFailure(tool:string,result:unknown){
  const value=result as {isError?:boolean;content?:Array<{type?:string;text?:string}>}|null;
  if(!value?.isError)return null;
  const message=(value.content??[]).map(item=>item.text??'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  return {
    tool,
    message:(message||'NexLev tool returned an error.').slice(0,600),
    rateLimited:/rate limit exceeded|used \d+\/\d+ calls/i.test(message)
  };
}
function rows(result:unknown,keys:string[]){
  const data=structured(result);
  for(const key of keys){
    const value=data[key];
    if(Array.isArray(value))return value as Array<Record<string,unknown>>;
  }
  return [] as Array<Record<string,unknown>>;
}function videoItem(row:Record<string,unknown>,tool:string):NexLevEvidenceItem|null{
  const videoId=stringOrNull(row.videoId);
  const title=stringOrNull(row.videoTitle);
  if(!videoId||!title)return null;
  const channelId=stringOrNull(row.ytChannelId);
  return {
    id:'video:'+videoId,
    kind:'video',
    title,
    channelTitle:stringOrNull(row.channelTitle)??'Unknown channel',
    url:'https://www.youtube.com/watch?v='+encodeURIComponent(videoId),
    views:numberOrNull(row.videoViews),
    subscribers:numberOrNull(row.channelSubCount),
    outlierScore:numberOrNull(row.outlierScore),
    publishedAt:stringOrNull(row.videoPublishedAt),
    score:numberOrNull(row.score),
    sourceTool:tool
  };
}

function channelItem(row:Record<string,unknown>,tool:string):NexLevEvidenceItem|null{
  const channelId=stringOrNull(row.ytChannelId)??stringOrNull(row.channelId);
  const title=stringOrNull(row.channelTitle)??stringOrNull(row.title)??stringOrNull(row.name);
  if(!channelId||!title)return null;
  return {
    id:'channel:'+channelId,
    kind:'channel',
    title,
    channelTitle:title,
    url:'https://www.youtube.com/channel/'+encodeURIComponent(channelId),
    views:numberOrNull(row.avgViewsPerVideo)??numberOrNull(row.avgViews),
    subscribers:numberOrNull(row.channelSubCount)??numberOrNull(row.subscriberCount),
    outlierScore:numberOrNull(row.outlierScore),
    publishedAt:stringOrNull(row.lastUploadAt)??stringOrNull(row.lastUploadDate),
    score:numberOrNull(row.score),
    sourceTool:tool
  };
}function compact(value:number|null){
  if(value===null)return 'n/d';
  return new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
}
function itemSummary(item:NexLevEvidenceItem){
  if(item.kind==='video'){
    return item.title+' — '+compact(item.views)+' views on '+item.channelTitle+
      ' ('+compact(item.subscribers)+' subscribers, outlier '+(item.outlierScore?.toFixed(2)??'n/d')+').';
  }
  return item.channelTitle+' — '+compact(item.subscribers)+' subscribers; avg views '+compact(item.views)+
    '; outlier '+(item.outlierScore?.toFixed(2)??'n/d')+'.';
}
function uniqueItems(items:NexLevEvidenceItem[]){
  const seen=new Set<string>();
  return items.filter(item=>!seen.has(item.id)&&(seen.add(item.id),true));
}
function recentCutoff(days=120){
  const date=new Date(Date.now()-days*86400000);
  return date.toISOString().slice(0,10);
}

async function managedChannel(channelId:string){
  const row=checked(await db().from('radar_managed_channels').select('payload').eq('id',channelId).maybeSingle());
  if(!row)throw new HttpError('Canal gerenciado não encontrado.',404);
  return row.payload as ManagedChannel;
}export async function listNexLevEvidencePacks(channelId:string,limit=20):Promise<NexLevEvidencePack[]>{
  const rows=checked(await db().from('radar_nexlev_evidence_packs')
    .select('payload').eq('channel_id',channelId)
    .order('generated_at',{ascending:false}).limit(Math.max(1,Math.min(limit,100))));
  return (rows??[]).map(row=>row.payload as NexLevEvidencePack);
}

export async function latestNexLevEvidencePack(channelId:string){
  return (await listNexLevEvidencePacks(channelId,1))[0]??null;
}

export async function latestNexLevEvidenceSources(channelId:string):Promise<NexLevEvidenceSource[]>{
  const pack=await latestNexLevEvidencePack(channelId);
  if(!pack)return [];
  return pack.items.slice(0,20).map(item=>({
    ref:'market:nexlev:'+item.id,
    type:'market' as const,
    summary:itemSummary(item),
    confidence:item.kind==='video'&&((item.outlierScore??0)>=4||(item.views??0)>=250000)?'high' as const:'medium' as const
  }));
}

export async function refreshNexLevEvidencePack(channelId:string):Promise<NexLevEvidencePack>{
  const channel=await managedChannel(channelId);
  const profile=profileFor(channel);
  const available=new Set((await listNexLevTools()).map(tool=>tool.name).filter(Boolean));
  const required=['faceless_outliers_videos','search_niche_finder_channels'];
  const missing=required.filter(name=>!available.has(name));
  if(missing.length)throw new HttpError('A conta NexLev conectada não oferece: '+missing.join(', ')+'.',409);
  const cutoff=recentCutoff();  const videoArgs=(query:string)=>({
    query,languages:['english'],videoType:'long',isFaceless:true,isQualified:true,
    minDuration:600,minOutlierScore:2,maxSubscribers:100000,minUploadDate:cutoff,
    limit:8,minScore:.4,excludeSeenVideos:false
  });
  const channelArgs={
    query:profile.channels,limit:8,maxSubscribers:100000,minAvgViewsPerVideo:20000,
    minAvgVideoLength:600,isFaceless:true,isShortsOnly:false,channelLanguage:['en'],
    channelCreatedAfter:'2025-01-01',lastUploadAfter:cutoff,minOutlierScore:2,minScore:.4
  };

  const [broad,focused,channels]=await Promise.all([
    callNexLevTool('faceless_outliers_videos',videoArgs(profile.broad)),
    callNexLevTool('faceless_outliers_videos',videoArgs(profile.focused)),
    callNexLevTool('search_niche_finder_channels',channelArgs)
  ]);
  const failures=[
    toolFailure('faceless_outliers_videos:broad',broad),
    toolFailure('faceless_outliers_videos:focused',focused),
    toolFailure('search_niche_finder_channels',channels)
  ].filter(Boolean) as Array<{tool:string;message:string;rateLimited:boolean}>;
  if(failures.length===3){
    throw new HttpError('NexLev não concluiu a varredura: '+failures.map(item=>item.message).join(' · '),failures.some(item=>item.rateLimited)?429:502);
  }

  const items=uniqueItems([
    ...rows(broad,['videos']).map(row=>videoItem(row,'faceless_outliers_videos')).filter(Boolean),
    ...rows(focused,['videos']).map(row=>videoItem(row,'faceless_outliers_videos')).filter(Boolean),
    ...rows(channels,['channels','results']).map(row=>channelItem(row,'search_niche_finder_channels')).filter(Boolean)
  ] as NexLevEvidenceItem[]).sort((a,b)=>(b.outlierScore??0)-(a.outlierScore??0)||(b.views??0)-(a.views??0));  const best=items.find(item=>item.kind==='video')??null;
  const now=new Date().toISOString();
  const pack:NexLevEvidencePack={
    kind:'nexlev-evidence-pack',
    id:crypto.randomUUID(),
    channelId:channel.id,
    channelName:channel.name,
    profileKey:profile.key,
    generatedAt:now,
    queries:{broad:profile.broad,focused:profile.focused,channels:profile.channels},
    tools:['faceless_outliers_videos','search_niche_finder_channels'],
    items:items.slice(0,24),
    conclusions:[
      items.length+' sinais normalizados foram preservados nesta rodada.',
      best?'Maior sinal de vídeo: '+itemSummary(best):
        failures.some(item=>item.tool.startsWith('faceless_outliers_videos'))
          ?'A busca de vídeos ficou parcial por limite/erro do NexLev; não interpretar como ausência de vencedores.'
          :'Nenhum vídeo passou pelos filtros nesta rodada.'
    ],
    limitations:[
      'NexLev é fonte de descoberta e sinal de mercado; não prova causalidade de performance.',
      'A conta conectada pode impor cotas por ferramenta e janela de renovação.',
      'Resultados sem correspondência semântica suficiente não devem ser tratados como validação do tópico.',
      ...failures.map(item=>'Falha parcial em '+item.tool+': '+item.message)
    ]
  };
  checked(await db().from('radar_nexlev_evidence_packs').insert({
    id:pack.id,channel_id:pack.channelId,profile_key:pack.profileKey,payload:pack,generated_at:pack.generatedAt
  }));
  return pack;
}

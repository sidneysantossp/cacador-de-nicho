import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LinkedYouTubeChannel, PendingYouTubeLink, YouTubeConnection } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  decryptYouTubeRefreshToken, encryptYouTubeRefreshToken, youtubeOAuthConfig
} from './youtube-secrets';

const TOKEN_ENDPOINT=(process.env.YOUTUBE_TOKEN_ENDPOINT??'https://oauth2.googleapis.com/token').trim();

export const YOUTUBE_OAUTH_SCOPES=[
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
] as const;

type OAuthStatePayload={channelId:string;nonce:string;exp:number};
type TokenResponse={
  access_token?:string;
  expires_in?:number;
  refresh_token?:string;
  scope?:string;
  token_type?:string;
  error?:string;
  error_description?:string;
};
type ChannelListResponse={
  items?:Array<{
    id?:string;
    snippet?:{
      title?:string;
      customUrl?:string;
      thumbnails?:Record<string,{url?:string}>;
    };
    statistics?:{
      viewCount?:string;
      subscriberCount?:string;
      videoCount?:string;
      hiddenSubscriberCount?:boolean;
    };
  }>;
  error?:{message?:string};
};

function stateSecret(){
  const value=(process.env.SESSION_SECRET??'').trim();
  if(value.length<24)throw new HttpError('SESSION_SECRET indisponível para proteger OAuth state.',503);
  return value;
}
function b64(value:string|Buffer){
  return Buffer.from(value).toString('base64url');
}
function sign(value:string){
  return createHmac('sha256',stateSecret()).update(value).digest('base64url');
}

export function createYouTubeOAuthState(channelId:string){
  const payload:OAuthStatePayload={
    channelId,
    nonce:randomBytes(18).toString('base64url'),
    exp:Date.now()+10*60*1000
  };
  const body=b64(JSON.stringify(payload));
  return body+'.'+sign(body);
}

export function verifyYouTubeOAuthState(value:string){
  const [body,signature]=String(value??'').split('.');
  if(!body||!signature)throw new HttpError('OAuth state inválido.',400);
  const expected=Buffer.from(sign(body));
  const actual=Buffer.from(signature);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){
    throw new HttpError('OAuth state inválido.',400);
  }
  let payload:OAuthStatePayload;
  try{
    payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as OAuthStatePayload;
  }catch{
    throw new HttpError('OAuth state inválido.',400);
  }
  if(!payload.channelId||!payload.nonce||payload.exp<Date.now()){
    throw new HttpError('OAuth state expirado ou inválido.',400);
  }
  return payload;
}

export function youtubeAuthorizationUrl(channelId:string){
  const config=youtubeOAuthConfig();
  if(!config.configured)throw new HttpError('OAuth do YouTube ainda não está configurado: '+config.missing.join(', ')+'.',503);
  const state=createYouTubeOAuthState(channelId);
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',config.clientId);
  url.searchParams.set('redirect_uri',config.redirectUri);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',YOUTUBE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type','offline');
  url.searchParams.set('include_granted_scopes','true');
  url.searchParams.set('prompt','consent');
  url.searchParams.set('state',state);
  return {url:url.toString(),state};
}

async function tokenRequest(params:URLSearchParams){
  const response=await fetch(TOKEN_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params,
    cache:'no-store'
  });
  const body=await response.json().catch(()=>({})) as TokenResponse;
  if(!response.ok||!body.access_token){
    throw new HttpError('Falha ao obter token do YouTube: '+(body.error_description??body.error??response.statusText)+'.',502);
  }
  return body;
}

export async function exchangeYouTubeAuthorizationCode(code:string){
  const config=youtubeOAuthConfig();
  if(!config.configured)throw new HttpError('OAuth do YouTube ainda não está configurado.',503);
  return tokenRequest(new URLSearchParams({
    client_id:config.clientId,
    client_secret:config.clientSecret,
    code,
    grant_type:'authorization_code',
    redirect_uri:config.redirectUri
  }));
}

export async function refreshYouTubeAccessToken(refreshToken:string){
  const config=youtubeOAuthConfig();
  if(!config.configured)throw new HttpError('OAuth do YouTube ainda não está configurado.',503);
  return tokenRequest(new URLSearchParams({
    client_id:config.clientId,
    client_secret:config.clientSecret,
    refresh_token:refreshToken,
    grant_type:'refresh_token'
  }));
}

function optionalCount(value:string|undefined){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:undefined;
}

export async function fetchOwnYouTubeChannel(accessToken:string){
  const url=new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part','id,snippet,statistics');
  url.searchParams.set('mine','true');
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const body=await response.json().catch(()=>({})) as ChannelListResponse;
  if(!response.ok)throw new HttpError('Falha ao identificar o canal do YouTube: '+(body.error?.message??response.statusText)+'.',502);
  const items=body.items??[];
  if(items.length>1){
    throw new HttpError('A autorização retornou mais de um canal YouTube. Defina ou selecione o canal desejado na Conta Google e tente conectar novamente.',409);
  }
  const item=items[0];
  if(!item?.id)throw new HttpError('A conta Google autorizada não possui canal do YouTube disponível.',409);
  const thumbnails=item.snippet?.thumbnails??{};
  const thumb=thumbnails.high?.url??thumbnails.medium?.url??thumbnails.default?.url;
  return {
    youtubeChannelId:item.id,
    youtubeTitle:item.snippet?.title?.trim()||item.id,
    youtubeHandle:item.snippet?.customUrl?.trim()||undefined,
    youtubeThumbnail:thumb,
    subscriberCount:item.statistics?.hiddenSubscriberCount?undefined:optionalCount(item.statistics?.subscriberCount),
    videoCount:optionalCount(item.statistics?.videoCount),
    viewCount:optionalCount(item.statistics?.viewCount)
  };
}

type ConnectionRow={
  id:string;channel_id:string;youtube_channel_id:string;youtube_title:string;
  youtube_handle:string|null;youtube_thumbnail:string|null;scopes:string[]|null;
  status:'connected'|'needs-reauth'|'disconnected';last_validated_at:string|null;
  error:string|null;created_at:string;updated_at:string;
};
type YouTubeChannelRow={
  id:string;youtube_channel_id:string;youtube_title:string;youtube_handle:string|null;
  youtube_thumbnail:string|null;subscriber_count:number|string|null;video_count:number|string|null;
  view_count:number|string|null;scopes:string[]|null;refresh_token_ciphertext?:string;
  token_aad?:string;status:'connected'|'needs-reauth'|'disconnected';
  last_validated_at:string|null;error:string|null;created_at:string;updated_at:string;
};
type ProjectYouTubeLinkRow={
  id:string;project_id:string;youtube_channel_id:string;is_primary:boolean;
  created_at:string;updated_at:string;
};
type PendingYouTubeLinkRow={
  id:string;project_id:string;youtube_channel_id:string;youtube_title:string;
  youtube_handle:string|null;youtube_thumbnail:string|null;subscriber_count:number|string|null;
  video_count:number|string|null;view_count:number|string|null;scopes:string[]|null;
  refresh_token_ciphertext?:string;token_aad?:string;
  status:'pending'|'confirmed'|'cancelled'|'expired';expires_at:string;
  created_at:string;updated_at:string;
};

function normalizeConnection(row:ConnectionRow):YouTubeConnection{
  return {
    id:row.id,
    channelId:row.channel_id,
    youtubeChannelId:row.youtube_channel_id,
    youtubeTitle:row.youtube_title,
    youtubeHandle:row.youtube_handle??undefined,
    youtubeThumbnail:row.youtube_thumbnail??undefined,
    scopes:row.scopes??[],
    status:row.status,
    lastValidatedAt:row.last_validated_at??undefined,
    error:row.error??undefined,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function countValue(value:number|string|null){
  if(value===null)return undefined;
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:undefined;
}

async function pendingRow(id:string,withSecret=false){
  const fields='id,project_id,youtube_channel_id,youtube_title,youtube_handle,youtube_thumbnail,subscriber_count,video_count,view_count,scopes,status,expires_at,created_at,updated_at'
    +(withSecret?',refresh_token_ciphertext,token_aad':'');
  return checked(await db().from('radar_youtube_oauth_pending').select(fields).eq('id',id).maybeSingle()) as PendingYouTubeLinkRow|null;
}

async function expirePending(row:PendingYouTubeLinkRow){
  checked(await db().from('radar_youtube_oauth_pending').update({
    status:'expired',
    refresh_token_ciphertext:encryptYouTubeRefreshToken('expired',row.id),
    token_aad:row.id,
    updated_at:new Date().toISOString()
  }).eq('id',row.id).eq('status','pending'));
}

export async function loadPendingYouTubeLink(id:string):Promise<PendingYouTubeLink|null>{
  const row=await pendingRow(id,false);
  if(!row)return null;
  if(row.status!=='pending')throw new HttpError('Esta confirmação de canal YouTube não está mais pendente.',409);
  if(new Date(row.expires_at).getTime()<=Date.now()){
    await expirePending(row);
    throw new HttpError('A confirmação do canal YouTube expirou. Inicie a conexão novamente.',410);
  }
  const project=checked(await db().from('radar_managed_channels').select('payload').eq('id',row.project_id).maybeSingle());
  if(!project)throw new HttpError('Projeto de destino não encontrado.',404);
  return {
    id:row.id,
    projectId:row.project_id,
    projectName:String((project.payload as {name?:unknown}|null)?.name??'Projeto sem nome'),
    youtubeChannelId:row.youtube_channel_id,
    youtubeTitle:row.youtube_title,
    youtubeHandle:row.youtube_handle??undefined,
    youtubeThumbnail:row.youtube_thumbnail??undefined,
    subscriberCount:countValue(row.subscriber_count),
    videoCount:countValue(row.video_count),
    viewCount:countValue(row.view_count),
    scopes:row.scopes??[],
    expiresAt:row.expires_at,
    createdAt:row.created_at
  };
}

export async function createPendingYouTubeLink(input:{
  channelId:string;
  refreshToken:string;
  scopes:string[];
  youtubeChannelId:string;
  youtubeTitle:string;
  youtubeHandle?:string;
  youtubeThumbnail?:string;
  subscriberCount?:number;
  videoCount?:number;
  viewCount?:number;
}){
  const project=checked(await db().from('radar_managed_channels').select('id').eq('id',input.channelId).maybeSingle());
  if(!project)throw new HttpError('Projeto interno não encontrado.',404);
  const id=crypto.randomUUID();
  const now=new Date();
  const expiresAt=new Date(now.getTime()+20*60*1000).toISOString();
  checked(await db().from('radar_youtube_oauth_pending').insert({
    id,
    project_id:input.channelId,
    youtube_channel_id:input.youtubeChannelId,
    youtube_title:input.youtubeTitle,
    youtube_handle:input.youtubeHandle??null,
    youtube_thumbnail:input.youtubeThumbnail??null,
    subscriber_count:input.subscriberCount??null,
    video_count:input.videoCount??null,
    view_count:input.viewCount??null,
    scopes:[...new Set(input.scopes)].sort(),
    refresh_token_ciphertext:encryptYouTubeRefreshToken(input.refreshToken,id),
    token_aad:id,
    status:'pending',
    expires_at:expiresAt,
    updated_at:now.toISOString()
  }));
  const pending=await loadPendingYouTubeLink(id);
  if(!pending)throw new HttpError('Conexão identificada, mas a confirmação não pôde ser criada.',502);
  return pending;
}

export async function confirmPendingYouTubeLink(id:string){
  const row=await pendingRow(id,true);
  if(!row)throw new HttpError('Confirmação de canal YouTube não encontrada.',404);
  if(row.status!=='pending')throw new HttpError('Esta confirmação de canal YouTube não está mais pendente.',409);
  if(new Date(row.expires_at).getTime()<=Date.now()){
    await expirePending(row);
    throw new HttpError('A confirmação do canal YouTube expirou. Inicie a conexão novamente.',410);
  }
  const refreshToken=decryptYouTubeRefreshToken(String(row.refresh_token_ciphertext),String(row.token_aad));
  await saveYouTubeConnection({
    channelId:row.project_id,
    refreshToken,
    scopes:row.scopes??[],
    youtubeChannelId:row.youtube_channel_id,
    youtubeTitle:row.youtube_title,
    youtubeHandle:row.youtube_handle??undefined,
    youtubeThumbnail:row.youtube_thumbnail??undefined,
    subscriberCount:countValue(row.subscriber_count),
    videoCount:countValue(row.video_count),
    viewCount:countValue(row.view_count)
  });
  checked(await db().from('radar_youtube_oauth_pending').update({
    status:'confirmed',
    refresh_token_ciphertext:encryptYouTubeRefreshToken('confirmed',row.id),
    token_aad:row.id,
    updated_at:new Date().toISOString()
  }).eq('id',row.id).eq('status','pending'));
  return (await listLinkedYouTubeChannels()).find(item=>item.youtubeChannelId===row.youtube_channel_id)??null;
}

export async function cancelPendingYouTubeLink(id:string){
  const row=await pendingRow(id,true);
  if(!row)return null;
  if(row.status!=='pending')return null;
  checked(await db().from('radar_youtube_oauth_pending').update({
    status:'cancelled',
    refresh_token_ciphertext:encryptYouTubeRefreshToken('cancelled',row.id),
    token_aad:row.id,
    updated_at:new Date().toISOString()
  }).eq('id',row.id).eq('status','pending'));
  return {id:row.id,status:'cancelled' as const};
}

const selection='id,channel_id,youtube_channel_id,youtube_title,youtube_handle,youtube_thumbnail,scopes,status,last_validated_at,error,created_at,updated_at';
const linkedSelection='id,youtube_channel_id,youtube_title,youtube_handle,youtube_thumbnail,subscriber_count,video_count,view_count,scopes,status,last_validated_at,error,created_at,updated_at';

export async function loadYouTubeConnection(channelId:string):Promise<YouTubeConnection|null>{
  const row=checked(await db().from('radar_youtube_connections')
    .select(selection).eq('channel_id',channelId).maybeSingle());
  return row?normalizeConnection(row as ConnectionRow):null;
}

export async function loadYouTubeConnectionSecret(connectionId:string){
  const row=checked(await db().from('radar_youtube_connections')
    .select('id,channel_id,youtube_channel_id,status,refresh_token_ciphertext')
    .eq('id',connectionId).maybeSingle());
  if(!row)throw new HttpError('Conexão YouTube não encontrada.',404);
  if(row.status!=='connected')throw new HttpError('Conexão YouTube precisa ser reautorizada.',409);
  return {
    id:String(row.id),
    channelId:String(row.channel_id),
    youtubeChannelId:String(row.youtube_channel_id),
    refreshToken:decryptYouTubeRefreshToken(String(row.refresh_token_ciphertext),String(row.channel_id))
  };
}

export async function listLinkedYouTubeChannels():Promise<LinkedYouTubeChannel[]>{
  const links=(checked(await db().from('radar_project_youtube_channels')
    .select('id,project_id,youtube_channel_id,is_primary,created_at,updated_at')
    .order('created_at',{ascending:true}))??[]) as ProjectYouTubeLinkRow[];
  if(!links.length)return [];

  const youtubeIds=[...new Set(links.map(link=>link.youtube_channel_id))];
  const projectIds=[...new Set(links.map(link=>link.project_id))];
  const [channelRows,projectRows]=await Promise.all([
    db().from('radar_youtube_channels').select(linkedSelection).in('id',youtubeIds),
    db().from('radar_managed_channels').select('id,payload').in('id',projectIds)
  ]);
  const channels=(checked(channelRows)??[]) as YouTubeChannelRow[];
  const projects=(checked(projectRows)??[]) as Array<{id:string;payload:unknown}>;
  const channelById=new Map(channels.map(row=>[row.id,row]));
  const projectById=new Map(projects.map(row=>[
    row.id,
    String((row.payload as {name?:unknown}|null)?.name??'Projeto sem nome')
  ]));

  return links.flatMap(link=>{
    const row=channelById.get(link.youtube_channel_id);
    if(!row)return [];
    return [{
      id:row.id,
      youtubeChannelId:row.youtube_channel_id,
      youtubeTitle:row.youtube_title,
      youtubeHandle:row.youtube_handle??undefined,
      youtubeThumbnail:row.youtube_thumbnail??undefined,
      subscriberCount:countValue(row.subscriber_count),
      videoCount:countValue(row.video_count),
      viewCount:countValue(row.view_count),
      scopes:row.scopes??[],
      status:row.status,
      lastValidatedAt:row.last_validated_at??undefined,
      error:row.error??undefined,
      projectId:link.project_id,
      projectName:projectById.get(link.project_id)??'Projeto não encontrado',
      isPrimary:Boolean(link.is_primary),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    } satisfies LinkedYouTubeChannel];
  });
}

export async function loadLinkedYouTubeChannel(id:string){
  return (await listLinkedYouTubeChannels()).find(item=>item.id===id)??null;
}

async function saveIndependentYouTubeChannel(input:{
  channelId:string;
  refreshToken:string;
  scopes:string[];
  youtubeChannelId:string;
  youtubeTitle:string;
  youtubeHandle?:string;
  youtubeThumbnail?:string;
  subscriberCount?:number;
  videoCount?:number;
  viewCount?:number;
}){
  const existing=checked(await db().from('radar_youtube_channels')
    .select('id').eq('youtube_channel_id',input.youtubeChannelId).maybeSingle());
  const id=existing?.id?String(existing.id):crypto.randomUUID();
  const existingLink=existing
    ?checked(await db().from('radar_project_youtube_channels')
      .select('id,project_id,is_primary').eq('youtube_channel_id',id).maybeSingle())
    :null;
  if(existingLink&&String(existingLink.project_id)!==input.channelId){
    throw new HttpError('Este canal do YouTube já está vinculado a outro projeto. Altere o vínculo na Gestão de projetos antes de continuar.',409);
  }

  const projectLinks=checked(await db().from('radar_project_youtube_channels')
    .select('id,is_primary').eq('project_id',input.channelId))??[];
  const isPrimary=existingLink?Boolean(existingLink.is_primary):projectLinks.length===0;
  const now=new Date().toISOString();

  checked(await db().from('radar_youtube_channels').upsert({
    id,
    youtube_channel_id:input.youtubeChannelId,
    youtube_title:input.youtubeTitle,
    youtube_handle:input.youtubeHandle??null,
    youtube_thumbnail:input.youtubeThumbnail??null,
    subscriber_count:input.subscriberCount??null,
    video_count:input.videoCount??null,
    view_count:input.viewCount??null,
    scopes:[...new Set(input.scopes)].sort(),
    refresh_token_ciphertext:encryptYouTubeRefreshToken(input.refreshToken,input.youtubeChannelId),
    token_aad:input.youtubeChannelId,
    status:'connected',
    last_validated_at:now,
    error:null,
    updated_at:now
  },{onConflict:'youtube_channel_id'}));

  if(existingLink){
    checked(await db().from('radar_project_youtube_channels')
      .update({updated_at:now}).eq('id',String(existingLink.id)));
  }else{
    checked(await db().from('radar_project_youtube_channels').insert({
      id:crypto.randomUUID(),
      project_id:input.channelId,
      youtube_channel_id:id,
      is_primary:isPrimary,
      updated_at:now
    }));
  }
  return {id,isPrimary};
}

export async function saveYouTubeConnection(input:{
  channelId:string;
  refreshToken:string;
  scopes:string[];
  youtubeChannelId:string;
  youtubeTitle:string;
  youtubeHandle?:string;
  youtubeThumbnail?:string;
  subscriberCount?:number;
  videoCount?:number;
  viewCount?:number;
}){
  const project=checked(await db().from('radar_managed_channels').select('id').eq('id',input.channelId).maybeSingle());
  if(!project)throw new HttpError('Projeto interno não encontrado.',404);

  const independent=await saveIndependentYouTubeChannel(input);
  if(independent.isPrimary){
    const existing=checked(await db().from('radar_youtube_connections')
      .select('id').eq('channel_id',input.channelId).maybeSingle());
    const id=existing?.id?String(existing.id):independent.id;
    const now=new Date().toISOString();
    checked(await db().from('radar_youtube_connections').upsert({
      id,
      channel_id:input.channelId,
      youtube_channel_id:input.youtubeChannelId,
      youtube_title:input.youtubeTitle,
      youtube_handle:input.youtubeHandle??null,
      youtube_thumbnail:input.youtubeThumbnail??null,
      scopes:[...new Set(input.scopes)].sort(),
      refresh_token_ciphertext:encryptYouTubeRefreshToken(input.refreshToken,input.channelId),
      status:'connected',
      last_validated_at:now,
      error:null,
      updated_at:now
    },{onConflict:'channel_id'}));
  }
  return loadYouTubeConnection(input.channelId);
}

export async function validateLinkedYouTubeChannel(id:string){
  const row=checked(await db().from('radar_youtube_channels')
    .select(linkedSelection+',refresh_token_ciphertext,token_aad').eq('id',id).maybeSingle()) as YouTubeChannelRow|null;
  if(!row)throw new HttpError('Canal YouTube conectado não encontrado.',404);
  if(row.status!=='connected')return loadLinkedYouTubeChannel(id);

  const link=checked(await db().from('radar_project_youtube_channels')
    .select('project_id,is_primary').eq('youtube_channel_id',id).maybeSingle());
  try{
    const refresh=decryptYouTubeRefreshToken(String(row.refresh_token_ciphertext),String(row.token_aad));
    const token=await refreshYouTubeAccessToken(refresh);
    const own=await fetchOwnYouTubeChannel(token.access_token!);
    if(own.youtubeChannelId!==row.youtube_channel_id){
      throw new HttpError('A credencial OAuth respondeu por um canal diferente do canal vinculado.',409);
    }
    const now=new Date().toISOString();
    checked(await db().from('radar_youtube_channels').update({
      youtube_title:own.youtubeTitle,
      youtube_handle:own.youtubeHandle??null,
      youtube_thumbnail:own.youtubeThumbnail??null,
      subscriber_count:own.subscriberCount??null,
      video_count:own.videoCount??null,
      view_count:own.viewCount??null,
      last_validated_at:now,
      error:null,
      updated_at:now
    }).eq('id',id));
    if(link?.is_primary){
      checked(await db().from('radar_youtube_connections').update({
        youtube_channel_id:own.youtubeChannelId,
        youtube_title:own.youtubeTitle,
        youtube_handle:own.youtubeHandle??null,
        youtube_thumbnail:own.youtubeThumbnail??null,
        status:'connected',
        last_validated_at:now,
        error:null,
        updated_at:now
      }).eq('channel_id',String(link.project_id)));
    }
  }catch(error){
    const now=new Date().toISOString();
    const message=error instanceof Error?error.message:'Falha ao validar conexão YouTube.';
    checked(await db().from('radar_youtube_channels').update({
      status:'needs-reauth',error:message,updated_at:now
    }).eq('id',id));
    if(link?.is_primary){
      checked(await db().from('radar_youtube_connections').update({
        status:'needs-reauth',error:message,updated_at:now
      }).eq('channel_id',String(link.project_id)));
    }
  }
  return loadLinkedYouTubeChannel(id);
}

export async function validateYouTubeConnection(channelId:string){
  const row=checked(await db().from('radar_youtube_connections')
    .select('id,channel_id,refresh_token_ciphertext,status')
    .eq('channel_id',channelId).maybeSingle());
  if(!row)return null;
  if(row.status!=='connected')return loadYouTubeConnection(channelId);
  try{
    const refresh=decryptYouTubeRefreshToken(String(row.refresh_token_ciphertext),channelId);
    const token=await refreshYouTubeAccessToken(refresh);
    const own=await fetchOwnYouTubeChannel(token.access_token!);
    checked(await db().from('radar_youtube_connections').update({
      youtube_channel_id:own.youtubeChannelId,
      youtube_title:own.youtubeTitle,
      youtube_handle:own.youtubeHandle??null,
      youtube_thumbnail:own.youtubeThumbnail??null,
      last_validated_at:new Date().toISOString(),
      error:null,
      updated_at:new Date().toISOString()
    }).eq('id',String(row.id)));
  }catch(error){
    checked(await db().from('radar_youtube_connections').update({
      status:'needs-reauth',
      error:error instanceof Error?error.message:'Falha ao validar conexão YouTube.',
      updated_at:new Date().toISOString()
    }).eq('id',String(row.id)));
  }
  return loadYouTubeConnection(channelId);
}

export async function disconnectYouTube(channelId:string){
  const row=checked(await db().from('radar_youtube_connections')
    .select('id').eq('channel_id',channelId).maybeSingle());
  if(!row)return null;
  checked(await db().from('radar_youtube_connections').update({
    status:'disconnected',
    refresh_token_ciphertext:encryptYouTubeRefreshToken('revoked',channelId),
    error:null,
    updated_at:new Date().toISOString()
  }).eq('id',String(row.id)));
  return loadYouTubeConnection(channelId);
}

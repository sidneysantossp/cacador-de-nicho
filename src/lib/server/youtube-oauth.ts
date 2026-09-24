import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { YouTubeConnection } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import {
  decryptYouTubeRefreshToken, encryptYouTubeRefreshToken, youtubeOAuthConfig
} from './youtube-secrets';

const TOKEN_ENDPOINT=(process.env.YOUTUBE_TOKEN_ENDPOINT??'https://oauth2.googleapis.com/token').trim();

export const YOUTUBE_OAUTH_SCOPES=[
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
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

export async function fetchOwnYouTubeChannel(accessToken:string){
  const url=new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part','id,snippet');
  url.searchParams.set('mine','true');
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+accessToken},
    cache:'no-store'
  });
  const body=await response.json().catch(()=>({})) as ChannelListResponse;
  if(!response.ok)throw new HttpError('Falha ao identificar o canal do YouTube: '+(body.error?.message??response.statusText)+'.',502);
  const item=body.items?.[0];
  if(!item?.id)throw new HttpError('A conta Google autorizada não possui canal do YouTube disponível.',409);
  const thumbnails=item.snippet?.thumbnails??{};
  const thumb=thumbnails.high?.url??thumbnails.medium?.url??thumbnails.default?.url;
  return {
    youtubeChannelId:item.id,
    youtubeTitle:item.snippet?.title?.trim()||item.id,
    youtubeHandle:item.snippet?.customUrl?.trim()||undefined,
    youtubeThumbnail:thumb
  };
}

type ConnectionRow={
  id:string;channel_id:string;youtube_channel_id:string;youtube_title:string;
  youtube_handle:string|null;youtube_thumbnail:string|null;scopes:string[]|null;
  status:'connected'|'needs-reauth'|'disconnected';last_validated_at:string|null;
  error:string|null;created_at:string;updated_at:string;
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

const selection='id,channel_id,youtube_channel_id,youtube_title,youtube_handle,youtube_thumbnail,scopes,status,last_validated_at,error,created_at,updated_at';

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

export async function saveYouTubeConnection(input:{
  channelId:string;
  refreshToken:string;
  scopes:string[];
  youtubeChannelId:string;
  youtubeTitle:string;
  youtubeHandle?:string;
  youtubeThumbnail?:string;
}){
  const channel=checked(await db().from('radar_managed_channels').select('id').eq('id',input.channelId).maybeSingle());
  if(!channel)throw new HttpError('Canal interno não encontrado.',404);

  const existing=checked(await db().from('radar_youtube_connections')
    .select('id').eq('channel_id',input.channelId).maybeSingle());
  const id=existing?.id?String(existing.id):crypto.randomUUID();
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
  return loadYouTubeConnection(input.channelId);
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

import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { checked, db } from './db';
import { HttpError } from './auth';
import { decryptNexLevToken, encryptNexLevToken } from './nexlev-secrets';

const ISSUER='https://prod.dashboard.nexlev.io';
const AUTHORIZE_ENDPOINT=ISSUER+'/api/mcp/oauth/authorize';
const TOKEN_ENDPOINT=ISSUER+'/api/mcp/oauth/token';
const REGISTER_ENDPOINT=ISSUER+'/api/mcp/oauth/register';
export const NEXLEV_MCP_ENDPOINT=ISSUER+'/api/codex-mcp';
export const NEXLEV_SCOPES=['openid','profile','email'] as const;

type OAuthState={nonce:string;exp:number;clientId:string;redirectUri:string};
type TokenResponse={
  access_token?:string;refresh_token?:string;expires_in?:number;
  scope?:string;token_type?:string;error?:string;error_description?:string;
};
type ConnectionRow={
  id:string;client_id:string;redirect_uri:string;scopes:string[]|null;
  access_token_ciphertext:string;refresh_token_ciphertext:string|null;token_aad:string;
  token_expires_at:string|null;status:'connected'|'needs-reauth'|'disconnected';
  tool_count:number|null;server_info:unknown;last_validated_at:string|null;error:string|null;
  created_at:string;updated_at:string;
};

function stateSecret(){
  const value=(process.env.SESSION_SECRET??'').trim();
  if(value.length<24)throw new HttpError('SESSION_SECRET indisponível para proteger OAuth state.',503);
  return value;
}
function sign(value:string){
  return createHmac('sha256',stateSecret()).update(value).digest('base64url');
}
function safeEqual(a:string,b:string){
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function encodeState(payload:OAuthState){
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body+'.'+sign(body);
}
export function verifyNexLevState(value:string){
  const [body,signature]=String(value??'').split('.');
  if(!body||!signature||!safeEqual(signature,sign(body)))throw new HttpError('OAuth state NexLev inválido.',400);
  let payload:OAuthState;
  try{payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as OAuthState;}
  catch{throw new HttpError('OAuth state NexLev inválido.',400);}
  if(!payload.nonce||!payload.clientId||!payload.redirectUri||payload.exp<Date.now()){
    throw new HttpError('OAuth state NexLev expirado ou inválido.',400);
  }
  return payload;
}

export function createPkce(){
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  return {verifier,challenge};
}

export async function registerNexLevClient(redirectUri:string){
  let response:Response;
  try{
    response=await fetch(REGISTER_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({
        client_name:'Cacadores de Nichos',
        redirect_uris:[redirectUri],
        grant_types:['authorization_code','refresh_token'],
        response_types:['code'],
        token_endpoint_auth_method:'none'
      }),
      cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
  }catch{throw new HttpError('Não foi possível registrar o cliente OAuth no NexLev.',502);}
  const body=await response.json().catch(()=>({})) as {client_id?:string;scope?:string;error?:string;error_description?:string};
  if(!response.ok||!body.client_id){
    throw new HttpError('O NexLev recusou o registro OAuth: '+(body.error_description??body.error??response.statusText)+'.',502);
  }
  return {clientId:body.client_id,scope:body.scope??NEXLEV_SCOPES.join(' ')};
}

export function nexLevAuthorizationUrl(input:{clientId:string;redirectUri:string;challenge:string}){
  const state=encodeState({
    nonce:randomBytes(18).toString('base64url'),
    exp:Date.now()+10*60*1000,
    clientId:input.clientId,
    redirectUri:input.redirectUri
  });
  const url=new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',input.clientId);
  url.searchParams.set('redirect_uri',input.redirectUri);
  url.searchParams.set('scope',NEXLEV_SCOPES.join(' '));
  url.searchParams.set('state',state);
  url.searchParams.set('code_challenge',input.challenge);
  url.searchParams.set('code_challenge_method','S256');
  url.searchParams.set('resource',NEXLEV_MCP_ENDPOINT);
  return {url:url.toString(),state};
}

async function tokenRequest(params:URLSearchParams){
  let response:Response;
  try{
    response=await fetch(TOKEN_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
      body:params,
      cache:'no-store',
      signal:AbortSignal.timeout(20000)
    });
  }catch{throw new HttpError('Não foi possível alcançar o token endpoint do NexLev.',502);}
  const body=await response.json().catch(()=>({})) as TokenResponse;
  if(!response.ok||!body.access_token){
    throw new HttpError('Falha ao obter token do NexLev: '+(body.error_description??body.error??response.statusText)+'.',502);
  }
  return body;
}

export async function exchangeNexLevCode(input:{code:string;clientId:string;redirectUri:string;verifier:string}){
  return tokenRequest(new URLSearchParams({
    grant_type:'authorization_code',
    code:input.code,
    client_id:input.clientId,
    redirect_uri:input.redirectUri,
    code_verifier:input.verifier,
    resource:NEXLEV_MCP_ENDPOINT
  }));
}

async function refreshNexLevToken(row:ConnectionRow){
  if(!row.refresh_token_ciphertext)throw new HttpError('NexLev precisa ser reconectado.',409);
  const refresh=decryptNexLevToken(row.refresh_token_ciphertext,row.token_aad);
  const token=await tokenRequest(new URLSearchParams({
    grant_type:'refresh_token',
    refresh_token:refresh,
    client_id:row.client_id,
    resource:NEXLEV_MCP_ENDPOINT
  }));
  const now=new Date();
  const expiresAt=typeof token.expires_in==='number'
    ?new Date(now.getTime()+Math.max(60,token.expires_in)*1000).toISOString()
    :null;
  checked(await db().from('radar_nexlev_connections').update({
    access_token_ciphertext:encryptNexLevToken(token.access_token!,row.token_aad),
    refresh_token_ciphertext:token.refresh_token
      ?encryptNexLevToken(token.refresh_token,row.token_aad)
      :row.refresh_token_ciphertext,
    scopes:(token.scope??'').split(/\s+/).filter(Boolean),
    token_expires_at:expiresAt,
    status:'connected',
    error:null,
    updated_at:now.toISOString()
  }).eq('id',row.id));
  return token.access_token!;
}

async function connectionRow(){
  return checked(await db().from('radar_nexlev_connections').select('*').eq('id','primary').maybeSingle()) as ConnectionRow|null;
}

async function accessToken(){
  const row=await connectionRow();
  if(!row||row.status!=='connected')throw new HttpError('Conecte sua conta NexLev primeiro.',409);
  const expires=row.token_expires_at?new Date(row.token_expires_at).getTime():0;
  if(expires&&expires<Date.now()+120000)return {row,token:await refreshNexLevToken(row)};
  return {row,token:decryptNexLevToken(row.access_token_ciphertext,row.token_aad)};
}

function parseMcpBody(raw:string,contentType:string|null){
  if(contentType?.includes('text/event-stream')){
    const events=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);
    for(let i=events.length-1;i>=0;i--){
      try{return JSON.parse(events[i]);}catch{}
    }
    throw new HttpError('O NexLev retornou uma resposta MCP SSE inválida.',502);
  }
  try{return JSON.parse(raw);}
  catch{throw new HttpError('O NexLev retornou uma resposta MCP inválida.',502);}
}

async function mcpPost(token:string,method:string,params:Record<string,unknown>={}){
  const response=await fetch(NEXLEV_MCP_ENDPOINT,{
    method:'POST',
    headers:{
      Authorization:'Bearer '+token,
      'Content-Type':'application/json',
      Accept:'application/json, text/event-stream'
    },
    body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method,params}),
    cache:'no-store',
    signal:AbortSignal.timeout(60000)
  });
  const raw=await response.text();
  const parsed=parseMcpBody(raw,response.headers.get('content-type')) as {
    result?:unknown;error?:{code?:number;message?:string;data?:unknown}
  };
  if(!response.ok||parsed.error){
    throw new HttpError('NexLev MCP: '+(parsed.error?.message??response.statusText)+'.',response.status===401?401:502);
  }
  return parsed.result;
}

async function initializedCall(token:string,method:string,params:Record<string,unknown>={}){
  await mcpPost(token,'initialize',{
    protocolVersion:'2025-03-26',
    capabilities:{},
    clientInfo:{name:'cacadores-de-nichos',version:'1.0.0'}
  }).catch(()=>null);
  return mcpPost(token,method,params);
}

export async function saveNexLevConnection(input:{
  clientId:string;redirectUri:string;accessToken:string;refreshToken?:string;
  expiresIn?:number;scope?:string;
}){
  const aad='nexlev:primary';
  const now=new Date();
  const expiresAt=typeof input.expiresIn==='number'
    ?new Date(now.getTime()+Math.max(60,input.expiresIn)*1000).toISOString()
    :null;
  const existing=await connectionRow();
  checked(await db().from('radar_nexlev_connections').upsert({
    id:'primary',
    client_id:input.clientId,
    redirect_uri:input.redirectUri,
    scopes:(input.scope??'').split(/\s+/).filter(Boolean),
    access_token_ciphertext:encryptNexLevToken(input.accessToken,aad),
    refresh_token_ciphertext:input.refreshToken
      ?encryptNexLevToken(input.refreshToken,aad)
      :(existing?.refresh_token_ciphertext??null),
    token_aad:aad,
    token_expires_at:expiresAt,
    status:'connected',
    error:null,
    updated_at:now.toISOString()
  },{onConflict:'id'}));
  return validateNexLevConnection();
}

export async function listNexLevTools(){
  const {token}=await accessToken();
  const result=await initializedCall(token,'tools/list',{}) as {tools?:Array<{name?:string;description?:string;inputSchema?:unknown}>}|undefined;
  return result?.tools??[];
}

export async function callNexLevTool(name:string,args:Record<string,unknown>={}){
  if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(name))throw new HttpError('Ferramenta NexLev inválida.',400);
  const {token}=await accessToken();
  return initializedCall(token,'tools/call',{name,arguments:args});
}

export async function validateNexLevConnection(){
  const row=await connectionRow();
  if(!row)throw new HttpError('Conexão NexLev não encontrada.',404);
  try{
    const tools=await listNexLevTools();
    const now=new Date().toISOString();
    checked(await db().from('radar_nexlev_connections').update({
      status:'connected',
      tool_count:tools.length,
      server_info:{endpoint:NEXLEV_MCP_ENDPOINT,toolNames:tools.slice(0,200).map(item=>item.name).filter(Boolean)},
      last_validated_at:now,
      error:null,
      updated_at:now
    }).eq('id','primary'));
    return nexLevConnectionStatus();
  }catch(error){
    const message=error instanceof Error?error.message:'Falha ao validar NexLev.';
    checked(await db().from('radar_nexlev_connections').update({
      status:'needs-reauth',error:message,updated_at:new Date().toISOString()
    }).eq('id','primary'));
    throw error;
  }
}

export async function nexLevConnectionStatus(){
  const row=await connectionRow();
  if(!row)return {configured:false,status:'disconnected' as const,toolCount:0};
  return {
    configured:true,
    status:row.status,
    scopes:row.scopes??[],
    toolCount:Number(row.tool_count??0),
    lastValidatedAt:row.last_validated_at??undefined,
    error:row.error??undefined
  };
}

export async function disconnectNexLev(){
  checked(await db().from('radar_nexlev_connections').delete().eq('id','primary'));
  return {configured:false,status:'disconnected' as const,toolCount:0};
}

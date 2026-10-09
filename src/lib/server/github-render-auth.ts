import 'server-only';

import { createPublicKey, verify } from 'node:crypto';
import { HttpError } from './auth';

const ISSUER='https://token.actions.githubusercontent.com';
const AUDIENCE='cacadores-render';
const REPOSITORY='sidneysantossp/cacador-de-nicho';
const WORKFLOW_REF=REPOSITORY+'/.github/workflows/render-worker.yml@refs/heads/master';
const OWNER_ID='73052036';

type JwtPayload={
  iss?:string;
  aud?:string|string[];
  exp?:number;
  nbf?:number;
  repository?:string;
  repository_owner_id?:string;
  ref?:string;
  workflow_ref?:string;
  event_name?:string;
  sub?:string;
};

let jwksCache:{expiresAt:number;keys:any[]}|null=null;

function decodePart(value:string){
  return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
}

async function jwks(){
  const now=Date.now();
  if(jwksCache&&jwksCache.expiresAt>now)return jwksCache.keys;
  const response=await fetch(ISSUER+'/.well-known/jwks',{cache:'no-store'});
  if(!response.ok)throw new HttpError('GitHub OIDC JWKS indisponível.',503);
  const body=await response.json() as {keys?:any[]};
  const keys=Array.isArray(body.keys)?body.keys:[];
  if(!keys.length)throw new HttpError('GitHub OIDC JWKS vazio.',503);
  jwksCache={keys,expiresAt:now+10*60*1000};
  return keys;
}

function audienceOk(aud:JwtPayload['aud']){
  return Array.isArray(aud)?aud.includes(AUDIENCE):aud===AUDIENCE;
}

export async function requireGithubRenderWorker(request:Request):Promise<JwtPayload>{
  const authorization=request.headers.get('authorization')??'';
  const match=/^Bearer\s+(.+)$/i.exec(authorization);
  if(!match)throw new HttpError('GitHub render worker não autenticado.',401);
  const token=match[1];
  const parts=token.split('.');
  if(parts.length!==3)throw new HttpError('GitHub OIDC token inválido.',401);

  let header:any;
  let payload:JwtPayload;
  try{
    header=decodePart(parts[0]);
    payload=decodePart(parts[1]);
  }catch{
    throw new HttpError('GitHub OIDC token inválido.',401);
  }

  if(header.alg!=='RS256'||!header.kid)throw new HttpError('GitHub OIDC algoritmo inválido.',401);
  const key=(await jwks()).find(item=>item.kid===header.kid);
  if(!key)throw new HttpError('GitHub OIDC key não reconhecida.',401);

  const valid=verify(
    'RSA-SHA256',
    Buffer.from(parts[0]+'.'+parts[1]),
    createPublicKey({key,format:'jwk'}),
    Buffer.from(parts[2],'base64url')
  );
  if(!valid)throw new HttpError('GitHub OIDC assinatura inválida.',401);

  const now=Math.floor(Date.now()/1000);
  if(payload.iss!==ISSUER||!audienceOk(payload.aud))throw new HttpError('GitHub OIDC issuer/audience inválido.',401);
  if(!payload.exp||payload.exp<now-30||payload.nbf&&payload.nbf>now+30)throw new HttpError('GitHub OIDC token expirado.',401);
  if(payload.repository!==REPOSITORY||payload.repository_owner_id!==OWNER_ID)throw new HttpError('GitHub repository não autorizado.',403);
  if(payload.ref!=='refs/heads/master'||payload.workflow_ref!==WORKFLOW_REF)throw new HttpError('GitHub workflow/ref não autorizado.',403);
  if(!['schedule','workflow_dispatch','push'].includes(String(payload.event_name??'')))throw new HttpError('GitHub event não autorizado.',403);
  return payload;
}

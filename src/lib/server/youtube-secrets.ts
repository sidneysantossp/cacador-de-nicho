import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpError } from './auth';

const VERSION='v1';

function encryptionSecret(){
  const value=(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY??'').trim();
  if(value.length<32)throw new HttpError('Configure YOUTUBE_TOKEN_ENCRYPTION_KEY com pelo menos 32 caracteres.',503);
  return value;
}

function key(){
  return createHash('sha256').update(encryptionSecret(),'utf8').digest();
}

function b64(value:Buffer){return value.toString('base64url');}
function unb64(value:string){return Buffer.from(value,'base64url');}

export function youtubeOAuthConfig(){
  const clientId=(process.env.YOUTUBE_OAUTH_CLIENT_ID??'').trim();
  const clientSecret=(process.env.YOUTUBE_OAUTH_CLIENT_SECRET??'').trim();
  const redirectUri=(process.env.YOUTUBE_OAUTH_REDIRECT_URI??'').trim();
  const encryptionKey=(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY??'').trim();
  const missing=[
    !clientId?'YOUTUBE_OAUTH_CLIENT_ID':'',
    !clientSecret?'YOUTUBE_OAUTH_CLIENT_SECRET':'',
    !redirectUri?'YOUTUBE_OAUTH_REDIRECT_URI':'',
    encryptionKey.length<32?'YOUTUBE_TOKEN_ENCRYPTION_KEY':''
  ].filter(Boolean);
  return {configured:missing.length===0,missing,clientId,clientSecret,redirectUri};
}

export function encryptYouTubeRefreshToken(token:string,channelId:string){
  const value=token.trim();
  if(!value)throw new HttpError('Refresh token do YouTube ausente.',502);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(channelId,'utf8'));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [VERSION,b64(iv),b64(tag),b64(encrypted)].join('.');
}

export function decryptYouTubeRefreshToken(ciphertext:string,channelId:string){
  const [version,ivRaw,tagRaw,dataRaw]=String(ciphertext).split('.');
  if(version!==VERSION||!ivRaw||!tagRaw||!dataRaw){
    throw new HttpError('Refresh token do YouTube possui formato inválido.',500);
  }
  try{
    const decipher=createDecipheriv('aes-256-gcm',key(),unb64(ivRaw));
    decipher.setAAD(Buffer.from(channelId,'utf8'));
    decipher.setAuthTag(unb64(tagRaw));
    return Buffer.concat([decipher.update(unb64(dataRaw)),decipher.final()]).toString('utf8');
  }catch{
    throw new HttpError('Não foi possível descriptografar o refresh token do YouTube.',500);
  }
}

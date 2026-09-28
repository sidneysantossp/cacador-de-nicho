import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpError } from './auth';

const VERSION='v1';

function encryptionSecret(){
  const value=(process.env.NEXLEV_TOKEN_ENCRYPTION_KEY??process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY??'').trim();
  if(value.length<32)throw new HttpError('Configure NEXLEV_TOKEN_ENCRYPTION_KEY ou mantenha YOUTUBE_TOKEN_ENCRYPTION_KEY disponível.',503);
  return value;
}

function key(){
  return createHash('sha256').update(encryptionSecret(),'utf8').digest();
}
function b64(value:Buffer){return value.toString('base64url');}
function unb64(value:string){return Buffer.from(value,'base64url');}

export function encryptNexLevToken(token:string,aad:string){
  const value=token.trim();
  if(!value)throw new HttpError('Token NexLev ausente.',502);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(aad,'utf8'));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [VERSION,b64(iv),b64(tag),b64(encrypted)].join('.');
}

export function decryptNexLevToken(ciphertext:string,aad:string){
  const [version,ivRaw,tagRaw,dataRaw]=String(ciphertext).split('.');
  if(version!==VERSION||!ivRaw||!tagRaw||!dataRaw)throw new HttpError('Token NexLev possui formato inválido.',500);
  try{
    const decipher=createDecipheriv('aes-256-gcm',key(),unb64(ivRaw));
    decipher.setAAD(Buffer.from(aad,'utf8'));
    decipher.setAuthTag(unb64(tagRaw));
    return Buffer.concat([decipher.update(unb64(dataRaw)),decipher.final()]).toString('utf8');
  }catch{
    throw new HttpError('Não foi possível descriptografar o token NexLev.',500);
  }
}

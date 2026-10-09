import 'server-only';

import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { providerSecret } from './providers';
import { parseR2Config, r2Client } from './r2';

const R2_PREFIX='r2:';
const R2_KEY_PREFIX=(process.env.R2_KEY_PREFIX||'cacadores/').replace(/^\/+|\/+$/g,'')+'/';

async function r2(){
  try{
    const config=parseR2Config(await providerSecret('r2'));
    return {config,client:r2Client(config)};
  }catch{
    return null;
  }
}

function isR2Path(path:string){return path.startsWith(R2_PREFIX);}
function r2Key(path:string){return isR2Path(path)?path.slice(R2_PREFIX.length):path;}
function prefixedR2Key(key:string){return key.startsWith(R2_KEY_PREFIX)?key:R2_KEY_PREFIX+key.replace(/^\/+/, '');}

export async function preferredMediaStorage(){return (await r2())?'r2' as const:'unavailable' as const;}

export async function putMedia(key:string,bytes:Buffer,contentType:string,options:{cacheControl?:string}={}){
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  try{
    const storageKey=prefixedR2Key(key);
    await target.client.send(new PutObjectCommand({Bucket:target.config.bucket,Key:storageKey,Body:bytes,ContentType:contentType,CacheControl:options.cacheControl??'3600'}));
    return R2_PREFIX+storageKey;
  }catch{throw new Error('r2-upload-failed');}
}

export async function signedMediaPutUrl(
  path:string,
  contentType:string,
  expiresSeconds=600,
  options:{cacheControl?:string;metadata?:Record<string,string>}={}
){
  if(!path||!isR2Path(path))return null;
  const target=await r2();
  if(!target)return null;
  try{
    return await getSignedUrl(
      target.client,
      new PutObjectCommand({
        Bucket:target.config.bucket,
        Key:r2Key(path),
        ContentType:contentType,
        CacheControl:options.cacheControl??'31536000',
        Metadata:options.metadata
      }),
      {expiresIn:Math.max(60,Math.min(expiresSeconds,3600))}
    );
  }catch{return null;}
}

export async function signedMediaUrl(path:string,expiresSeconds=3600){
  if(!path||!isR2Path(path))return null;
  const target=await r2();
  if(!target)return null;
  try{return await getSignedUrl(target.client,new GetObjectCommand({Bucket:target.config.bucket,Key:r2Key(path)}),{expiresIn:expiresSeconds});}
  catch{return null;}
}

export async function downloadMedia(path:string){
  if(!path)throw new Error('media-path-empty');
  if(!isR2Path(path))throw new Error('r2-path-required');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  const result=await target.client.send(new GetObjectCommand({Bucket:target.config.bucket,Key:r2Key(path)}));
  if(!result.Body)throw new Error('r2-empty-body');
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function removeMedia(path:string){
  if(!path)return;
  if(!isR2Path(path))throw new Error('r2-path-required');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  await target.client.send(new DeleteObjectCommand({Bucket:target.config.bucket,Key:r2Key(path)}));
}

export function r2StoragePath(key:string){return R2_PREFIX+prefixedR2Key(key);}

export async function migrateLegacySupabaseObject(storagePath:string,contentType='application/octet-stream'){
  const base=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=(process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  if(!base||!key)throw new Error('legacy-supabase-not-configured');
  const encoded=storagePath.split('/').map(encodeURIComponent).join('/');
  const response=await fetch(`${base}/storage/v1/object/cacadores-media/${encoded}`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},
    cache:'no-store',
    signal:AbortSignal.timeout(120000)
  });
  if(!response.ok)throw new Error(`legacy-storage-http-${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  return putMedia(storagePath,bytes,response.headers.get('content-type')||contentType);
}

export async function putMediaStream(storagePath:string,body:ReadableStream<Uint8Array>,contentType:string,contentLength:number){
  if(!isR2Path(storagePath))throw new Error('stream-upload-r2-only');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  if(!Number.isFinite(contentLength)||contentLength<=0)throw new Error('invalid-content-length');
  const stream=Readable.fromWeb(body as never);
  try{await target.client.send(new PutObjectCommand({Bucket:target.config.bucket,Key:r2Key(storagePath),Body:stream,ContentType:contentType,ContentLength:contentLength,CacheControl:'31536000'}));}
  catch{throw new Error('r2-stream-upload-failed');}
  return storagePath;
}

export async function headMedia(path:string){
  if(!isR2Path(path))throw new Error('head-media-r2-only');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  const result=await target.client.send(new HeadObjectCommand({Bucket:target.config.bucket,Key:r2Key(path)}));
  return {
    bytes:Number(result.ContentLength??0),
    contentType:String(result.ContentType??''),
    etag:String(result.ETag??'').replace(/^\"|\"$/g,''),
    metadata:result.Metadata??{}
  };
}

export async function downloadMediaToFile(storagePath:string,targetPath:string){
  if(!storagePath)throw new Error('media-path-empty');
  if(!isR2Path(storagePath))throw new Error('r2-path-required');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  const result=await target.client.send(new GetObjectCommand({Bucket:target.config.bucket,Key:r2Key(storagePath)}));
  if(!result.Body)throw new Error('r2-empty-body');
  await pipeline(Readable.fromWeb(result.Body.transformToWebStream() as never),createWriteStream(targetPath));
  return targetPath;
}

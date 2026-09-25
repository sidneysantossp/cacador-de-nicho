import 'server-only';

import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { db } from './db';
import { providerSecret } from './providers';
import { parseR2Config, r2Client } from './r2';

const SUPABASE_BUCKET='cacadores-media';
const R2_PREFIX='r2:';

async function r2(){
  try{
    const config=parseR2Config(await providerSecret('r2'));
    return {config,client:r2Client(config)};
  }catch{
    return null;
  }
}

function isR2Path(path:string){
  return path.startsWith(R2_PREFIX);
}

function r2Key(path:string){
  return isR2Path(path)?path.slice(R2_PREFIX.length):path;
}

export async function preferredMediaStorage(){
  return (await r2())?'r2' as const:'supabase' as const;
}

export async function putMedia(
  key:string,
  bytes:Buffer,
  contentType:string,
  options:{cacheControl?:string}={}
){
  const target=await r2();
  if(target){
    try{
      await target.client.send(new PutObjectCommand({
        Bucket:target.config.bucket,
        Key:key,
        Body:bytes,
        ContentType:contentType,
        CacheControl:options.cacheControl??'3600'
      }));
      return R2_PREFIX+key;
    }catch{
      throw new Error('r2-upload-failed');
    }
  }

  const uploaded=await db().storage.from(SUPABASE_BUCKET).upload(key,bytes,{
    contentType,
    upsert:false,
    cacheControl:options.cacheControl??'3600'
  });
  if(uploaded.error)throw new Error('supabase-storage-upload-failed');
  return key;
}

export async function signedMediaUrl(path:string,expiresSeconds=3600){
  if(!path)return null;
  if(isR2Path(path)){
    const target=await r2();
    if(!target)return null;
    try{
      return await getSignedUrl(
        target.client,
        new GetObjectCommand({Bucket:target.config.bucket,Key:r2Key(path)}),
        {expiresIn:expiresSeconds}
      );
    }catch{return null;}
  }
  const signed=await db().storage.from(SUPABASE_BUCKET).createSignedUrl(path,expiresSeconds);
  return signed.error?null:signed.data.signedUrl;
}

export async function downloadMedia(path:string){
  if(!path)throw new Error('media-path-empty');
  if(isR2Path(path)){
    const target=await r2();
    if(!target)throw new Error('r2-not-configured');
    const result=await target.client.send(new GetObjectCommand({
      Bucket:target.config.bucket,
      Key:r2Key(path)
    }));
    if(!result.Body)throw new Error('r2-empty-body');
    return Buffer.from(await result.Body.transformToByteArray());
  }
  const result=await db().storage.from(SUPABASE_BUCKET).download(path);
  if(result.error||!result.data)throw new Error('supabase-storage-download-failed');
  return Buffer.from(await result.data.arrayBuffer());
}

export async function removeMedia(path:string){
  if(!path)return;
  if(isR2Path(path)){
    const target=await r2();
    if(!target)throw new Error('r2-not-configured');
    await target.client.send(new DeleteObjectCommand({
      Bucket:target.config.bucket,
      Key:r2Key(path)
    }));
    return;
  }
  const removal=await db().storage.from(SUPABASE_BUCKET).remove([path]);
  if(removal.error)throw new Error('supabase-storage-delete-failed');
}





export function r2StoragePath(key:string){
  return R2_PREFIX+key;
}

export async function putMediaStream(
  storagePath:string,
  body:ReadableStream<Uint8Array>,
  contentType:string,
  contentLength:number
){
  if(!isR2Path(storagePath))throw new Error('stream-upload-r2-only');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  if(!Number.isFinite(contentLength)||contentLength<=0)throw new Error('invalid-content-length');
  const stream=Readable.fromWeb(body as never);
  try{
    await target.client.send(new PutObjectCommand({
      Bucket:target.config.bucket,
      Key:r2Key(storagePath),
      Body:stream,
      ContentType:contentType,
      ContentLength:contentLength,
      CacheControl:'31536000'
    }));
  }catch{
    throw new Error('r2-stream-upload-failed');
  }
  return storagePath;
}

export async function headMedia(path:string){
  if(!isR2Path(path))throw new Error('head-media-r2-only');
  const target=await r2();
  if(!target)throw new Error('r2-not-configured');
  const result=await target.client.send(new HeadObjectCommand({
    Bucket:target.config.bucket,
    Key:r2Key(path)
  }));
  return {
    bytes:Number(result.ContentLength??0),
    contentType:String(result.ContentType??''),
    etag:String(result.ETag??'').replace(/^"|"$/g,'')
  };
}


export async function downloadMediaToFile(storagePath:string,targetPath:string){
  if(!storagePath)throw new Error('media-path-empty');
  if(isR2Path(storagePath)){
    const target=await r2();
    if(!target)throw new Error('r2-not-configured');
    const result=await target.client.send(new GetObjectCommand({
      Bucket:target.config.bucket,
      Key:r2Key(storagePath)
    }));
    if(!result.Body)throw new Error('r2-empty-body');
    const web=result.Body.transformToWebStream();
    await pipeline(Readable.fromWeb(web as never),createWriteStream(targetPath));
    return targetPath;
  }
  const result=await db().storage.from(SUPABASE_BUCKET).download(storagePath);
  if(result.error||!result.data)throw new Error('supabase-storage-download-failed');
  await pipeline(Readable.fromWeb(result.data.stream() as never),createWriteStream(targetPath));
  return targetPath;
}

import 'server-only';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpError } from './auth';

export type R2Config = {
  accountId:string;
  accessKeyId:string;
  secretAccessKey:string;
  bucket:string;
  publicUrl?:string;
};

function clean(value:unknown){
  return typeof value==='string'?value.trim():'';
}

export function r2ConfigFromEnv():R2Config|null{
  const accountId=clean(process.env.R2_ACCOUNT_ID||process.env.CLOUDFLARE_R2_ACCOUNT_ID);
  const accessKeyId=clean(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey=clean(process.env.R2_SECRET_ACCESS_KEY);
  const bucket=clean(process.env.R2_BUCKET);
  const publicUrl=clean(process.env.R2_PUBLIC_URL);
  if(!accountId||!accessKeyId||!secretAccessKey||!bucket)return null;
  return {accountId,accessKeyId,secretAccessKey,bucket,publicUrl:publicUrl||undefined};
}

export function serializeR2Config(config:R2Config){
  return JSON.stringify({
    accountId:clean(config.accountId),
    accessKeyId:clean(config.accessKeyId),
    secretAccessKey:clean(config.secretAccessKey),
    bucket:clean(config.bucket),
    publicUrl:clean(config.publicUrl)||undefined
  });
}

export function parseR2Config(secret:string):R2Config{
  let raw:unknown;
  try{raw=JSON.parse(secret);}catch{throw new HttpError('A configuração do Cloudflare R2 está inválida.',500);}
  if(!raw||typeof raw!=='object')throw new HttpError('A configuração do Cloudflare R2 está inválida.',500);
  const value=raw as Record<string,unknown>;
  const config:R2Config={
    accountId:clean(value.accountId),
    accessKeyId:clean(value.accessKeyId),
    secretAccessKey:clean(value.secretAccessKey),
    bucket:clean(value.bucket),
    publicUrl:clean(value.publicUrl)||undefined
  };
  if(!config.accountId||!config.accessKeyId||!config.secretAccessKey||!config.bucket){
    throw new HttpError('A configuração do Cloudflare R2 está incompleta.',500);
  }
  return config;
}

export function r2Client(config:R2Config){
  return new S3Client({
    region:'auto',
    endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials:{
      accessKeyId:config.accessKeyId,
      secretAccessKey:config.secretAccessKey
    }
  });
}

export async function testR2Config(config:R2Config){
  try{
    await r2Client(config).send(new HeadBucketCommand({Bucket:config.bucket}));
  }catch{
    throw new HttpError('Não foi possível acessar o bucket do Cloudflare R2. Confira account ID, credenciais e bucket.',422);
  }
}

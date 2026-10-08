import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { HttpError } from './auth';
import { uploadSceneAsset, selectSceneAsset } from './asset-factory';
import { ensureSceneAssetVisualQa } from './visual-asset-preflight';
import {
  externalMediaIpIsPublic, externalMediaMaxBytes, externalMediaMimeKind,
  externalMediaUrlShapeAllowed
} from '@/lib/external-media-url-policy';

async function assertPublicExternalUrl(value:string){
  if(!externalMediaUrlShapeAllowed(value)){
    throw new HttpError('Use uma URL HTTPS pública sem credenciais ou porta customizada.',400);
  }
  const url=new URL(value);
  if(isIP(url.hostname)){
    if(!externalMediaIpIsPublic(url.hostname))throw new HttpError('A URL externa aponta para uma rede privada ou reservada.',400);
    return url;
  }
  let addresses:Awaited<ReturnType<typeof lookup>>;
  try{
    addresses=await lookup(url.hostname,{all:true,verbatim:true}) as never;
  }catch{
    throw new HttpError('Não foi possível resolver o host da mídia externa.',422);
  }
  const rows=Array.isArray(addresses)?addresses:[addresses];
  if(!rows.length||rows.some(item=>!externalMediaIpIsPublic(String(item.address)))){
    throw new HttpError('A URL externa resolve para uma rede privada ou reservada.',400);
  }
  return url;
}

async function fetchAuthorizedExternalMedia(inputUrl:string){
  let current=await assertPublicExternalUrl(inputUrl);
  for(let redirects=0;redirects<6;redirects++){
    let response:Response;
    try{
      response=await fetch(current,{
        redirect:'manual',
        signal:AbortSignal.timeout(120000),
        cache:'no-store',
        headers:{'User-Agent':'Cacadores-de-Nichos/1.0 media-import'}
      });
    }catch{
      throw new HttpError('Não foi possível baixar a mídia externa.',502);
    }
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)throw new HttpError('A origem externa devolveu um redirect inválido.',422);
      current=await assertPublicExternalUrl(new URL(location,current).toString());
      continue;
    }
    if(!response.ok)throw new HttpError('A origem externa recusou o download ('+response.status+').',502);

    const mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    const kind=externalMediaMimeKind(mime);
    if(!kind)throw new HttpError('A URL precisa apontar diretamente para PNG/JPG/WebP ou MP4/WebM/MOV.',415);
    const max=externalMediaMaxBytes(mime);
    const declared=Number(response.headers.get('content-length')??0);
    if(Number.isFinite(declared)&&declared>max){
      throw new HttpError(kind==='image'?'Imagem externa maior que 25 MB.':'Vídeo externo maior que 250 MB.',413);
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length)throw new HttpError('A mídia externa está vazia.',422);
    if(bytes.length>max){
      throw new HttpError(kind==='image'?'Imagem externa maior que 25 MB.':'Vídeo externo maior que 250 MB.',413);
    }
    const rawName=decodeURIComponent(path.basename(current.pathname)||('external.'+(kind==='video'?'mp4':'jpg')));
    const fileName=rawName.replace(/[^a-zA-Z0-9._ -]+/g,'_').slice(0,180)||('external.'+(kind==='video'?'mp4':'jpg'));
    return {bytes,mime,fileName,finalUrl:current.toString()};
  }
  throw new HttpError('A origem externa excedeu o limite de redirects.',422);
}

export async function importAuthorizedExternalMediaUrl(input:{
  promptSetId:string;
  sceneId:string;
  url:string;
  licenseType:'owned'|'licensed';
  licenseLabel:string;
  sourcePageUrl?:string;
}){
  const downloaded=await fetchAuthorizedExternalMedia(input.url);
  const file=new File([downloaded.bytes],downloaded.fileName,{type:downloaded.mime});
  const asset=await uploadSceneAsset({
    promptSetId:input.promptSetId,
    sceneId:input.sceneId,
    file,
    license:{
      type:input.licenseType,
      label:input.licenseLabel.trim(),
      sourceUrl:(input.sourcePageUrl?.trim()||downloaded.finalUrl).slice(0,2048)
    }
  });
  const review=await ensureSceneAssetVisualQa(asset.id);
  if(review.status!=='pass'){
    return {status:'rejected' as const,asset,review,finalUrl:downloaded.finalUrl};
  }
  await selectSceneAsset(asset.id);
  return {status:'matched' as const,asset,review,finalUrl:downloaded.finalUrl};
}

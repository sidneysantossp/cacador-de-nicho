import 'server-only';

import type { StockMediaProvider, StockMediaResult } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { persistStockSceneAsset } from './asset-factory';
import { stockDownloadHostAllowed, validStockQuery } from '@/lib/stock-media-policy';

const PEXELS_LICENSE='https://www.pexels.com/license/';
const PIXABAY_LICENSE='https://pixabay.com/service/license-summary/';
const IMAGE_MAX=25*1024*1024;
const VIDEO_MAX=250*1024*1024;

async function sceneContext(promptSetId:string,sceneId:string){
  const set=await loadVisualPromptSet(promptSetId);
  if(!set)throw new HttpError('Visual Prompt Set não encontrado.',404);
  if(set.status!=='approved')throw new HttpError('Aprove os prompts visuais antes de buscar stock media.',409);
  const scene=set.scenePrompts.find(item=>item.sceneId===sceneId);
  if(!scene)throw new HttpError('Cena não encontrada.',404);
  return {set,scene};
}

function pexelsPhoto(item:Record<string,unknown>):StockMediaResult{
  const src=(item.src??{}) as Record<string,unknown>;
  return {
    provider:'pexels',
    providerAssetId:String(item.id??''),
    kind:'image',
    title:String(item.alt??'Pexels photo'),
    previewUrl:String(src.medium??src.landscape??src.small??''),
    pageUrl:String(item.url??'https://www.pexels.com'),
    creatorName:String(item.photographer??'Pexels contributor'),
    creatorUrl:item.photographer_url?String(item.photographer_url):undefined,
    width:Number(item.width)||null,
    height:Number(item.height)||null,
    durationSeconds:null,
    licenseLabel:'Pexels License',
    attributionLabel:'Photo by '+String(item.photographer??'Pexels contributor')+' on Pexels'
  };
}

function pexelsVideo(item:Record<string,unknown>):StockMediaResult{
  return {
    provider:'pexels',
    providerAssetId:String(item.id??''),
    kind:'video',
    title:'Pexels video '+String(item.id??''),
    previewUrl:String(item.image??''),
    pageUrl:String(item.url??'https://www.pexels.com'),
    creatorName:String((item.user as Record<string,unknown>|undefined)?.name??'Pexels contributor'),
    creatorUrl:(item.user as Record<string,unknown>|undefined)?.url?String((item.user as Record<string,unknown>).url):undefined,
    width:Number(item.width)||null,
    height:Number(item.height)||null,
    durationSeconds:Number(item.duration)||null,
    licenseLabel:'Pexels License',
    attributionLabel:'Video by '+String((item.user as Record<string,unknown>|undefined)?.name??'Pexels contributor')+' on Pexels'
  };
}

function pixabayImage(item:Record<string,unknown>):StockMediaResult{
  return {
    provider:'pixabay',
    providerAssetId:String(item.id??''),
    kind:'image',
    title:String(item.tags??'Pixabay image'),
    previewUrl:String(item.webformatURL??item.previewURL??''),
    pageUrl:String(item.pageURL??'https://pixabay.com'),
    creatorName:String(item.user??'Pixabay contributor'),
    width:Number(item.imageWidth)||null,
    height:Number(item.imageHeight)||null,
    durationSeconds:null,
    licenseLabel:'Pixabay Content License',
    attributionLabel:'Image by '+String(item.user??'Pixabay contributor')+' on Pixabay'
  };
}

function pixabayVideo(item:Record<string,unknown>):StockMediaResult{
  const videos=(item.videos??{}) as Record<string,Record<string,unknown>>;
  const preview=videos.medium?.thumbnail??videos.small?.thumbnail??videos.tiny?.thumbnail??'';
  return {
    provider:'pixabay',
    providerAssetId:String(item.id??''),
    kind:'video',
    title:String(item.tags??'Pixabay video'),
    previewUrl:String(preview),
    pageUrl:String(item.pageURL??'https://pixabay.com'),
    creatorName:String(item.user??'Pixabay contributor'),
    width:Number(videos.medium?.width??videos.large?.width)||null,
    height:Number(videos.medium?.height??videos.large?.height)||null,
    durationSeconds:Number(item.duration)||null,
    licenseLabel:'Pixabay Content License',
    attributionLabel:'Video by '+String(item.user??'Pixabay contributor')+' on Pixabay'
  };
}

function unsplashPhoto(item:Record<string,unknown>):StockMediaResult{
  const urls=(item.urls??{}) as Record<string,unknown>;
  const links=(item.links??{}) as Record<string,unknown>;
  const user=(item.user??{}) as Record<string,unknown>;
  const userLinks=(user.links??{}) as Record<string,unknown>;
  const description=String(item.alt_description??item.description??'Unsplash photo');
  return {
    provider:'unsplash',
    providerAssetId:String(item.id??''),
    kind:'image',
    title:description||'Unsplash photo',
    previewUrl:String(urls.regular??urls.small??urls.thumb??''),
    pageUrl:String(links.html??'https://unsplash.com'),
    creatorName:String(user.name??user.username??'Unsplash contributor'),
    creatorUrl:userLinks.html?String(userLinks.html):undefined,
    width:Number(item.width)||null,
    height:Number(item.height)||null,
    durationSeconds:null,
    licenseLabel:'Unsplash License',
    attributionLabel:'Photo by '+String(user.name??user.username??'Unsplash contributor')+' on Unsplash'
  };
}

export async function searchStockMedia(input:{
  promptSetId:string;sceneId:string;provider:StockMediaProvider;kind:'image'|'video';query:string;
}){
  const {set}=await sceneContext(input.promptSetId,input.sceneId);
  const query=input.query.trim();
  if(!validStockQuery(query))throw new HttpError('A busca deve ter entre 1 e 100 caracteres.',400);
  if(input.provider==='unsplash'&&input.kind==='video')throw new HttpError('O Unsplash está disponível apenas para imagens.',400);

  let results:StockMediaResult[]=[];
  let remaining:string|null=null;
  let reset:string|null=null;

  if(input.provider==='pexels'){
    const key=await providerSecret('pexels');
    const endpoint=input.kind==='image'?'https://api.pexels.com/v1/search':'https://api.pexels.com/v1/videos/search';
    const params=new URLSearchParams({query,orientation:'landscape',per_page:'24',page:'1'});
    let response:Response;
    try{response=await fetch(endpoint+'?'+params,{headers:{Authorization:key},signal:AbortSignal.timeout(20000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível pesquisar no Pexels.',502);}
    if(response.status===429)throw new HttpError('O Pexels atingiu o limite de API.',429);
    if(!response.ok)throw new HttpError('O Pexels recusou a pesquisa.',502);
    const body=await response.json() as Record<string,unknown>;
    const items=(input.kind==='image'?body.photos:body.videos) as Record<string,unknown>[]|undefined;
    results=(items??[]).map(item=>input.kind==='image'?pexelsPhoto(item):pexelsVideo(item)).filter(item=>!!item.providerAssetId&&!!item.previewUrl);
    remaining=response.headers.get('x-ratelimit-remaining');
    reset=response.headers.get('x-ratelimit-reset');
  }else if(input.provider==='pixabay'){
    const key=await providerSecret('pixabay');
    const endpoint=input.kind==='image'?'https://pixabay.com/api/':'https://pixabay.com/api/videos/';
    const params=new URLSearchParams({key,q:query,per_page:'24',safesearch:'true'});
    if(input.kind==='image')params.set('orientation','horizontal');
    let response:Response;
    try{response=await fetch(endpoint+'?'+params,{signal:AbortSignal.timeout(20000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível pesquisar no Pixabay.',502);}
    if(response.status===429)throw new HttpError('O Pixabay atingiu o limite de API.',429);
    if(!response.ok)throw new HttpError('O Pixabay recusou a pesquisa.',502);
    const body=await response.json() as {hits?:Record<string,unknown>[]};
    results=(body.hits??[]).map(item=>input.kind==='image'?pixabayImage(item):pixabayVideo(item)).filter(item=>!!item.providerAssetId&&!!item.previewUrl);
    remaining=response.headers.get('x-ratelimit-remaining');
    reset=response.headers.get('x-ratelimit-reset');
  }else{
    const key=await providerSecret('unsplash');
    const params=new URLSearchParams({
      query,orientation:'landscape',per_page:'24',page:'1',content_filter:'high'
    });
    let response:Response;
    try{
      response=await fetch('https://api.unsplash.com/search/photos?'+params,{
        headers:{Authorization:'Client-ID '+key,'Accept-Version':'v1'},
        signal:AbortSignal.timeout(20000),
        cache:'no-store'
      });
    }catch{throw new HttpError('Não foi possível pesquisar no Unsplash.',502);}
    if(response.status===429)throw new HttpError('O Unsplash atingiu o limite de API.',429);
    if(!response.ok)throw new HttpError('O Unsplash recusou a pesquisa.',502);
    const body=await response.json() as {results?:Record<string,unknown>[]};
    results=(body.results??[]).map(unsplashPhoto).filter(item=>!!item.providerAssetId&&!!item.previewUrl);
    remaining=response.headers.get('x-ratelimit-remaining');
  }

  checked(await db().from('radar_stock_searches').insert({
    id:crypto.randomUUID(),
    channel_id:set.channelId,
    visual_prompt_set_id:set.id,
    scene_id:input.sceneId,
    provider:input.provider,
    media_kind:input.kind,
    query,
    result_count:results.length,
    payload:{remaining,reset}
  }));

  return {results,rateLimit:{remaining,reset}};
}

async function safeDownload(url:string,provider:StockMediaProvider,maxBytes:number){
  let current=new URL(url);
  for(let i=0;i<6;i++){
    if(current.protocol!=='https:'||!stockDownloadHostAllowed(provider,current.hostname))throw new HttpError('O provider devolveu uma origem de mídia não permitida.',502);
    const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(120000),cache:'no-store'});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location)throw new HttpError('Redirect inválido no arquivo stock.',502);
      current=new URL(location,current);
      continue;
    }
    if(!response.ok)throw new HttpError('Falha ao baixar o arquivo stock.',502);
    const declared=Number(response.headers.get('content-length')??0);
    if(declared>maxBytes)throw new HttpError('O arquivo stock excede o limite desta mídia.',413);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>maxBytes)throw new HttpError('O arquivo stock excede o limite desta mídia.',413);
    return {bytes,mimeType:response.headers.get('content-type')?.split(';')[0]??''};
  }
  throw new HttpError('O arquivo stock excedeu o limite de redirects.',502);
}

type PexelsVideoFile=Record<string,unknown>&{
  link:string;
  w:number;
  h:number;
};

function choosePexelsVideo(files:Record<string,unknown>[]):PexelsVideoFile|null{
  const mp4=files.filter((item):item is Record<string,unknown>&{link:string}=>
    String(item.file_type??'').startsWith('video/mp4')&&typeof item.link==='string'
  );
  if(!mp4.length)return null;
  const sized:PexelsVideoFile[]=mp4.map(item=>({
    ...item,
    link:item.link,
    w:Number(item.width??0),
    h:Number(item.height??0)
  }));
  const under=sized.filter(item=>item.w>0&&item.w<=1920).sort((a,b)=>b.w-a.w);
  return under[0]??sized.sort((a,b)=>a.w-b.w)[0]??null;
}

export async function importStockMedia(input:{
  promptSetId:string;sceneId:string;provider:StockMediaProvider;kind:'image'|'video';providerAssetId:string;
}){
  await sceneContext(input.promptSetId,input.sceneId);
  if(input.provider==='unsplash'&&input.kind==='video')throw new HttpError('O Unsplash está disponível apenas para imagens.',400);

  let pageUrl='',creatorName='',creatorUrl:string|undefined,downloadUrl='',mimeType='',width:number|null=null,height:number|null=null,duration:number|null=null,attribution='',licenseLabel='',licenseUrl='';

  if(input.provider==='pexels'){
    const key=await providerSecret('pexels');
    const id=encodeURIComponent(input.providerAssetId);
    const endpoint=input.kind==='image'?'https://api.pexels.com/v1/photos/'+id:'https://api.pexels.com/v1/videos/videos/'+id;
    const response=await fetch(endpoint,{headers:{Authorization:key},signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(!response.ok)throw new HttpError('O Pexels não encontrou este asset.',404);
    const item=await response.json() as Record<string,unknown>;
    pageUrl=String(item.url??'https://www.pexels.com');
    licenseLabel='Pexels License';licenseUrl=PEXELS_LICENSE;
    if(input.kind==='image'){
      creatorName=String(item.photographer??'Pexels contributor');
      creatorUrl=item.photographer_url?String(item.photographer_url):undefined;
      const src=(item.src??{}) as Record<string,unknown>;
      downloadUrl=String(src.original??src.large2x??'');
      width=Number(item.width)||null;height=Number(item.height)||null;
      mimeType='image/jpeg';
      attribution='Photo by '+creatorName+' on Pexels';
    }else{
      creatorName=String((item.user as Record<string,unknown>|undefined)?.name??'Pexels contributor');
      creatorUrl=(item.user as Record<string,unknown>|undefined)?.url?String((item.user as Record<string,unknown>).url):undefined;
      const file=choosePexelsVideo((item.video_files??[]) as Record<string,unknown>[]);
      if(!file)throw new HttpError('O Pexels não devolveu um MP4 utilizável.',502);
      downloadUrl=String(file.link);width=Number(file.width)||null;height=Number(file.height)||null;duration=Number(item.duration)||null;
      mimeType='video/mp4';attribution='Video by '+creatorName+' on Pexels';
    }
  }else if(input.provider==='pixabay'){
    const key=await providerSecret('pixabay');
    const endpoint=input.kind==='image'?'https://pixabay.com/api/':'https://pixabay.com/api/videos/';
    const params=new URLSearchParams({key,id:input.providerAssetId});
    const response=await fetch(endpoint+'?'+params,{signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(!response.ok)throw new HttpError('O Pixabay não encontrou este asset.',404);
    const body=await response.json() as {hits?:Record<string,unknown>[]};
    const item=body.hits?.[0];
    if(!item)throw new HttpError('O Pixabay não encontrou este asset.',404);
    pageUrl=String(item.pageURL??'https://pixabay.com');
    creatorName=String(item.user??'Pixabay contributor');
    licenseLabel='Pixabay Content License';licenseUrl=PIXABAY_LICENSE;
    if(input.kind==='image'){
      downloadUrl=String(item.largeImageURL??item.webformatURL??'');
      width=Number(item.imageWidth)||null;height=Number(item.imageHeight)||null;
      mimeType='image/jpeg';attribution='Image by '+creatorName+' on Pixabay';
    }else{
      const videos=(item.videos??{}) as Record<string,Record<string,unknown>>;
      const file=videos.medium??videos.large??videos.small??videos.tiny;
      if(!file?.url)throw new HttpError('O Pixabay não devolveu um vídeo utilizável.',502);
      downloadUrl=String(file.url);width=Number(file.width)||null;height=Number(file.height)||null;duration=Number(item.duration)||null;
      mimeType='video/mp4';attribution='Video by '+creatorName+' on Pixabay';
    }
  }else{
    throw new HttpError(
      'O Unsplash está disponível nesta fase para descoberta e preview. A API exige hotlink; cópia automática para o Asset Vault fica bloqueada até o resolver externo preservar hotlink e atribuição.',
      409
    );

  }

  if(!downloadUrl)throw new HttpError('O provider não devolveu URL de download.',502);
  const downloaded=await safeDownload(downloadUrl,input.provider,input.kind==='image'?IMAGE_MAX:VIDEO_MAX);
  const actualMime=downloaded.mimeType||mimeType;

  return persistStockSceneAsset({
    promptSetId:input.promptSetId,
    sceneId:input.sceneId,
    provider:input.provider,
    providerAssetId:input.providerAssetId,
    kind:input.kind,
    bytes:downloaded.bytes,
    mimeType:actualMime,
    width,height,durationSeconds:duration,
    pageUrl,creatorName,creatorUrl,attributionLabel:attribution,
    licenseLabel,licenseUrl
  });
}

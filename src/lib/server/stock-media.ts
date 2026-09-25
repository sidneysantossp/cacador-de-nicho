import 'server-only';

import type { StockMediaProvider, StockMediaResult } from '@/lib/types';
import { checked, db } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { parseVecteezyConfig, vecteezyHeaders } from './vecteezy';
import { loadVisualPromptSet } from './visual-prompt-engine';
import { deleteSceneAsset, persistStockSceneAsset, selectSceneAsset } from './asset-factory';
import { analyzeVisualAsset, bestVisualSegment, loadVisualIntelligence } from './visual-intelligence';
import {
  rankStockMediaResults, stockCandidateAccepted, stockDownloadHostAllowed, validStockQuery
} from '@/lib/stock-media-policy';
import { scoreVisualSegment } from '@/lib/media-library-policy';

const PEXELS_LICENSE='https://www.pexels.com/license/';
const PIXABAY_LICENSE='https://pixabay.com/service/license-summary/';
const VECTEEZY_LICENSE='https://www.vecteezy.com/licensing-agreement';
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

function vecteezyResult(item:Record<string,unknown>,kind:'image'|'video'):StockMediaResult{
  const dimensions=(item.dimensions??item.preview_dimensions??item.thumbnail_dimensions??{}) as Record<string,unknown>;
  return {
    provider:'vecteezy',
    providerAssetId:String(item.id??''),
    kind,
    title:String(item.title??('Vecteezy '+kind+' '+String(item.id??''))),
    previewUrl:String(item.preview_url??item.thumbnail_2x_url??item.thumbnail_url??''),
    pageUrl:'https://www.vecteezy.com/',
    creatorName:'Vecteezy contributor',
    width:Number(dimensions.width)||null,
    height:Number(dimensions.height)||null,
    durationSeconds:null,
    licenseLabel:'Vecteezy API',
    attributionLabel:'Vecteezy asset — attribution is resolved at download time'
  };
}
export async function searchStockMedia(input:{
  promptSetId:string;sceneId:string;provider:StockMediaProvider;kind:'image'|'video';query:string;
  orientation?:'landscape'|'portrait'|'any';
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
    const params=new URLSearchParams({query,per_page:'24',page:'1'});
    if((input.orientation??'landscape')!=='any')params.set('orientation',input.orientation??'landscape');
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
    if(input.kind==='image'&&(input.orientation??'landscape')!=='any'){
      params.set('orientation',(input.orientation??'landscape')==='portrait'?'vertical':'horizontal');
    }
    let response:Response;
    try{response=await fetch(endpoint+'?'+params,{signal:AbortSignal.timeout(20000),cache:'no-store'});}
    catch{throw new HttpError('Não foi possível pesquisar no Pixabay.',502);}
    if(response.status===429)throw new HttpError('O Pixabay atingiu o limite de API.',429);
    if(!response.ok)throw new HttpError('O Pixabay recusou a pesquisa.',502);
    const body=await response.json() as {hits?:Record<string,unknown>[]};
    results=(body.hits??[]).map(item=>input.kind==='image'?pixabayImage(item):pixabayVideo(item)).filter(item=>!!item.providerAssetId&&!!item.previewUrl);
    remaining=response.headers.get('x-ratelimit-remaining');
    reset=response.headers.get('x-ratelimit-reset');
  }else if(input.provider==='unsplash'){
    const key=await providerSecret('unsplash');
    const params=new URLSearchParams({
      query,per_page:'24',page:'1',content_filter:'high'
    });
    if((input.orientation??'landscape')!=='any')params.set('orientation',input.orientation??'landscape');
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
  }else{
    const config=parseVecteezyConfig(await providerSecret('vecteezy'));
    const params=new URLSearchParams({
      term:query,
      content_type:input.kind==='image'?'photo':'video',
      page:'1',
      per_page:'24',
      license_type:'commercial',
      family_friendly:'true',
      ai_generated:'false'
    });
    if(input.kind==='image'&&(input.orientation??'landscape')!=='any'){
      params.set('orientation',(input.orientation??'landscape')==='portrait'?'vertical':'horizontal');
    }
    let response:Response;
    try{
      response=await fetch('https://api.vecteezy.com/v2/'+encodeURIComponent(config.accountId)+'/resources?'+params,{
        headers:vecteezyHeaders(config),signal:AbortSignal.timeout(20000),cache:'no-store'
      });
    }catch{throw new HttpError('Não foi possível pesquisar no Vecteezy.',502);}
    if(response.status===402||response.status===429)throw new HttpError('O Vecteezy atingiu o limite de downloads ou chamadas da API.',429);
    if(response.status===401||response.status===403)throw new HttpError('O Vecteezy recusou a credencial da conta.',422);
    if(!response.ok)throw new HttpError('O Vecteezy recusou a pesquisa.',502);
    const body=await response.json() as {resources?:Record<string,unknown>[]};
    results=(body.resources??[]).map(item=>vecteezyResult(item,input.kind)).filter(item=>!!item.providerAssetId&&!!item.previewUrl);
    remaining=response.headers.get('x-quota-remaining');
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
  selectIfNone?:boolean;
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
  }else if(input.provider==='unsplash'){
    throw new HttpError(
      'O Unsplash está disponível nesta fase para descoberta e preview. A API exige hotlink; cópia automática para o Asset Vault fica bloqueada até o resolver externo preservar hotlink e atribuição.',
      409
    );
  }else{
    const config=parseVecteezyConfig(await providerSecret('vecteezy'));
    const id=encodeURIComponent(input.providerAssetId);
    const base='https://api.vecteezy.com/v2/'+encodeURIComponent(config.accountId)+'/resources/'+id;
    const resourceResponse=await fetch(base,{headers:vecteezyHeaders(config),signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(resourceResponse.status===401||resourceResponse.status===403)throw new HttpError('O Vecteezy recusou a credencial da conta.',422);
    if(resourceResponse.status===402)throw new HttpError('O Vecteezy atingiu a quota da conta.',429);
    if(!resourceResponse.ok)throw new HttpError('O Vecteezy não encontrou este asset.',404);
    const resource=await resourceResponse.json() as Record<string,unknown>;
    const contentType=String(resource.content_type??'');
    if(input.kind==='image'&&contentType!=='photo')throw new HttpError('O asset Vecteezy selecionado não é uma foto.',409);
    if(input.kind==='video'&&contentType!=='video')throw new HttpError('O asset Vecteezy selecionado não é um vídeo.',409);
    const metadata=(resource.file_metadata??{}) as Record<string,unknown>;
    const fileTypes=(metadata.available_file_types??[]) as Record<string,unknown>[];
    const extensions=fileTypes.map(item=>String(item.extension??'').toLowerCase()).filter(Boolean);
    const preferred=input.kind==='image'
      ?extensions.find(value=>['jpg','jpeg','png'].includes(value))
      :extensions.find(value=>value==='mp4');
    const params=new URLSearchParams();
    if(preferred)params.set('file_type',preferred);
    let downloadResponse:Response;
    try{
      downloadResponse=await fetch(base+'/download'+(params.size?'?'+params:''),{
        headers:vecteezyHeaders(config),signal:AbortSignal.timeout(30000),cache:'no-store'
      });
    }catch{throw new HttpError('Não foi possível preparar o download do Vecteezy.',502);}
    if(downloadResponse.status===402||downloadResponse.status===429)throw new HttpError('O Vecteezy atingiu a quota de downloads.',429);
    if(downloadResponse.status===401||downloadResponse.status===403)throw new HttpError('O Vecteezy recusou o download deste asset.',422);
    if(!downloadResponse.ok)throw new HttpError('O Vecteezy não conseguiu preparar este download.',502);
    const prepared=await downloadResponse.json() as Record<string,unknown>;
    downloadUrl=String(prepared.url??'');
    const requiresAttribution=Boolean(prepared.requires_attribution);
    const attributionUrl=prepared.required_attribution_url?String(prepared.required_attribution_url):'';
    pageUrl=attributionUrl||'https://www.vecteezy.com/';
    creatorName='Vecteezy contributor';
    const dimensions=(resource.dimensions??{}) as Record<string,unknown>;
    width=Number(dimensions.width)||null;height=Number(dimensions.height)||null;
    mimeType=input.kind==='image'?'image/jpeg':'video/mp4';
    licenseLabel='Vecteezy '+String(resource.license_type??'License')+(requiresAttribution?' · attribution required':'');
    licenseUrl=attributionUrl||VECTEEZY_LICENSE;
    attribution=requiresAttribution
      ?'Vecteezy attribution required: '+attributionUrl
      :'Vecteezy API asset';
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
    licenseLabel,licenseUrl,
    selectIfNone:input.selectIfNone
  });
}


async function existingStockSceneAsset(input:{
  promptSetId:string;
  sceneId:string;
  provider:StockMediaProvider;
  providerAssetId:string;
}){
  const rows=checked(await db().from('radar_scene_assets')
    .select('id,status,payload')
    .eq('visual_prompt_set_id',input.promptSetId)
    .eq('scene_id',input.sceneId)
    .eq('source_type','stock')
    .eq('provider',input.provider)
    .eq('status','ready')
    .order('variant',{ascending:false})
    .limit(100));
  return (rows??[]).find(row=>{
    const payload=(row.payload??{}) as Record<string,unknown>;
    const stock=payload.stock&&typeof payload.stock==='object'
      ?payload.stock as Record<string,unknown>
      :{};
    return String(stock.providerAssetId??'')===input.providerAssetId;
  })??null;
}

export async function resolveVerifiedStockMediaForScene(input:{
  promptSetId:string;
  sceneId:string;
  query:string;
  desiredDurationSeconds:number;
  orientation?:'landscape'|'portrait'|'any';
  providers?:StockMediaProvider[];
  maxCandidatesPerProvider?:number;
}){
  const query=input.query.trim().slice(0,100);
  if(!validStockQuery(query))throw new HttpError('A intenção visual stock precisa ter entre 1 e 100 caracteres.',400);
  const orientation=input.orientation??'landscape';
  const providerSeed:StockMediaProvider[]=input.providers?.length
    ?input.providers
    :['pexels','pixabay'];
  const providers=providerSeed.filter((provider,index,list)=>list.indexOf(provider)===index);
  const maxCandidates=Math.max(1,Math.min(3,input.maxCandidatesPerProvider??2));
  const attempts:Array<Record<string,unknown>>=[];

  for(const provider of providers){
    let discovered:Awaited<ReturnType<typeof searchStockMedia>>;
    try{
      discovered=await searchStockMedia({
        promptSetId:input.promptSetId,
        sceneId:input.sceneId,
        provider,
        kind:'video',
        query,
        orientation
      });
    }catch(error){
      attempts.push({
        provider,
        stage:'search',
        error:error instanceof Error?error.message:'Falha desconhecida na busca stock.'
      });
      continue;
    }

    const ranked=rankStockMediaResults({
      query,
      results:discovered.results,
      desiredDurationSeconds:input.desiredDurationSeconds,
      orientation
    }).filter(item=>item.relevance>=.45).slice(0,maxCandidates);

    for(const candidate of ranked){
      let assetId:string|null=null;
      let createdCandidate=false;
      try{
        const existing=await existingStockSceneAsset({
          promptSetId:input.promptSetId,
          sceneId:input.sceneId,
          provider,
          providerAssetId:candidate.result.providerAssetId
        });
        const asset=existing
          ?{id:String(existing.id)}
          :await importStockMedia({
            promptSetId:input.promptSetId,
            sceneId:input.sceneId,
            provider,
            kind:'video',
            providerAssetId:candidate.result.providerAssetId,
            selectIfNone:false
          });
        if(!asset)throw new HttpError('O import stock não devolveu um Scene Asset.',502);
        assetId=asset.id;
        createdCandidate=!existing;

        const currentAnalysis=await loadVisualIntelligence(asset.id);
        if(currentAnalysis.status!=='completed'||!currentAnalysis.segments.length){
          await analyzeVisualAsset(asset.id);
        }
        const match=await bestVisualSegment({
          assetId:asset.id,
          query,
          desiredDurationSeconds:input.desiredDurationSeconds
        });
        const visualRelevance=match?scoreVisualSegment(query,match.segment.searchText):0;
        const combinedScore=candidate.score*.55+visualRelevance*.45;
        if(match&&stockCandidateAccepted({
          searchScore:candidate.relevance,
          visualRelevance,
          combinedScore
        })){
          await selectSceneAsset(asset.id);
          const row=checked(await db().from('radar_scene_assets')
            .select('payload')
            .eq('id',asset.id)
            .maybeSingle());
          const payload=(row?.payload??{}) as Record<string,unknown>;
          await db().from('radar_scene_assets').update({
            payload:{
              ...payload,
              verifiedStock:{
                query,
                provider,
                providerAssetId:candidate.result.providerAssetId,
                searchRelevance:candidate.relevance,
                visualRelevance,
                combinedScore,
                sourceStartSeconds:match.sourceStartSeconds,
                sourceEndSeconds:match.sourceEndSeconds,
                verifiedAt:new Date().toISOString()
              }
            },
            updated_at:new Date().toISOString()
          }).eq('id',asset.id);
          return {
            status:'matched' as const,
            query,
            provider,
            assetId:asset.id,
            candidate:candidate.result,
            searchRelevance:candidate.relevance,
            visualRelevance,
            combinedScore,
            match,
            attempts
          };
        }

        attempts.push({
          provider,
          providerAssetId:candidate.result.providerAssetId,
          stage:'visual-verification',
          searchRelevance:candidate.relevance,
          visualRelevance,
          combinedScore,
          accepted:false
        });
        if(createdCandidate)await deleteSceneAsset(asset.id);
        assetId=null;
      }catch(error){
        if(assetId&&createdCandidate){
          await deleteSceneAsset(assetId).catch(()=>{});
        }
        attempts.push({
          provider,
          providerAssetId:candidate.result.providerAssetId,
          stage:'candidate',
          error:error instanceof Error?error.message:'Falha desconhecida no candidato stock.'
        });
      }
    }
  }

  return {
    status:'gap' as const,
    query,
    provider:null,
    assetId:null,
    candidate:null,
    match:null,
    attempts
  };
}

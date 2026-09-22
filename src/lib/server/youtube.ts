import 'server-only';

import type { Channel, ChannelNicheProfile, ChannelStudyVideo, Settings } from '@/lib/types';
import {
  REFERENCE_CHANNELS,
  REFERENCE_DISCOVERY_QUERIES,
  referenceForName,
  type ReferenceChannel
} from '@/lib/reference-catalog';
import { checked, db, list, put } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { evaluateOpportunityCandidate, isoDurationSeconds, MIN_LONG_FORM_SECONDS } from '@/lib/opportunity-criteria';

type Item={
  id:string|{videoId?:string;channelId?:string};
  snippet:{
    channelId?:string;
    title:string;
    description:string;
    publishedAt:string;
    customUrl?:string;
    country?:string;
    defaultLanguage?:string;
    defaultAudioLanguage?:string;
    categoryId?:string;
    thumbnails?:Record<string,{url:string}>;
    resourceId?:{videoId:string}
  };
  statistics?:{
    viewCount?:string;
    likeCount?:string;
    commentCount?:string;
    videoCount?:string;
    subscriberCount?:string;
    hiddenSubscriberCount?:boolean
  };
  contentDetails?:{duration?:string;relatedPlaylists?:{uploads:string}}
};

async function youtubePage(resource:string,params:Record<string,string>){
  const query=new URLSearchParams({...params,key:await providerSecret('youtube')});
  const response=await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query}`,{
    signal:AbortSignal.timeout(20000),
    cache:'no-store'
  });
  if(!response.ok){
    throw new HttpError(
      response.status===403
        ?'YouTube recusou a consulta: confira a chave, API habilitada e cota de pesquisa.'
        :`YouTube indisponível (HTTP ${response.status}).`,
      502
    );
  }
  const body=await response.json() as {items?:Item[];nextPageToken?:string};
  return {items:body.items??[],nextPageToken:body.nextPageToken};
}
async function youtube(resource:string,params:Record<string,string>){
  return (await youtubePage(resource,params)).items;
}

const thumb=(item:Item)=>
  item.snippet.thumbnails?.high?.url??
  item.snippet.thumbnails?.medium?.url??
  item.snippet.thumbnails?.default?.url??
  '';

function idOf(item:Item){
  if(typeof item.id==='string')return item.id;
  return item.id.videoId??item.id.channelId??'';
}

const norm=(value:string)=>
  value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();

function nameScore(a:string,b:string){
  const x=norm(a),y=norm(b);
  if(x===y)return 1;
  if(x.includes(y)||y.includes(x))return 0.94;
  const xs=new Set(x.split(' ').filter(Boolean)),ys=new Set(y.split(' ').filter(Boolean));
  const intersection=[...xs].filter(t=>ys.has(t)).length;
  const union=new Set([...xs,...ys]).size;
  return union?intersection/union:0;
}

async function mapLimit<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>){
  const output=new Array<R>(items.length);
  let cursor=0;
  async function worker(){
    while(cursor<items.length){
      const index=cursor++;
      output[index]=await work(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return output;
}

function hoursSince(date:string,now=Date.now()){
  return Math.max(0,(now-Date.parse(date))/3600000);
}

function videoSignal(video:Item){
  const ageHours=Math.max(6,hoursSince(video.snippet.publishedAt));
  const views=Number(video.statistics?.viewCount??0);
  return views/Math.max(ageHours/24,0.25);
}

function inferNiche(video:Item){
  const text=`${video.snippet.title} ${video.snippet.description}`.toLowerCase();
  const groups:Array<[string,string[]]>= [
    ['History',['history','historical','ancient','empire','civilization','medieval','archaeology']],
    ['Engineering',['engineering','engineer','mechanical','civil engineering','machine','infrastructure','construction']],
    ['Military',['military','weapon','war ','battle','tank','aircraft','army','navy','geopolitic']],
    ['Education',['education','explained','how it works','science','physics','chemistry','learn','documentary']],
    ['Storytelling',['story','storytelling','animated story','my story','life story']],
    ['Entertainment',['entertainment','animation','animated','cartoon','comedy','funny']],
    ['Fitness & Health',['fitness','health','bodybuilding','workout','nutrition','muscle','medical','body']],
    ['Crime & Psychology',['crime','criminal','psychology','murder','mystery','behavior','serial killer']],
    ['Animals',['animal','wildlife','dog','cat','fish','bird','dinosaur','insect']],
    ['Gaming',['gaming','game','roblox','minecraft','fortnite']],
    ['Politics',['politics','political','election','government']],
    ['Stats',['data','statistics','comparison','ranked','countries compared']],
    ['Sport',['sport','football','soccer','basketball','athlete','nba','nfl']],
    ['Biology',['biology','cell','organism','evolution','anatomy']]
  ];
  for(const [name,words] of groups)if(words.some(word=>text.includes(word)))return name;
  return 'Explained';
}

function inferFormat(video:Item,sourceQuery:string){
  const text=`${sourceQuery} ${video.snippet.title} ${video.snippet.description}`.toLowerCase();
  const duration=video.contentDetails?.duration??'';
  const short=/^PT(?:\d+M)?(?:[0-5]?\dS)$/.test(duration)&&!/^PT(?:[2-9]\d|\d{3,})M/.test(duration);
  if(text.includes('3d')||text.includes('cgi')||text.includes('simulation'))return short?'Shorts 3D':'3D Animation';
  if(text.includes('shorts')||text.includes('#shorts'))return 'Shorts 2D';
  if(text.includes('animated')||text.includes('animation'))return '2D Animation';
  if(text.includes('storytelling')||text.includes('story'))return 'Storytelling';
  return 'Explained';
}

function signalsFor(video:Item,channel:Item,config:Settings){
  const now=Date.now();
  const views=Number(video.statistics?.viewCount??0);
  const videoCount=Number(channel.statistics?.videoCount??0);
  const subscribers=channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount??0);
  const videoHours=hoursSince(video.snippet.publishedAt,now);
  const channelDays=Math.max(0,(now-Date.parse(channel.snippet.publishedAt))/86400000);
  const signals:string[]=[];
  if(views>=config.minViews)signals.push(`Alcance forte: ${views.toLocaleString('en-US')} visualizações públicas.`);
  if(videoHours<=config.maxVideoAgeHours)signals.push(`Recência forte: publicado há cerca de ${Math.max(1,Math.round(videoHours))}h.`);
  if(videoCount<=config.maxChannelVideos)signals.push(`Canal enxuto: ${videoCount} vídeos publicados.`);
  if(channelDays<=config.maxChannelAgeDays)signals.push(`Canal recente: criado há cerca de ${Math.max(1,Math.round(channelDays))} dias.`);
  if(subscribers&&subscribers>0&&views>subscribers)signals.push(`Breakout público: o vídeo observado tem mais views que a base atual de inscritos.`);
  return signals;
}

async function resolveReferenceIds(prior:Channel[]){
  const resolved=new Map<string,string>();
  for(const channel of prior){
    const ref=channel.reference
      ?REFERENCE_CHANNELS.find(r=>norm(r.name)===norm(channel.reference!.catalogName))
      :referenceForName(channel.name);
    if(ref)resolved.set(norm(ref.name),channel.id);
  }

  const unresolved=REFERENCE_CHANNELS.filter(ref=>!resolved.has(norm(ref.name)));
  for(let i=0;i<unresolved.length;i+=7){
    const group=unresolved.slice(i,i+7);
    const found=await youtube('search',{
      part:'snippet',
      type:'channel',
      q:group.map(ref=>ref.name).join('|'),
      maxResults:'50',
      relevanceLanguage:'en'
    });
    for(const item of found){
      const id=idOf(item);
      if(!id)continue;
      const ranked=group
        .map(ref=>({ref,score:nameScore(item.snippet.title,ref.name)}))
        .sort((a,b)=>b.score-a.score);
      if(ranked[0]?.score>=0.76&&!resolved.has(norm(ranked[0].ref.name))){
        resolved.set(norm(ranked[0].ref.name),id);
      }
    }
  }
  return resolved;
}

async function monitorReferences(config:Settings,prior:Channel[]){
  const resolved=await resolveReferenceIds(prior);
  const ids=[...new Set(resolved.values())];
  const detailMap=new Map<string,Item>();

  for(let i=0;i<ids.length;i+=50){
    const details=await youtube('channels',{
      part:'snippet,statistics,contentDetails',
      id:ids.slice(i,i+50).join(',')
    });
    for(const item of details)detailMap.set(idOf(item),item);
  }

  const uploads=await mapLimit(ids,8,async id=>{
    const channel=detailMap.get(id);
    const playlistId=channel?.contentDetails?.relatedPlaylists?.uploads;
    if(!playlistId)return {id,videoIds:[] as string[]};
    const items=await youtube('playlistItems',{
      part:'snippet',
      playlistId,
      maxResults:'20'
    });
    return {id,videoIds:items.map(v=>v.snippet.resourceId?.videoId??'').filter(Boolean)};
  });

  const allVideoIds=[...new Set(uploads.flatMap(x=>x.videoIds))];
  const videoMap=new Map<string,Item>();
  for(let i=0;i<allVideoIds.length;i+=50){
    const videos=await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:allVideoIds.slice(i,i+50).join(',')
    });
    for(const video of videos)videoMap.set(idOf(video),video);
  }

  const byChannel=new Map(uploads.map(x=>[
    x.id,
    x.videoIds.map(id=>videoMap.get(id)).filter((v):v is Item=>!!v)
  ]));

  const observedAt=new Date().toISOString();
  const payloads:Channel[]=[];

  for(const ref of REFERENCE_CHANNELS){
    const id=resolved.get(norm(ref.name));
    if(!id)continue;
    const channel=detailMap.get(id);
    if(!channel)continue;
    const videos=(byChannel.get(id)??[]).sort((a,b)=>videoSignal(b)-videoSignal(a));
    const video=videos[0];
    const old=prior.find(x=>x.id===id);
    if(!video&&old){
      payloads.push({...old,discoverySource:'reference',reference:{catalogName:ref.name,tier:ref.tier,format:ref.format,niche:ref.niche}});
      continue;
    }
    if(!video)continue;

    const signals=signalsFor(video,channel,config);
    const views=Number(video.statistics?.viewCount??0);
    const subscribers=channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount??0);
    const payload:Channel={
      id,
      name:channel.snippet.title,
      handle:channel.snippet.customUrl??'',
      niche:ref.niche,
      language:ref.market==='adjacent'?'Mercado adjacente':'Inglês / confirmar metadado',
      format:ref.format,
      description:channel.snippet.description.slice(0,2000),
      lens:`Referência ${ref.tier} do catálogo: ${ref.format} + ${ref.niche}.`,
      thumbnail:thumb(video),
      avatar:thumb(channel),
      url:`https://www.youtube.com/channel/${id}`,
      createdAt:channel.snippet.publishedAt,
      firstSeenAt:old?.firstSeenAt??observedAt,
      observedAt,
      videoCount:Number(channel.statistics?.videoCount??0),
      subscribers,
      video:{
        id:idOf(video),
        title:video.snippet.title,
        publishedAt:video.snippet.publishedAt,
        views,
        duration:video.contentDetails?.duration??'',
        thumbnail:thumb(video),
        url:`https://www.youtube.com/watch?v=${idOf(video)}`
      },
      status:old?.status??'watching',
      evidence:[
        `Canal incluído no catálogo de referência fornecido pelo operador como ${ref.tier}.`,
        `Padrão catalogado: ${ref.format} + ${ref.niche}.`,
        `Melhor sinal entre os uploads recentes monitorados: "${video.snippet.title}".`,
        ...signals,
        'O radar monitora esta referência mesmo quando ela não atende aos limiares numéricos de prioridade.'
      ],
      discoverySource:'reference',
      reference:{catalogName:ref.name,tier:ref.tier,format:ref.format,niche:ref.niche},
      ...(old?.video.id===idOf(video)&&old.analysis?{analysis:old.analysis}:{})
    };
    payloads.push(payload);
  }

  return payloads;
}

const legacyGeneric=new Set([
  'explained','documentary','how it works','why','what if',
  'finance explained animation','economics explained animation'
]);

async function discoverAdjacent(config:Settings,prior:Channel[],referenceIds:Set<string>){
  const configured=config.queries
    .map(q=>q.trim())
    .filter(q=>q.length>=2&&!legacyGeneric.has(q.toLowerCase()));

  const queries=[...new Set([...REFERENCE_DISCOVERY_QUERIES,...configured])];
  const videoIds=new Set<string>();
  const sourceByVideo=new Map<string,string>();

  const publishedAfter=new Date(Date.now()-config.maxVideoAgeHours*3600000).toISOString();
  for(const query of queries){
    for(const videoDuration of ['medium','long'] as const){
      const found=await youtube('search',{
        part:'snippet',
        type:'video',
        q:query,
        order:'viewCount',
        publishedAfter,
        maxResults:'50',
        relevanceLanguage:'en',
        regionCode:'US',
        videoDuration
      });
      for(const item of found){
        const id=idOf(item);
        if(!id)continue;
        videoIds.add(id);
        if(!sourceByVideo.has(id))sourceByVideo.set(id,query);
      }
    }
  }

  const videos:Item[]=[];
  const ids=[...videoIds];
  for(let i=0;i<ids.length;i+=50){
    videos.push(...await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:ids.slice(i,i+50).join(',')
    }));
  }

  const candidates=videos.filter(video=>{
    const language=(video.snippet.defaultAudioLanguage??video.snippet.defaultLanguage??'').toLowerCase();
    return language.startsWith('en')&&!!video.snippet.channelId&&!referenceIds.has(video.snippet.channelId);
  });

  const channelIds=[...new Set(candidates.map(v=>v.snippet.channelId!).filter(Boolean))];
  const channels:Item[]=[];
  for(let i=0;i<channelIds.length;i+=50){
    channels.push(...await youtube('channels',{
      part:'snippet,statistics',
      id:channelIds.slice(i,i+50).join(',')
    }));
  }

  const observedAt=new Date().toISOString();
  const prepared:Array<{score:number;payload:Channel}>=[];

  for(const channel of channels){
    const id=idOf(channel);
    const relevant=candidates
      .filter(v=>v.snippet.channelId===id)
      .sort((a,b)=>videoSignal(b)-videoSignal(a));
    const video=relevant[0];
    if(!video)continue;
    const sourceQuery=sourceByVideo.get(idOf(video))??'matriz de referências faceless';
    const signals=signalsFor(video,channel,config);
    const old=prior.find(c=>c.id===id);
    const views=Number(video.statistics?.viewCount??0);
    const subscribers=channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount??0);
    const format=inferFormat(video,sourceQuery);
    const niche=inferNiche(video);
    const payload:Channel={
      id,
      name:channel.snippet.title,
      handle:channel.snippet.customUrl??'',
      niche,
      language:(video.snippet.defaultAudioLanguage??video.snippet.defaultLanguage??'en').toLowerCase(),
      country:channel.snippet.country,
      format,
      description:channel.snippet.description.slice(0,2000),
      lens:`Descoberto ao expandir o padrão validado "${sourceQuery}".`,
      thumbnail:thumb(video),
      avatar:thumb(channel),
      url:`https://www.youtube.com/channel/${id}`,
      createdAt:channel.snippet.publishedAt,
      firstSeenAt:old?.firstSeenAt??observedAt,
      observedAt,
      videoCount:Number(channel.statistics?.videoCount??0),
      subscribers,
      video:{
        id:idOf(video),
        title:video.snippet.title,
        publishedAt:video.snippet.publishedAt,
        views,
        duration:video.contentDetails?.duration??'',
        thumbnail:thumb(video),
        url:`https://www.youtube.com/watch?v=${idOf(video)}`
      },
      status:old?.status??'new',
      evidence:[
        `Descoberta adjacente à matriz do catálogo: consulta "${sourceQuery}".`,
        `Visualizações públicas observadas em ${observedAt}.`,
        ...signals,
        'Todos os filtros do radar são eliminatórios: Estados Unidos, inglês confirmado nos metadados, long form, alcance, recência, canal enxuto/recente e breakout.'
      ],
      discoverySource:'reference-adjacent',
      ...(old?.video.id===idOf(video)&&old.analysis?{analysis:old.analysis}:{})
    };
    const qualification=evaluateOpportunityCandidate(payload,config);
    if(!qualification.qualified)continue;
    payload.evidence.push(
      `PASS obrigatório: US + English + long form (${Math.round(qualification.durationSeconds/60)} min); ${views.toLocaleString('en-US')} views em ${Math.max(1,Math.round(qualification.ageHours))}h; ${payload.videoCount} vídeos; canal com ${Math.max(1,Math.round(qualification.channelAgeDays))} dias.`
    );
    if(qualification.breakoutRatio!==null){
      payload.evidence.push(`Breakout: vídeo com ${qualification.breakoutRatio.toFixed(1)}× a base atual de inscritos.`);
    }
    const breakout=qualification.breakoutRatio===null?1:Math.min(8,qualification.breakoutRatio);
    const score=Math.log10(videoSignal(video)+1)*10+Math.log10(views+1)*2+breakout;
    prepared.push({score,payload});
  }

  return prepared.sort((a,b)=>b.score-a.score).map(x=>x.payload);
}

export async function scan(config:Settings){
  const prior=await list<Channel>('radar_channels',1000);
  const references=await monitorReferences(config,prior);
  const referenceIds=new Set(references.map(c=>c.id));
  const adjacent=await discoverAdjacent(config,prior,referenceIds);
  const observedAt=new Date().toISOString();
  // Referências grandes continuam monitoradas como inteligência de mercado,
  // mas somente candidatos que passam por TODOS os gates entram no radar de oportunidades.

  // Persist lower-priority discoveries first so the strongest current signals and
  // reference updates are returned near the top by updated_at.
  for(const channel of [...adjacent].reverse()){
    await put('radar_channels',channel.id,channel);
    checked(await db().from('radar_snapshots').insert({
      channel_id:channel.id,
      video_id:channel.video.id,
      views:channel.video.views,
      observed_at:observedAt
    }));
  }
  for(const channel of references){
    await put('radar_channels',channel.id,channel);
    checked(await db().from('radar_snapshots').insert({
      channel_id:channel.id,
      video_id:channel.video.id,
      views:channel.video.views,
      observed_at:observedAt
    }));
  }

  return adjacent.length;
}


type CommentThreadItem={
  snippet?:{
    topLevelComment?:{
      snippet?:{
        textDisplay?:string;
        textOriginal?:string;
        likeCount?:number;
        publishedAt?:string;
      }
    }
  }
};

async function youtubeComments(videoId:string){
  const query=new URLSearchParams({
    part:'snippet',
    videoId,
    order:'relevance',
    maxResults:'10',
    textFormat:'plainText',
    key:await providerSecret('youtube')
  });
  const response=await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${query}`,{
    signal:AbortSignal.timeout(20000),
    cache:'no-store'
  });
  if(response.status===403||response.status===404)return [];
  if(!response.ok)return [];
  const body=await response.json() as {items?:CommentThreadItem[]};
  return (body.items??[]).flatMap(item=>{
    const snippet=item.snippet?.topLevelComment?.snippet;
    const text=(snippet?.textOriginal??snippet?.textDisplay??'').trim();
    if(!text)return [];
    return [{
      text:text.slice(0,1200),
      likes:Number(snippet?.likeCount??0),
      publishedAt:snippet?.publishedAt??''
    }];
  });
}

async function resolveChannelInput(input:string){
  const raw=input.trim();
  if(!raw)throw new HttpError('Informe um canal, @handle ou URL do YouTube.',400);
  let id='';
  let handle='';
  let username='';
  try{
    const url=new URL(/^https?:\/\//i.test(raw)?raw:`https://youtube.com/${raw.replace(/^\/+/, '')}`);
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]==='channel'&&parts[1])id=parts[1];
    else if(parts[0]?.startsWith('@'))handle=parts[0];
    else if(parts[0]==='user'&&parts[1])username=parts[1];
    else if(parts[0]?.startsWith('UC'))id=parts[0];
  }catch{}
  if(!id&&raw.startsWith('UC'))id=raw;
  if(!handle&&raw.startsWith('@'))handle=raw;

  let channels:Item[]=[];
  if(id){
    channels=await youtube('channels',{part:'snippet,statistics,contentDetails',id});
  }else if(handle){
    channels=await youtube('channels',{part:'snippet,statistics,contentDetails',forHandle:handle.replace(/^@/,'')});
  }else if(username){
    channels=await youtube('channels',{part:'snippet,statistics,contentDetails',forUsername:username});
  }else{
    const found=await youtube('search',{
      part:'snippet',
      type:'channel',
      q:raw,
      maxResults:'10',
      relevanceLanguage:'en',
      regionCode:'US'
    });
    const best=[...found].sort((a,b)=>nameScore(b.snippet.title,raw)-nameScore(a.snippet.title,raw))[0];
    if(best){
      channels=await youtube('channels',{part:'snippet,statistics,contentDetails',id:idOf(best)});
    }
  }
  const channel=channels[0];
  if(!channel)throw new HttpError('Canal do YouTube não encontrado.',404);
  return channel;
}

export async function collectChannelStudyEvidence(input:string){
  const channel=await resolveChannelInput(input);
  const channelId=idOf(channel);
  const observedAt=new Date().toISOString();
  const source={
    id:channelId,
    name:channel.snippet.title,
    handle:channel.snippet.customUrl??'',
    description:channel.snippet.description,
    url:`https://www.youtube.com/channel/${channelId}`,
    createdAt:channel.snippet.publishedAt,
    videoCount:Number(channel.statistics?.videoCount??0),
    subscribers:channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount??0),
    avatar:thumb(channel)
  };

  // Global high-view candidates. Search is used only to obtain the strongest long-form
  // videos; it is not presented as an exhaustive scan of the channel.
  const ids=new Set<string>();
  for(const videoDuration of ['medium','long'] as const){
    const found=await youtube('search',{
      part:'snippet',
      type:'video',
      channelId,
      order:'viewCount',
      maxResults:'25',
      videoDuration
    });
    for(const item of found){
      const id=idOf(item);
      if(id)ids.add(id);
    }
  }
  const videoIds=[...ids];
  const videos:Item[]=[];
  for(let i=0;i<videoIds.length;i+=50){
    videos.push(...await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:videoIds.slice(i,i+50).join(',')
    }));
  }
  const topItems=videos
    .filter(video=>isoDurationSeconds(video.contentDetails?.duration??'')>=MIN_LONG_FORM_SECONDS)
    .sort((a,b)=>Number(b.statistics?.viewCount??0)-Number(a.statistics?.viewCount??0))
    .slice(0,10);
  if(!topItems.length)throw new HttpError('Não encontrei vídeos long form públicos suficientes neste canal.',422);

  // Recent upload sample for contrast and sequence context. Up to 100 recent uploads are
  // inspected; weak videos are explicitly described as weak WITHIN THIS SAMPLE.
  const recentIds:string[]=[];
  const uploads=channel.contentDetails?.relatedPlaylists?.uploads;
  if(uploads){
    let pageToken:string|undefined;
    for(let page=0;page<2;page++){
      const pageData=await youtubePage('playlistItems',{
        part:'snippet',
        playlistId:uploads,
        maxResults:'50',
        ...(pageToken?{pageToken}:{})
      });
      recentIds.push(...pageData.items.map(item=>item.snippet.resourceId?.videoId??'').filter(Boolean));
      pageToken=pageData.nextPageToken;
      if(!pageToken)break;
    }
  }
  const recentItems:Item[]=[];
  const uniqueRecent=[...new Set(recentIds)];
  for(let i=0;i<uniqueRecent.length;i+=50){
    recentItems.push(...await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:uniqueRecent.slice(i,i+50).join(',')
    }));
  }
  const recentLong=recentItems
    .filter(video=>isoDurationSeconds(video.contentDetails?.duration??'')>=MIN_LONG_FORM_SECONDS)
    .sort((a,b)=>Date.parse(a.snippet.publishedAt)-Date.parse(b.snippet.publishedAt));

  const topIds=topItems.map(idOf);
  type SnapshotRow={video_id:string;views:number;observed_at:string};
  const snapshotRows:SnapshotRow[]=topIds.length
    ?checked(await db().from('radar_snapshots').select('video_id,views,observed_at').eq('channel_id',channelId).in('video_id',topIds).order('observed_at',{ascending:true}).limit(500)) as SnapshotRow[]
    :[];

  function snapshotData(video:Item){
    const id=idOf(video);
    const views=Number(video.statistics?.viewCount??0);
    const prior=snapshotRows.filter(row=>row.video_id===id);
    const previous=prior.at(-1);
    const deltaHours=previous?Math.max(0,(Date.parse(observedAt)-Date.parse(previous.observed_at))/3600000):null;
    const deltaViews=previous?Math.max(0,views-Number(previous.views)):null;
    return {
      snapshots:[
        ...prior.map(row=>({observedAt:row.observed_at,views:Number(row.views)})),
        {observedAt,views}
      ],
      velocity:{
        baseline:!previous,
        deltaViews,
        deltaHours,
        viewsPerHour:previous&&deltaHours&&deltaHours>0?Math.round(deltaViews!/deltaHours):null
      }
    };
  }
  function baseStudyVideo(video:Item):ChannelStudyVideo{
    const velocity=snapshotData(video);
    return {
      id:idOf(video),
      title:video.snippet.title,
      publishedAt:video.snippet.publishedAt,
      views:Number(video.statistics?.viewCount??0),
      likes:video.statistics?.likeCount===undefined?null:Number(video.statistics.likeCount),
      commentCount:video.statistics?.commentCount===undefined?null:Number(video.statistics.commentCount),
      duration:video.contentDetails?.duration??'',
      thumbnail:thumb(video),
      url:`https://www.youtube.com/watch?v=${idOf(video)}`,
      comments:[],
      ...velocity
    };
  }

  const topVideos:ChannelStudyVideo[]=await mapLimit(topItems,4,async video=>({
    ...baseStudyVideo(video),
    comments:await youtubeComments(idOf(video))
  }));

  // Store the new observation only after reading prior history, so the first run becomes
  // an explicit baseline and subsequent runs produce an actual velocity.
  for(const video of topVideos){
    checked(await db().from('radar_snapshots').insert({
      channel_id:channelId,
      video_id:video.id,
      views:video.views,
      observed_at:observedAt
    }));
  }

  const topSet=new Set(topVideos.map(video=>video.id));
  const weakItems=recentLong
    .filter(video=>!topSet.has(idOf(video)))
    .sort((a,b)=>Number(a.statistics?.viewCount??0)-Number(b.statistics?.viewCount??0))
    .slice(0,10);
  const weakRecentVideos:ChannelStudyVideo[]=weakItems.map(baseStudyVideo);

  const sequencePool=recentLong.map(video=>({
    id:idOf(video),
    title:video.snippet.title,
    views:Number(video.statistics?.viewCount??0),
    publishedAt:video.snippet.publishedAt
  }));
  const sequences=topVideos.slice(0,3).flatMap(hit=>{
    const index=sequencePool.findIndex(item=>item.id===hit.id);
    if(index<0)return [];
    return [{
      hitVideoId:hit.id,
      hitTitle:hit.title,
      before:sequencePool.slice(Math.max(0,index-2),index).map(({id,title,views})=>({id,title,views})),
      after:sequencePool.slice(index+1,index+3).map(({id,title,views})=>({id,title,views}))
    }];
  });

  const median=(values:number[])=>{
    if(!values.length)return null;
    const sorted=[...values].sort((a,b)=>a-b);
    return sorted.length%2?sorted[Math.floor(sorted.length/2)]:Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2);
  };
  const medianTop10Views=median(topVideos.map(video=>video.views))??0;
  const weakMedianViews=median(weakRecentVideos.map(video=>video.views));
  const top10Views=topVideos.reduce((sum,video)=>sum+video.views,0);
  const top3Views=topVideos.slice(0,3).reduce((sum,video)=>sum+video.views,0);
  const videosAboveSubscribers=source.subscribers===null
    ?null
    :topVideos.filter(video=>video.views>source.subscribers!).length;

  return {
    source,
    topVideos,
    weakRecentVideos,
    sequences,
    scannedVideos:new Set([...videoIds,...uniqueRecent]).size,
    totalPublicVideos:source.videoCount,
    scanTruncated:source.videoCount>new Set([...videoIds,...uniqueRecent]).size,
    comparisonSampleSize:recentLong.length,
    commentSampleSize:topVideos.reduce((sum,video)=>sum+video.comments.length,0),
    commentsAvailableVideos:topVideos.filter(video=>video.comments.length>0).length,
    metrics:{
      top10Views,
      top3Share:top10Views?top3Views/top10Views:0,
      medianTop10Views,
      weakMedianViews,
      hitToWeakMedianRatio:weakMedianViews&&weakMedianViews>0?medianTop10Views/weakMedianViews:null,
      videosAboveSubscribers,
      velocityTrackedVideos:topVideos.filter(video=>!video.velocity.baseline).length
    }
  };
}

function matchedNicheTerms(profile:ChannelNicheProfile,text:string){
  const normalized=norm(text);
  return profile.anchorTerms.filter(term=>{
    const t=norm(term);
    return t.length>=3&&normalized.includes(t);
  });
}

export async function findNicheLockedSimilarCandidates(
  profile:ChannelNicheProfile,
  config:Settings,
  excludeChannelId:string
){
  const publishedAfter=new Date(Date.now()-config.maxVideoAgeHours*3600000).toISOString();
  const videoIds=new Set<string>();
  const sourceByVideo=new Map<string,string>();

  for(const query of profile.searchQueries.slice(0,5)){
    for(const videoDuration of ['medium','long'] as const){
      const found=await youtube('search',{
        part:'snippet',
        type:'video',
        q:query,
        order:'viewCount',
        publishedAfter,
        maxResults:'50',
        relevanceLanguage:'en',
        regionCode:'US',
        videoDuration
      });
      for(const item of found){
        const id=idOf(item);
        if(!id)continue;
        videoIds.add(id);
        if(!sourceByVideo.has(id))sourceByVideo.set(id,query);
      }
    }
  }

  const videos:Item[]=[];
  const ids=[...videoIds];
  for(let i=0;i<ids.length;i+=50){
    videos.push(...await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:ids.slice(i,i+50).join(',')
    }));
  }
  const eligibleVideos=videos.filter(video=>{
    const language=(video.snippet.defaultAudioLanguage??video.snippet.defaultLanguage??'').toLowerCase();
    return language.startsWith('en')&&video.snippet.channelId&&video.snippet.channelId!==excludeChannelId;
  });

  const channelIds=[...new Set(eligibleVideos.map(video=>video.snippet.channelId!).filter(Boolean))];
  const channels:Item[]=[];
  for(let i=0;i<channelIds.length;i+=50){
    channels.push(...await youtube('channels',{
      part:'snippet,statistics',
      id:channelIds.slice(i,i+50).join(',')
    }));
  }

  const observedAt=new Date().toISOString();
  const candidates:Array<{score:number;channel:Channel}>=[];

  for(const channel of channels){
    const id=idOf(channel);
    if(channel.snippet.country!=='US')continue;
    const relevant=eligibleVideos
      .filter(video=>video.snippet.channelId===id)
      .sort((a,b)=>videoSignal(b)-videoSignal(a));
    const video=relevant[0];
    if(!video)continue;
    const sourceQuery=sourceByVideo.get(idOf(video))??profile.searchQueries[0]??profile.subniche;
    const lexicalText=`${channel.snippet.title} ${channel.snippet.description} ${video.snippet.title}`;
    const matches=matchedNicheTerms(profile,lexicalText);
    const exactMultiword=matches.some(term=>norm(term).includes(' '));
    if(matches.length<2&&!exactMultiword)continue;

    const views=Number(video.statistics?.viewCount??0);
    const subscribers=channel.statistics?.hiddenSubscriberCount?null:Number(channel.statistics?.subscriberCount??0);
    const payload:Channel={
      id,
      name:channel.snippet.title,
      handle:channel.snippet.customUrl??'',
      niche:inferNiche(video),
      language:(video.snippet.defaultAudioLanguage??video.snippet.defaultLanguage??'en').toLowerCase(),
      country:channel.snippet.country,
      format:`${inferFormat(video,sourceQuery)} · Long form`,
      description:channel.snippet.description.slice(0,2000),
      lens:`Candidato encontrado dentro do Niche Lock "${profile.subniche}".`,
      thumbnail:thumb(video),
      avatar:thumb(channel),
      url:`https://www.youtube.com/channel/${id}`,
      createdAt:channel.snippet.publishedAt,
      firstSeenAt:observedAt,
      observedAt,
      videoCount:Number(channel.statistics?.videoCount??0),
      subscribers,
      video:{
        id:idOf(video),
        title:video.snippet.title,
        publishedAt:video.snippet.publishedAt,
        views,
        duration:video.contentDetails?.duration??'',
        thumbnail:thumb(video),
        url:`https://www.youtube.com/watch?v=${idOf(video)}`
      },
      status:'new',
      evidence:[
        `Niche Lock: ${profile.primaryNiche} → ${profile.subniche}.`,
        `Termos de aderência encontrados: ${matches.join(', ')}.`,
        `Consulta focada: "${sourceQuery}".`,
        'Gate de mercado: canal US, vídeo em inglês e long form.'
      ],
      discoverySource:'reference-adjacent'
    };
    const qualification=evaluateOpportunityCandidate(payload,config);
    if(!qualification.qualified)continue;
    const breakout=qualification.breakoutRatio===null?1:Math.min(8,qualification.breakoutRatio);
    const score=matches.length*12+Math.log10(videoSignal(video)+1)*10+breakout;
    candidates.push({score,channel:payload});
  }

  const deduped=new Map<string,{score:number;channel:Channel}>();
  for(const item of candidates){
    const prior=deduped.get(item.channel.id);
    if(!prior||item.score>prior.score)deduped.set(item.channel.id,item);
  }
  return [...deduped.values()]
    .sort((a,b)=>b.score-a.score)
    .slice(0,30)
    .map(item=>item.channel);
}

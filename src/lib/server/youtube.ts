import 'server-only';

import type { Channel, Settings } from '@/lib/types';
import {
  REFERENCE_CHANNELS,
  REFERENCE_DISCOVERY_QUERIES,
  referenceForName,
  type ReferenceChannel
} from '@/lib/reference-catalog';
import { checked, db, list, put } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';
import { evaluateOpportunityCandidate } from '@/lib/opportunity-criteria';

type Item={
  id:string|{videoId?:string;channelId?:string};
  snippet:{
    channelId?:string;
    title:string;
    description:string;
    publishedAt:string;
    customUrl?:string;
    defaultLanguage?:string;
    defaultAudioLanguage?:string;
    categoryId?:string;
    thumbnails?:Record<string,{url:string}>;
    resourceId?:{videoId:string}
  };
  statistics?:{
    viewCount?:string;
    videoCount?:string;
    subscriberCount?:string;
    hiddenSubscriberCount?:boolean
  };
  contentDetails?:{duration?:string;relatedPlaylists?:{uploads:string}}
};

async function youtube(resource:string,params:Record<string,string>){
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
  const body=await response.json() as {items?:Item[]};
  return body.items??[];
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
    const found=await youtube('search',{
      part:'snippet',
      type:'video',
      q:query,
      order:'viewCount',
      publishedAfter,
      maxResults:'50',
      relevanceLanguage:'en'
    });
    for(const item of found){
      const id=idOf(item);
      if(!id)continue;
      videoIds.add(id);
      if(!sourceByVideo.has(id))sourceByVideo.set(id,query);
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
    const language=(video.snippet.defaultLanguage??video.snippet.defaultAudioLanguage??'').toLowerCase();
    return (!language||language.startsWith('en'))&&!!video.snippet.channelId&&!referenceIds.has(video.snippet.channelId);
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
      language:video.snippet.defaultLanguage??video.snippet.defaultAudioLanguage??'Inglês provável / confirmar',
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
        'Todos os filtros numéricos do radar são eliminatórios para candidatos de oportunidade.'
      ],
      discoverySource:'reference-adjacent',
      ...(old?.video.id===idOf(video)&&old.analysis?{analysis:old.analysis}:{})
    };
    const qualification=evaluateOpportunityCandidate(payload,config);
    if(!qualification.qualified)continue;
    payload.evidence.push(
      `PASS obrigatório: ${views.toLocaleString('en-US')} views em ${Math.max(1,Math.round(qualification.ageHours))}h; ${payload.videoCount} vídeos; canal com ${Math.max(1,Math.round(qualification.channelAgeDays))} dias.`
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

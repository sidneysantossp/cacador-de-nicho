import 'server-only';
import type { Channel, Settings } from '@/lib/types';
import { checked, db, list, put } from './db';
import { HttpError } from './auth';
import { providerSecret } from './providers';

type Item={
  id:string|{videoId:string};
  snippet:{
    channelId:string;
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
        ?'YouTube recusou a consulta: confira a chave, API habilitada e cota.'
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

const idOf=(item:Item)=>typeof item.id==='string'?item.id:item.id.videoId;

function inferNiche(video:Item){
  const text=`${video.snippet.title} ${video.snippet.description}`.toLowerCase();
  const groups:Array<[string,string[]]>= [
    ['Finanças & Economia',['finance','money','invest','stock','market','econom','bank','wealth','business']],
    ['Tecnologia & IA',['artificial intelligence',' ai ','technology','tech ','robot','software','computer','iphone','android']],
    ['Ciência & Espaço',['science','physics','chemistry','space','nasa','planet','universe','biology','quantum']],
    ['Saúde & Corpo',['health','doctor','medical','medicine','body','brain','nutrition','fitness','disease']],
    ['Psicologia & Comportamento',['psychology','behavior','habit','mental','motivation','relationship','social']],
    ['História & Sociedade',['history','ancient','empire','war','civilization','historical','society','culture']],
    ['Animais & Natureza',['animal','wildlife','nature','ocean','dog','cat','bird','reptile','insect']],
    ['Games',['game','gaming','minecraft','fortnite','roblox','playstation','xbox','nintendo']],
    ['Esportes',['sport','football','soccer','basketball','nba','nfl','tennis','f1','formula 1']],
    ['Viagem & Lugares',['travel','country','city','island','hotel','flight','tourism','destination']],
    ['Comida & Cozinha',['food','recipe','cooking','restaurant','chef','kitchen']],
    ['Educação & Explicadores',['explained','how it works','how does','why does','lesson','tutorial','documentary']]
  ];
  for(const [name,words] of groups)if(words.some(word=>text.includes(word)))return name;
  const category:Record<string,string>={
    '1':'Filmes & Animação','2':'Automóveis','10':'Música','15':'Animais & Natureza','17':'Esportes',
    '19':'Viagem & Lugares','20':'Games','22':'Pessoas & Blogs','23':'Comédia','24':'Entretenimento',
    '25':'Notícias & Sociedade','26':'How-to & Estilo','27':'Educação','28':'Ciência & Tecnologia','29':'ONGs & Ativismo'
  };
  return category[video.snippet.categoryId??'']??'Outros sinais';
}

function videoSignal(video:Item){
  const ageHours=Math.max(1,(Date.now()-Date.parse(video.snippet.publishedAt))/3600000);
  const views=Number(video.statistics?.viewCount??0);
  return views/Math.max(ageHours/24,1);
}

export async function scan(config:Settings){
  const prior=await list<Channel>('radar_channels',1000);
  const ids=new Set<string>();
  const candidateMap=new Map<string,Item>();

  // Broad discovery is independent of the configured seeds. These markets keep the
  // operation English-first without forcing a single niche.
  for(const region of ['US','GB','CA','AU']){
    const popular=await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      chart:'mostPopular',
      regionCode:region,
      maxResults:'50'
    });
    for(const item of popular)candidateMap.set(idOf(item),item);
  }

  // Seeds are focus hints, not gates. We intentionally avoid publishedAfter here:
  // the age/view/channel settings are signals used to rank evidence, never exclusion rules.
  for(const query of config.queries.map(q=>q.trim()).filter(Boolean)){
    const found=await youtube('search',{
      part:'snippet',
      type:'video',
      q:query,
      order:'viewCount',
      maxResults:'50',
      relevanceLanguage:'en'
    });
    for(const item of found)if(typeof item.id!=='string')ids.add(item.id.videoId);
  }

  // Keep watching a rotating sample of previously discovered channels, but this does
  // not constrain new discovery.
  const offset=prior.length?Math.floor(Date.now()/86400000)*20%prior.length:0;
  const tracked=[...prior.slice(offset),...prior.slice(0,offset)].slice(0,20);
  if(tracked.length){
    const cs=await youtube('channels',{part:'contentDetails',id:tracked.map(c=>c.id).join(',')});
    for(const c of cs){
      const uploads=c.contentDetails?.relatedPlaylists?.uploads;
      if(!uploads)continue;
      const videos=await youtube('playlistItems',{part:'snippet',playlistId:uploads,maxResults:'10'});
      for(const v of videos)if(v.snippet.resourceId)ids.add(v.snippet.resourceId.videoId);
    }
  }

  const idList=[...ids].filter(id=>!candidateMap.has(id));
  for(let i=0;i<idList.length;i+=50){
    const batch=await youtube('videos',{
      part:'snippet,statistics,contentDetails',
      id:idList.slice(i,i+50).join(',')
    });
    for(const item of batch)candidateMap.set(idOf(item),item);
  }

  const candidates=[...candidateMap.values()].filter(video=>{
    const language=(video.snippet.defaultLanguage??video.snippet.defaultAudioLanguage??'').toLowerCase();
    return !language||language.startsWith('en');
  });

  const channelIds=[...new Set(candidates.map(v=>v.snippet.channelId))];
  const channels:Item[]=[];
  for(let i=0;i<channelIds.length;i+=50){
    channels.push(...await youtube('channels',{
      part:'snippet,statistics',
      id:channelIds.slice(i,i+50).join(',')
    }));
  }

  const observedAt=new Date().toISOString();
  const prepared:Array<{score:number;id:string;payload:Channel}>=[];

  for(const c of channels){
    const channelVideos=candidates
      .filter(v=>v.snippet.channelId===c.id)
      .sort((a,b)=>videoSignal(b)-videoSignal(a));
    const video=channelVideos[0];
    if(!video)continue;

    const videoCount=Number(c.statistics?.videoCount??0);
    const ageDays=Math.max(0,(Date.parse(observedAt)-Date.parse(c.snippet.publishedAt))/86400000);
    const ageHours=Math.max(0,(Date.parse(observedAt)-Date.parse(video.snippet.publishedAt))/3600000);
    const views=Number(video.statistics?.viewCount??0);
    const subscribers=c.statistics?.hiddenSubscriberCount?null:Number(c.statistics?.subscriberCount??0);
    const old=prior.find(x=>x.id===c.id);
    const signals:string[]=[];

    if(views>=config.minViews)signals.push(`Sinal forte de alcance: ${views.toLocaleString('en-US')} visualizações públicas.`);
    if(ageHours<=config.maxVideoAgeHours)signals.push(`Sinal de recência: publicado há cerca de ${Math.max(1,Math.round(ageHours))}h.`);
    if(videoCount<=config.maxChannelVideos)signals.push(`Sinal de canal enxuto: ${videoCount} vídeos publicados.`);
    if(ageDays<=config.maxChannelAgeDays)signals.push(`Sinal de canal recente: criado há cerca de ${Math.max(1,Math.round(ageDays))} dias.`);
    if(subscribers&&views>subscribers)signals.push('Sinal de distribuição além da base atual de inscritos.');

    const id=c.id as string;
    const niche=inferNiche(video);
    const payload:Channel={
      id,
      name:c.snippet.title,
      handle:c.snippet.customUrl??'',
      niche,
      language:video.snippet.defaultLanguage??video.snippet.defaultAudioLanguage??'Não informado',
      format:'A confirmar',
      description:c.snippet.description.slice(0,2000),
      lens:signals[0]??'Referência capturada para comparação e investigação editorial.',
      thumbnail:thumb(video),
      avatar:thumb(c),
      url:`https://www.youtube.com/channel/${id}`,
      createdAt:c.snippet.publishedAt,
      firstSeenAt:old?.firstSeenAt??observedAt,
      observedAt,
      videoCount,
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
        `Visualizações públicas observadas em ${observedAt}.`,
        `Publicado em ${video.snippet.publishedAt}; esta é uma observação, não uma estimativa histórica.`,
        ...signals,
        'Os critérios configurados são sinais de prioridade, não filtros eliminatórios.',
        'Formato, RPM e retenção não são inferidos sem evidência apropriada.'
      ],
      ...(old?.video.id===idOf(video)&&old.analysis?{analysis:old.analysis}:{})
    };

    const reachPerDay=videoSignal(video);
    const breakout=subscribers&&subscribers>0?Math.min(5,views/subscribers):1;
    const score=Math.log10(reachPerDay+1)*10+Math.log10(views+1)*2+breakout;
    prepared.push({score,id,payload});
  }

  // Supabase returns newest updates first, so persist weaker signals first and the
  // strongest opportunity signals last. Nothing is discarded because of thresholds.
  prepared.sort((a,b)=>a.score-b.score);
  for(const item of prepared){
    await put('radar_channels',item.id,item.payload);
    checked(await db().from('radar_snapshots').insert({
      channel_id:item.id,
      video_id:item.payload.video.id,
      views:item.payload.video.views,
      observed_at:observedAt
    }));
  }

  return prepared.length;
}

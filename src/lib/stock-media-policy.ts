import type { StockMediaProvider, StockMediaResult } from '@/lib/types';
import { scoreVisualSegment } from '@/lib/media-library-policy';
import { classifyMediaTaxonomy } from '@/lib/media-taxonomy';

const hosts:Record<StockMediaProvider,string[]>={
  pexels:[
    'images.pexels.com','videos.pexels.com','static-videos.pexels.com',
    'player.vimeo.com','vod-progressive.akamaized.net'
  ],
  pixabay:['cdn.pixabay.com','pixabay.com'],
  unsplash:['images.unsplash.com','plus.unsplash.com','api.unsplash.com','unsplash.com'],
  vecteezy:['downloads.vecteezy.com','static.vecteezy.com','files.vecteezy.com','img.vecteezy.com'],
  wikimedia:['upload.wikimedia.org','commons.wikimedia.org']
};

export function stockDownloadHostAllowed(provider:StockMediaProvider,host:string){
  const lower=host.toLowerCase().replace(/\.$/,'');
  return hosts[provider].some(item=>lower===item||lower.endsWith('.'+item));
}

export function validStockQuery(query:string){
  const value=query.trim();
  return value.length>0&&value.length<=100;
}


export function stockFallbackEligible(value:string){
  const text=value.toLowerCase();
  const generatedStyle=/\b(?:hand[- ]drawn|doodle|illustration|illustrated|cartoon|anime|2d|3d render|3d animation|claymation|vector art)\b/.test(text);
  if(generatedStyle)return false;
  return /\b(?:stock|footage|documentary|real[- ]life|realistic|photoreal|photo|present[- ]day|current[- ]location|live action)\b/.test(text);
}

export const STOCK_DISCOVERY_POLICY_VERSION='filmable-v2';

const providerQueryStopWords=new Set([
  'a','an','and','are','as','at','be','been','being','but','by','can','does','for','from',
  'had','has','have','in','into','is','it','its','just','less','major','middle','of','on',
  'once','only','or','our','ran','that','the','their','them','these','this','those','through',
  'to','was','we','were','what','when','where','which','while','who','why','will','with',
  'years','something','dramatic','revealing','also','none','urban','infrastructure'
]);

function compactProviderKeywords(value:string,limit=16){
  const words=value.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g)??[];
  const seen=new Set<string>();
  const selected:string[]=[];
  for(const word of words){
    const key=word.toLowerCase();
    if(providerQueryStopWords.has(key)||seen.has(key))continue;
    seen.add(key);
    selected.push(word);
    if(selected.length>=limit)break;
  }
  return selected.join(' ');
}

export function stockDiscoveryQuery(value:string){
  const enrichedDirection=/\b(?:visibly\s+illustrate|visibly\s+support|documentary\s+evidence\s+for|visual\s+evidence\s+for|explain\s+the\s+spatial\s+relationship\s+in)\s*:/i.test(value);
  const editorialCore=value
    .replace(/^\s*(?:real\s+)?(?:landscape\s+)?documentary\s+(?:photo|image|video|footage)(?:\s+or\s+(?:photo|image|video|footage))?\s+of\s+/i,'')
    .replace(/^\s*authentic\s+(?:historical\s+archival\s+image|official\s+planning\s+document|planning\s+document|map|diagram)\s+(?:of|from)\s+/i,'')
    .replace(/^\s*factual\s+sourced\s+(?:map|planning\s+diagram)\s+of\s+/i,'')
    .replace(/\b(?:visibly\s+illustrate|visibly\s+support|documentary\s+evidence\s+for|visual\s+evidence\s+for|explain\s+the\s+spatial\s+relationship\s+in)\s*:\s*/gi,' ')
    .replace(/;\s*(?:prioritize|prefer|avoid|no\b|geographic\s+accuracy|required\b)[\s\S]*$/i,' ');

  const cleaned=editorialCore
    .replace(/\b(?:present[- ]day|current[- ]location|real[- ]life|realistic|photoreal(?:istic)?|documentary|stock|footage|live action|real|only|photo|photos|image|images)\b/gi,' ')
    .replace(/\b(?:wide[- ]angle|wide|medium|close[- ]up|aerial|street[- ]level)?\s*establishing shot\b/gi,' ')
    .replace(/\b(?:16\s*:\s*9|9\s*:\s*16)\b/g,' ')
    .replace(/[\/|—–]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:])/g,'$1')
    .replace(/\s*[,;:.]+\s*$/,'')
    .trim();

  const taxonomy=classifyMediaTaxonomy(cleaned);
  if(taxonomy.landmarks.length){
    return [taxonomy.landmarks[0],taxonomy.cities[0]].filter(Boolean).join(' ').slice(0,100);
  }
  if(taxonomy.districts.length&&taxonomy.cities.length){
    return [taxonomy.districts[0],taxonomy.cities[0]].filter(Boolean).join(' ').slice(0,100);
  }
  if(enrichedDirection){
    return compactProviderKeywords(cleaned).slice(0,100);
  }
  return cleaned.slice(0,100);
}

export function rankStockMediaResults(input:{
  query:string;
  results:StockMediaResult[];
  desiredDurationSeconds:number;
  orientation:'landscape'|'portrait'|'any';
}){
  const desired=Math.max(.25,input.desiredDurationSeconds);
  const taxonomy=classifyMediaTaxonomy(input.query);
  const exactLocationQuery=taxonomy.landmarks.length>0||taxonomy.districts.length>0;
  return input.results.map((result,index)=>{
    const searchText=[
      result.title,
      result.pageUrl.replace(/[-_/]+/g,' '),
      result.creatorName,
      result.kind
    ].filter(Boolean).join(' ');
    const metadataRelevance=scoreVisualSegment(input.query,searchText);
    const providerRankRelevance=exactLocationQuery
      ?Math.max(0,1-index/Math.max(1,input.results.length))*.55
      :0;
    const relevance=Math.max(metadataRelevance,providerRankRelevance);
    const orientationFit=input.orientation==='any'||!result.width||!result.height
      ?1
      :input.orientation==='landscape'
        ?result.width>=result.height?1:0
        :result.height>result.width?1:0;
    const durationFit=result.kind==='video'&&result.durationSeconds
      ?Math.min(1,result.durationSeconds/desired)
      :result.kind==='video'?.5:1;
    const score=Math.min(1,relevance*.78+orientationFit*.14+durationFit*.08);
    return {
      result,relevance,metadataRelevance,providerRankRelevance,
      orientationFit,durationFit,score
    };
  }).filter(item=>item.orientationFit>0)
    .sort((a,b)=>b.score-a.score);
}

export function verifiedStockSearchRelevance(
  metadataRelevance:number,
  providerIndex:number
){
  const providerSignal=Math.max(.45,.50-Math.max(0,providerIndex)*.025);
  return Math.max(0,Math.min(1,Math.max(metadataRelevance,providerSignal)));
}

export function verifiedStockGapNeedsTransientRecovery(result:unknown){
  const serialized=JSON.stringify(result??{}).toLowerCase();
  if(
    serialized.includes('visual-index-fallback')||
    serialized.includes('pre-render-fallback')
  )return false;
  return (
    serialized.includes('quota')||
    serialized.includes('rate limit')||
    serialized.includes('too many requests')||
    serialized.includes('timed out')||
    serialized.includes('timeout')||
    serialized.includes('http 429')||
    serialized.includes('http 500')||
    serialized.includes('http 502')||
    serialized.includes('http 503')||
    serialized.includes('http 504')
  );
}

export function stockVisualAnalysisFallbackAllowed(input:{
  status:number;
  message?:string;
}){
  const status=Math.max(0,Math.round(input.status||0));
  const message=String(input.message??'');
  return (
    status===429||status===500||status===502||status===503||status===504||
    /\b(?:timeout|timed out|temporar|unavailable|rate limit|quota|too many requests)\b/i.test(message)
  );
}

export function deterministicStockFallbackTrim(input:{
  durationSeconds:number|null|undefined;
  desiredDurationSeconds:number;
  seed:number;
}){
  const duration=Number(input.durationSeconds);
  if(!Number.isFinite(duration)||duration<.25)return null;
  const span=Math.min(duration,Math.max(.25,Number(input.desiredDurationSeconds)||.25));
  const maxStart=Math.max(0,duration-span);
  const normalizedSeed=Math.abs(Math.floor(Number(input.seed)||0));
  const fraction=(normalizedSeed*.6180339887498949)%1;
  const start=maxStart<.05?0:maxStart*fraction;
  return {
    sourceStartSeconds:Number(start.toFixed(3)),
    sourceEndSeconds:Number(Math.min(duration,start+span).toFixed(3))
  };
}

export function stockCandidateAccepted(input:{
  searchScore:number;
  visualRelevance:number;
  combinedScore:number;
}){
  return Number.isFinite(input.searchScore)&&
    Number.isFinite(input.visualRelevance)&&
    Number.isFinite(input.combinedScore)&&
    input.searchScore>=.45&&
    input.visualRelevance>=.18&&
    input.combinedScore>=.38;
}


function normalizedWords(value:string){
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,' ');
}

export function stockVisualValidationQuery(value:string){
  return value
    .replace(/\b(?:present[- ]day|current[- ]location|real[- ]life|realistic|photoreal(?:istic)?|documentary|stock|footage|live action|real|only)\b/gi,' ')
    .replace(/\b(?:16\s*:\s*9|9\s*:\s*16)\b/g,' ')
    .replace(/[\/|]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:])/g,'$1')
    .replace(/\s*[,;:.]+\s*$/,'')
    .trim()
    .slice(0,240);
}

export function stockVisualConstraintsSatisfied(input:{
  query:string;
  timeOfDay?:string[]|null;
}){
  const text=normalizedWords(input.query);
  let expectedLabel:string|null=null;
  let accepted:string[]=[];
  if(/\bnight(?:time)?\b/.test(text)){
    expectedLabel='night';
    accepted=['night','nighttime'];
  }else if(/\b(?:sunset|golden hour)\b/.test(text)){
    expectedLabel='sunset';
    accepted=['sunset','golden hour'];
  }else if(/\b(?:sunrise|dawn)\b/.test(text)){
    expectedLabel='sunrise';
    accepted=['sunrise','dawn'];
  }else if(/\b(?:dusk|twilight|evening)\b/.test(text)){
    expectedLabel='evening';
    accepted=['dusk','twilight','evening'];
  }else if(/\b(?:daytime|daylight)\b/.test(text)){
    expectedLabel='daytime';
    accepted=['day','daytime','morning','afternoon'];
  }

  const observed=[...new Set((input.timeOfDay??[])
    .map(item=>normalizedWords(String(item)).trim())
    .filter(Boolean))];

  if(!expectedLabel){
    return {ok:true,expected:null,observed,reason:null};
  }
  const ok=observed.some(item=>accepted.includes(item));
  return {
    ok,
    expected:expectedLabel,
    observed,
    reason:ok?null:'expected '+expectedLabel+' but observed '+(observed.join(', ')||'unknown time of day')
  };
}

function filmableStockDiscoveryVariants(value:string){
  const text=normalizedWords(value);
  const variants:string[]=[];

  if(
    /\b(?:pedestrian|pedestrians|people|crowd)\b/.test(text)&&
    /\b(?:pathfind\w*|route\w*|navigat\w*|traffic|speed)\b/.test(text)
  ){
    variants.push(
      'pedestrians crossing busy city intersection',
      'people walking city crosswalk traffic',
      'crowd navigating urban sidewalk'
    );
  }

  if(
    /\b(?:traffic|congestion)\b/.test(text)&&
    /\b(?:route\w*|speed|flow|adapt\w*)\b/.test(text)
  ){
    variants.push(
      'busy city intersection traffic pedestrians',
      'urban traffic moving through intersection'
    );
  }

  if(
    /\b(?:pathfind\w*|navigat\w*|route\w*)\b/.test(text)&&
    !variants.length
  ){
    variants.push(
      'people navigating city streets',
      'pedestrians walking urban street'
    );
  }

  return [...new Set(variants.map(item=>item.slice(0,100)))];
}

export function stockDiscoveryQueries(value:string){
  const primary=stockDiscoveryQuery(value);
  const taxonomy=classifyMediaTaxonomy(value);
  const city=taxonomy.cities[0]??'';
  const primaryWords=primary.split(/\s+/).filter(Boolean);
  const cityWords=new Set(city.toLowerCase().split(/\s+/).filter(Boolean));
  const mechanismWords=new Set([
    'highway','freeway','traffic','tunnel','road','roads','street','streets','transit','rail',
    'railway','subway','bridge','bridges','water','stormwater','flood','flooding','plaza',
    'drainage','sewer','planning','density','housing','construction','downtown','land',
    'underground','elevated','infrastructure','skyline','transport','transportation'
  ]);
  const mechanisms=primaryWords.filter(word=>
    mechanismWords.has(word.toLowerCase())
  );
  const nonCity=primaryWords.filter(word=>!cityWords.has(word.toLowerCase()));
  const variants=[
    primary,
    ...filmableStockDiscoveryVariants(value),
    city&&mechanisms.length
      ?[city,...mechanisms.slice(0,4)].join(' ')
      :'',
    city&&nonCity.length
      ?[city,...nonCity.slice(-4)].join(' ')
      :'',
    city?city+' city infrastructure':''
  ].map(item=>item.trim().slice(0,100)).filter(Boolean);
  return [...new Set(variants)];
}
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

export function stockDiscoveryQuery(value:string){
  const cleaned=value
    .replace(/\b(?:present[- ]day|current[- ]location|real[- ]life|realistic|photoreal(?:istic)?|documentary|stock|footage|live action|real|only)\b/gi,' ')
    .replace(/\b(?:wide[- ]angle|wide|medium|close[- ]up|aerial|street[- ]level)?\s*establishing shot\b/gi,' ')
    .replace(/\b(?:16\s*:\s*9|9\s*:\s*16)\b/g,' ')
    .replace(/[\/|]+/g,' ')
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

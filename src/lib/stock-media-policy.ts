import type { StockMediaProvider, StockMediaResult } from '@/lib/types';
import { scoreVisualSegment } from '@/lib/media-library-policy';

const hosts:Record<StockMediaProvider,string[]>={
  pexels:[
    'images.pexels.com','videos.pexels.com','static-videos.pexels.com',
    'player.vimeo.com','vod-progressive.akamaized.net'
  ],
  pixabay:['cdn.pixabay.com','pixabay.com'],
  unsplash:['images.unsplash.com','plus.unsplash.com','api.unsplash.com','unsplash.com'],
  vecteezy:['downloads.vecteezy.com','static.vecteezy.com','files.vecteezy.com','img.vecteezy.com']
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
  return value
    .replace(/\b(?:present[- ]day|current[- ]location|real[- ]life|realistic|photoreal(?:istic)?|documentary|stock|footage|live action|real|only)\b/gi,' ')
    .replace(/\b(?:wide[- ]angle|wide|medium|close[- ]up|aerial|street[- ]level)?\s*establishing shot\b/gi,' ')
    .replace(/\b(?:16\s*:\s*9|9\s*:\s*16)\b/g,' ')
    .replace(/[\/|]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/\s+([,.;:])/g,'$1')
    .replace(/\s*[,;:.]+\s*$/,'')
    .trim()
    .slice(0,100);
}

export function rankStockMediaResults(input:{
  query:string;
  results:StockMediaResult[];
  desiredDurationSeconds:number;
  orientation:'landscape'|'portrait'|'any';
}){
  const desired=Math.max(.25,input.desiredDurationSeconds);
  return input.results.map(result=>{
    const searchText=[
      result.title,
      result.pageUrl.replace(/[-_/]+/g,' '),
      result.creatorName,
      result.kind
    ].filter(Boolean).join(' ');
    const relevance=scoreVisualSegment(input.query,searchText);
    const orientationFit=input.orientation==='any'||!result.width||!result.height
      ?1
      :input.orientation==='landscape'
        ?result.width>=result.height?1:0
        :result.height>result.width?1:0;
    const durationFit=result.kind==='video'&&result.durationSeconds
      ?Math.min(1,result.durationSeconds/desired)
      :result.kind==='video'?.5:1;
    const score=Math.min(1,relevance*.78+orientationFit*.14+durationFit*.08);
    return {result,relevance,orientationFit,durationFit,score};
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

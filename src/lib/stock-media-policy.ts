import type { StockMediaProvider } from '@/lib/types';

const hosts:Record<StockMediaProvider,string[]>={
  pexels:[
    'images.pexels.com','videos.pexels.com','static-videos.pexels.com',
    'player.vimeo.com','vod-progressive.akamaized.net'
  ],
  pixabay:['cdn.pixabay.com','pixabay.com'],
  unsplash:['images.unsplash.com','plus.unsplash.com','api.unsplash.com','unsplash.com']
};

export function stockDownloadHostAllowed(provider:StockMediaProvider,host:string){
  const lower=host.toLowerCase().replace(/\.$/,'');
  return hosts[provider].some(item=>lower===item||lower.endsWith('.'+item));
}

export function validStockQuery(query:string){
  const value=query.trim();
  return value.length>0&&value.length<=100;
}

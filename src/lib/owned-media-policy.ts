export type OwnedMediaSemantic={
  subjects:string[];
  locations:string[];
  periods:string[];
  shotTypes:string[];
  moods:string[];
};

const STOP=new Set([
  'a','an','and','at','by','for','from','in','into','of','on','or','the','to','with',
  'de','da','das','do','dos','e','em','na','nas','no','nos','para','por','com',
  'utc','video','footage','clip','stock'
]);

function cleanBaseName(fileName:string){
  return fileName
    .replace(/\.[a-z0-9]{2,5}$/i,'')
    .replace(/\s*\(\d+\)\s*$/,'')
    .replace(/[-_ ]?20\d{2}[-_ ]\d{2}[-_ ]\d{2}[-_ ]\d{2}[-_ ]\d{2}(?:[-_ ]\d{2})?[-_ ]?utc$/i,'')
    .replace(/[-_]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function words(value:string){
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

function unique(values:string[],limit=40){
  return [...new Set(values.map(value=>value.trim().toLowerCase()).filter(Boolean))].slice(0,limit);
}

function titleCase(value:string){
  return value.replace(/\b\w/g,char=>char.toUpperCase());
}

function markerLocations(tokens:string[]){
  const result:string[]=[];
  for(let i=0;i<tokens.length;i++){
    if(tokens[i]!=='at'&&tokens[i]!=='in'&&tokens[i]!=='near')continue;
    const out:string[]=[];
    for(let j=i+1;j<tokens.length&&out.length<5;j++){
      if(['at','in','near','with','on','by'].includes(tokens[j]))break;
      if(!STOP.has(tokens[j]))out.push(tokens[j]);
    }
    if(out.length)result.push(out.join(' '));
  }
  return unique(result,12);
}

export function ownedMediaKind(mimeType:string){
  if(['video/mp4','video/webm','video/quicktime'].includes(mimeType))return 'video' as const;
  if(['image/jpeg','image/png','image/webp'].includes(mimeType))return 'image' as const;
  return null;
}

export function parseOwnedMediaFilename(fileName:string){
  const base=cleanBaseName(fileName);
  const raw=words(base);
  const meaningful=raw.filter(token=>token.length>1&&!STOP.has(token)&&!/^20\d{2}$/.test(token));
  const bigrams:string[]=[];
  for(let i=0;i<raw.length-1;i++){
    if(STOP.has(raw[i])||STOP.has(raw[i+1]))continue;
    if(raw[i].length<2||raw[i+1].length<2)continue;
    bigrams.push(raw[i]+' '+raw[i+1]);
  }
  const tags=unique([...bigrams,...meaningful],32);
  const locations=markerLocations(raw);
  const shotTypes=unique([
    raw.includes('aerial')?'aerial':'',
    raw.includes('drone')?'drone':'',
    raw.includes('pov')?'pov':'',
    raw.includes('wide')?'wide':'',
    raw.includes('closeup')||raw.includes('close')?'close-up':'',
    raw.includes('street')?'street-level':''
  ]);
  const periods=unique([
    ...raw.filter(token=>/^(19|20)\d{2}$/.test(token)),
    raw.includes('night')?'night':'',
    raw.includes('sunset')?'sunset':'',
    raw.includes('sunrise')?'sunrise':'',
    raw.includes('day')?'day':''
  ]);
  return {
    title:titleCase(base||fileName),
    tags,
    semantic:{
      subjects:unique(meaningful.slice(0,12)),
      locations,
      periods,
      shotTypes,
      moods:[]
    } satisfies OwnedMediaSemantic
  };
}

export function ownedMediaSearchText(input:{
  title:string;originalName:string;tags:string[];semantic:OwnedMediaSemantic;
}){
  return [
    input.title,input.originalName,...input.tags,
    ...input.semantic.subjects,...input.semantic.locations,...input.semantic.periods,
    ...input.semantic.shotTypes,...input.semantic.moods
  ].join(' ').toLowerCase();
}

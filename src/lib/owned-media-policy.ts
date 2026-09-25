import { classifyMediaTaxonomy } from './media-taxonomy';
import type { MediaTaxonomySemantic } from './media-taxonomy';

export type OwnedMediaSemantic=MediaTaxonomySemantic;

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
  const taxonomy=classifyMediaTaxonomy(base);
  const tags=unique([
    ...bigrams,...meaningful,
    ...taxonomy.countries,...taxonomy.regions,...taxonomy.cities,...taxonomy.districts,
    ...taxonomy.landmarks,...taxonomy.scenes,...taxonomy.timeOfDay,...taxonomy.shotTypes
  ],50);
  const locations=unique([...markerLocations(raw),...taxonomy.locations],30);
  const years=raw.filter(token=>/^(19|20)\d{2}$/.test(token));
  return {
    title:titleCase(base||fileName),
    tags,
    semantic:{
      ...taxonomy,
      subjects:unique([...meaningful.slice(0,12),...taxonomy.scenes,...taxonomy.objects],24),
      locations,
      periods:unique([...years,...taxonomy.periods],20)
    } satisfies OwnedMediaSemantic
  };
}

export function ownedMediaSearchText(input:{
  title:string;originalName:string;tags:string[];semantic:OwnedMediaSemantic;
}){
  return [
    input.title,input.originalName,...input.tags,
    ...input.semantic.subjects,...input.semantic.locations,...input.semantic.periods,
    ...input.semantic.countries,...input.semantic.regions,...input.semantic.cities,
    ...input.semantic.districts,...input.semantic.landmarks,...input.semantic.scenes,
    ...input.semantic.objects,...input.semantic.activities,...input.semantic.people,
    ...input.semantic.timeOfDay,...input.semantic.weather,...input.semantic.seasons,
    ...input.semantic.shotTypes,...input.semantic.cameraMotion,...input.semantic.moods
  ].join(' ').toLowerCase();
}

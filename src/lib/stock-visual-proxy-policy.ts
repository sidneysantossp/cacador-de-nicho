function normalized(value:string){
  return value.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,' ')
    .replace(/[^a-z0-9' -]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const blockedMediaClass=/\b(?:map|document|archive|diagram|blueprint|schematic)\b/;

const concreteWords=new Set([
  'people','person','pedestrian','pedestrians','commuter','commuters','civilian','civilians','crowd',
  'walking','walk','interacting','talking','moving','running','crossing','standing',
  'street','streets','sidewalk','sidewalks','city','urban','traffic','intersection','crosswalk',
  'downtown','overhead','modern','daily','routines','routine','activity','location','neighborhood',
  'danger','emergency','office','computer','computers','programmer','programmers','developer','developers',
  'software','planning','team'
]);

function concreteDirection(direction:string){
  const text=normalized(direction);
  if(!text||blockedMediaClass.test(text))return '';
  const tokens=text.split(/\s+/).filter(token=>concreteWords.has(token));
  const unique=tokens.filter((token,index)=>tokens.indexOf(token)===index);
  return unique.length>=2?unique.slice(0,8).join(' '):'';
}

function abstractFallback(canonical:string){
  const text=normalized(canonical);

  if(
    /\b(?:civilian|person|people|pedestrian|pedestrians)\b/.test(text)&&
    /\b(?:danger|emergency|away|flee\w*|run\w*)\b/.test(text)
  )return 'person moving away from danger city street';

  if(
    /\b(?:source code|technical architecture|design goals|developer|development|programmer|software)\b/.test(text)
  )return 'software developer working at computer office';

  if(/\b(?:npc|npcs|pedestrian|pedestrians|civilian|civilians)\b/.test(text)){
    return 'pedestrians walking interacting urban sidewalks';
  }

  if(/\b(?:city|simulation|rumor|conclusion|question|repeated|system|limitations|playable|test)\b/.test(text)){
    return 'people walking busy modern city street';
  }

  return canonical.trim().replace(/\s+/g,' ').slice(0,100);
}

export function stockVisualProxyQuery(input:{
  canonical:string;
  direction?:string|null;
}){
  const canonical=input.canonical.trim().replace(/\s+/g,' ').slice(0,100);
  const directionText=normalized(String(input.direction??''));
  if(blockedMediaClass.test(directionText)){
    const canonicalText=normalized(canonical);
    if(/\b(?:pathfind\w*|navigat\w*|route\w*|traffic|speed)\b/.test(canonicalText)){
      return canonical;
    }
    return abstractFallback(canonical);
  }
  const fromDirection=concreteDirection(directionText);
  return fromDirection||abstractFallback(canonical);
}

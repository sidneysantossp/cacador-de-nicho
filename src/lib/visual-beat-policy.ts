import type { TranscriptSegment, VisualBeat } from './types';

const STOPWORDS=new Set([
  'a','an','and','are','as','at','be','been','being','but','by','for','from','had','has','have',
  'he','her','his','i','in','into','is','it','its','of','on','or','our','she','that','the','their',
  'them','there','these','they','this','those','to','was','we','were','what','when','where','which',
  'while','who','why','will','with','you','your'
]);

function compact(value:string){return value.replace(/\s+/g,' ').trim();}

function unique<T>(values:T[]){return [...new Set(values)];}

function keywords(text:string,limit=12){
  const words=(text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g)??[])
    .filter(word=>word.length>2&&!STOPWORDS.has(word));
  return unique(words).slice(0,limit);
}

function namedEntities(text:string){
  const matches=text.match(/\b(?:[A-Z][a-z]+(?:\s+(?:and|of|the|de|da|do|dos|das)?\s*[A-Z][a-z]+){0,4})\b/g)??[];
  const rejected=new Set(['The','This','That','There','Their','When','Where','Why','What','In','At','On','But','And']);
  return unique(matches.map(compact).filter(value=>value.length>2&&!rejected.has(value))).slice(0,12);
}

function dates(text:string){
  return unique(text.match(/\b(?:18|19|20)\d{2}\b/g)??[]).slice(0,8);
}

function numbers(text:string){
  return unique(text.match(/(?:[$£€]\s?\d[\d,.]*|\b\d+(?:\.\d+)?%|\b\d{2,}\b)/g)??[]).slice(0,8);
}

export function classifyVisualBeat(text:string):Pick<VisualBeat,'type'|'sourcePreference'>{
  const value=text.toLowerCase();
  const historical=/\b(?:war|battle|railway|railroad|locomotive|tunnel|century|historic|historical|civil war|world war|19th|18th|192\d|193\d|194\d|195\d)\b/.test(value)
    || /\b(?:18|19)\d{2}\b/.test(value);
  const document=/\b(?:newspaper|record|records|document|report|letter|photograph|photo|archive|archives|blueprint|plan|diagram)\b/.test(value);
  const map=/\b(?:route|map|border|river|port|harbor|harbour|coast|miles|kilometers|km|rail line|railroad line|from .{0,40} to )\b/.test(value);
  const motion=/\b(?:walking|running|driving|traffic|train|trains|moving|commuting|flying|construction|digging|collapse|explosion|rising|falling)\b/.test(value);
  const atmosphere=/\b(?:sunset|night|morning|crowd|quiet|empty|busy|atmosphere|skyline|street|streets)\b/.test(value);

  if(document)return {type:'document',sourcePreference:'document'};
  if(map)return {type:'map',sourcePreference:'map'};
  if(historical)return {type:'archive',sourcePreference:'archive-image'};
  if(atmosphere)return {type:'atmosphere',sourcePreference:motion?'stock-video':'stock-image'};
  if(motion)return {type:'literal',sourcePreference:'stock-video'};
  return {type:'literal',sourcePreference:'stock-image'};
}

export function buildVisualBeat(input:{
  segment:TranscriptSegment;
  sequence:number;
}):VisualBeat{
  const narration=compact(input.segment.text);
  const classification=classifyVisualBeat(narration);
  const entityValues=namedEntities(narration);
  const yearValues=dates(narration);
  const numberValues=numbers(narration);
  const key=keywords(narration);

  const queryBase=key.join(' ');
  const contextual=classification.type==='archive'
    ?'historical photograph '+queryBase
    :classification.type==='map'
      ?'map '+queryBase
      :classification.type==='document'
        ?'archive document '+queryBase
        :queryBase;

  return {
    id:crypto.randomUUID(),
    sequence:input.sequence,
    startSeconds:input.segment.startSeconds,
    endSeconds:Number(input.segment.endSeconds??input.segment.startSeconds),
    durationSeconds:Math.max(0,Number(input.segment.endSeconds??input.segment.startSeconds)-input.segment.startSeconds),
    narration,
    transcriptSegmentIds:[input.segment.id],
    transcriptWordIds:[...input.segment.wordIds],
    type:classification.type,
    sourcePreference:classification.sourcePreference,
    entities:[
      ...entityValues.map(value=>({kind:'unknown' as const,value})),
      ...yearValues.map(value=>({kind:'date' as const,value})),
      ...numberValues.filter(value=>!yearValues.includes(value)).map(value=>({kind:'number' as const,value}))
    ],
    queries:unique([
      narration,
      contextual,
      classification.type==='archive'&&entityValues.length
        ?entityValues.join(' ')+' historical archive'
        :''
    ].map(compact).filter(Boolean)).slice(0,4),
    confidence:'heuristic'
  };
}

export function buildVisualBeats(segments:TranscriptSegment[]){
  return [...segments]
    .filter(segment=>segment.endSeconds!==null&&segment.endSeconds>segment.startSeconds&&segment.text.trim())
    .sort((a,b)=>a.startSeconds-b.startSeconds)
    .map((segment,index)=>buildVisualBeat({segment,sequence:index+1}));
}

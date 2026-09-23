import type { TranscriptPayload, TranscriptSegment, TranscriptWord, VoiceAlignment } from '@/lib/types';

function id(){return crypto.randomUUID();}

export function parseTranscriptTimestamp(value:string){
  const clean=value.trim().replace(',', '.');
  const parts=clean.split(':');
  if(parts.length<2||parts.length>3)return null;
  const nums=parts.map(Number);
  if(nums.some(value=>!Number.isFinite(value)||value<0))return null;
  const seconds=parts.length===3
    ? nums[0]*3600+nums[1]*60+nums[2]
    : nums[0]*60+nums[1];
  return Number.isFinite(seconds)?seconds:null;
}

export function formatTranscriptTimestamp(seconds:number,separator=':'){
  const safe=Math.max(0,seconds);
  const h=Math.floor(safe/3600);
  const m=Math.floor((safe%3600)/60);
  const s=safe%60;
  const sec=s.toFixed(3).padStart(6,'0');
  return h>0
    ? [String(h).padStart(2,'0'),String(m).padStart(2,'0'),sec].join(separator)
    : [String(m).padStart(2,'0'),sec].join(separator);
}

function joinTokens(tokens:string[]){
  return tokens.reduce((out,token,index)=>{
    if(!index)return token;
    return /^(?:[.,!?;:%)\]\}]+)$/.test(token)?out+token:out+' '+token;
  },'');
}

export function buildSegmentsFromWords(words:TranscriptWord[]){
  const spoken=words.filter(word=>word.type==='word'&&Number.isFinite(word.startSeconds)&&Number.isFinite(word.endSeconds));
  const segments:TranscriptSegment[]=[];
  let current:TranscriptWord[]=[];

  function flush(){
    if(!current.length)return;
    segments.push({
      id:id(),
      startSeconds:current[0].startSeconds,
      endSeconds:current.at(-1)!.endSeconds,
      text:joinTokens(current.map(word=>word.text)).trim(),
      wordIds:current.map(word=>word.id)
    });
    current=[];
  }

  for(const word of spoken){
    current.push(word);
    const elapsed=word.endSeconds-current[0].startSeconds;
    const sentenceEnd=/[.!?][”"'’)]?$/.test(word.text);
    if((sentenceEnd&&elapsed>=1.2)||elapsed>=8||current.length>=20)flush();
  }
  flush();
  return segments;
}

export function transcriptFromAlignment(alignment:VoiceAlignment){
  const chars=alignment.characters;
  const starts=alignment.characterStartTimesSeconds;
  const ends=alignment.characterEndTimesSeconds;
  if(chars.length!==starts.length||chars.length!==ends.length)throw new Error('Alignment inválido.');

  const words:TranscriptWord[]=[];
  let token='';
  let start:number|null=null;
  let end:number|null=null;

  function flush(){
    if(!token.trim()||start===null||end===null){token='';start=null;end=null;return;}
    words.push({id:id(),text:token,startSeconds:start,endSeconds:end,type:'word'});
    token='';start=null;end=null;
  }

  for(let i=0;i<chars.length;i++){
    const char=chars[i];
    if(/\s/.test(char)){
      flush();
      continue;
    }
    if(start===null)start=Number(starts[i]);
    end=Number(ends[i]);
    token+=char;
  }
  flush();

  const segments=buildSegmentsFromWords(words);
  return {
    text:chars.join('').replace(/\s+/g,' ').trim(),
    words,
    segments
  };
}

export function parseSrtOrVtt(input:string){
  const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();
  const blocks=normalized.split(/\n{2,}/);
  const segments:TranscriptSegment[]=[];

  for(const raw of blocks){
    const lines=raw.split('\n').map(line=>line.trimEnd());
    if(!lines.length||lines[0].trim()==='WEBVTT'||lines[0].trim().startsWith('NOTE'))continue;
    const timeIndex=lines.findIndex(line=>line.includes('-->'));
    if(timeIndex<0)continue;
    const [left,rightRaw]=lines[timeIndex].split('-->');
    const right=(rightRaw??'').trim().split(/\s+/)[0];
    const start=parseTranscriptTimestamp(left.trim());
    const end=parseTranscriptTimestamp(right);
    if(start===null||end===null||end<=start)continue;
    const text=lines.slice(timeIndex+1).join(' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if(!text)continue;
    segments.push({id:id(),startSeconds:start,endSeconds:end,text,wordIds:[]});
  }

  return {text:segments.map(item=>item.text).join(' ').trim(),words:[] as TranscriptWord[],segments};
}

export function parseTimestampedText(input:string,audioDuration:number|null=null){
  const rows=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  const pending:Array<{start:number;text:string}>=[];
  const pattern=/^\s*(?:#|\[)?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\])?\s*(?:[-–—]\s*)?(.*)$/;

  for(const raw of rows){
    const match=raw.match(pattern);
    if(!match)continue;
    const start=parseTranscriptTimestamp(match[1]);
    const text=match[2].trim().replace(/^[:\-]\s*/,'');
    if(start===null||!text)continue;
    pending.push({start,text});
  }

  const segments=pending.map((item,index):TranscriptSegment=>({
    id:id(),
    startSeconds:item.start,
    endSeconds:index<pending.length-1?pending[index+1].start:audioDuration,
    text:item.text,
    wordIds:[]
  }));
  return {text:segments.map(item=>item.text).join(' ').trim(),words:[] as TranscriptWord[],segments};
}

function numberOrNull(value:unknown){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
}

export function parseTranscriptJson(input:string,audioDuration:number|null=null){
  const root=JSON.parse(input) as unknown;
  const object=(root&&typeof root==='object'&&!Array.isArray(root)?root:{segments:root}) as Record<string,unknown>;

  const rawWords=Array.isArray(object.words)?object.words:[];
  const words:TranscriptWord[]=rawWords.flatMap(item=>{
    if(!item||typeof item!=='object')return [];
    const row=item as Record<string,unknown>;
    const start=numberOrNull(row.start??row.start_seconds??row.startSeconds);
    const end=numberOrNull(row.end??row.end_seconds??row.endSeconds);
    const text=String(row.text??row.word??'').trim();
    const rawType=String(row.type??'word');
    if(start===null||end===null||end<=start||!text||rawType==='spacing')return [];
    return [{
      id:id(),
      text,
      startSeconds:start,
      endSeconds:end,
      type:rawType==='audio_event'?'audio_event' as const:'word' as const,
      speakerId:row.speaker_id?String(row.speaker_id):row.speakerId?String(row.speakerId):undefined,
      confidence:typeof row.logprob==='number'?row.logprob:typeof row.confidence==='number'?row.confidence:undefined
    }];
  });

  const rawSegments=Array.isArray(object.segments)?object.segments:Array.isArray(root)?root:[];
  let segments:TranscriptSegment[]=rawSegments.flatMap(item=>{
    if(!item||typeof item!=='object')return [];
    const row=item as Record<string,unknown>;
    const start=numberOrNull(row.start??row.start_seconds??row.startSeconds);
    const end=numberOrNull(row.end??row.end_seconds??row.endSeconds);
    const text=String(row.text??row.content??'').trim();
    if(start===null||!text)return [];
    return [{id:id(),startSeconds:start,endSeconds:end,text,wordIds:[]}];
  });

  if(!segments.length&&words.length)segments=buildSegmentsFromWords(words);
  if(segments.length&&segments.at(-1)?.endSeconds===null&&audioDuration!==null){
    segments[segments.length-1]={...segments[segments.length-1],endSeconds:audioDuration};
  }

  const text=String(object.text??'').trim()||segments.map(item=>item.text).join(' ').trim()||joinTokens(words.filter(item=>item.type==='word').map(item=>item.text)).trim();
  return {text,words,segments,languageCode:object.language_code?String(object.language_code):object.languageCode?String(object.languageCode):undefined};
}

function tokens(value:string){
  return (value.toLowerCase().match(/[\p{L}\p{N}']+/gu)??[]).filter(Boolean);
}

function bigramCounts(items:string[]){
  const map=new Map<string,number>();
  if(items.length===1){map.set(items[0],1);return map;}
  for(let i=0;i<items.length-1;i++){
    const key=items[i]+'\u0000'+items[i+1];
    map.set(key,(map.get(key)??0)+1);
  }
  return map;
}

export function scriptTranscriptMatchScore(script:string,transcript:string){
  const a=tokens(script),b=tokens(transcript);
  if(!a.length||!b.length)return null;
  const aa=bigramCounts(a),bb=bigramCounts(b);
  let totalA=0,totalB=0,intersection=0;
  for(const count of aa.values())totalA+=count;
  for(const count of bb.values())totalB+=count;
  for(const [key,count] of aa)intersection+=Math.min(count,bb.get(key)??0);
  if(totalA+totalB===0)return a.join(' ')===b.join(' ')?1:0;
  return Math.round((2*intersection/(totalA+totalB))*1000)/1000;
}

export function normalizeTranscriptPayload(payload:TranscriptPayload,scriptText:string){
  const segments=[...payload.segments]
    .map(item=>({...item,text:item.text.trim()}))
    .filter(item=>item.text)
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  const text=segments.map(item=>item.text).join(' ').replace(/\s+/g,' ').trim()||payload.text.trim();
  return {...payload,segments,text,scriptMatchScore:scriptTranscriptMatchScore(scriptText,text),updatedAt:new Date().toISOString()};
}

export function transcriptApprovalIssues(payload:TranscriptPayload,currentScriptVersion:number){
  const issues:string[]=[];
  if(!payload.text.trim())issues.push('empty-transcript');
  if(!payload.segments.length)issues.push('no-timed-segments');
  if(payload.scriptVersion!==currentScriptVersion)issues.push('stale-script-version');

  let previousStart=-1;
  for(const segment of payload.segments){
    if(!Number.isFinite(segment.startSeconds)||segment.startSeconds<0)issues.push('invalid-segment-start');
    if(segment.endSeconds===null||!Number.isFinite(segment.endSeconds)||segment.endSeconds<=segment.startSeconds)issues.push('invalid-segment-end');
    if(segment.startSeconds<previousStart)issues.push('segments-out-of-order');
    previousStart=segment.startSeconds;
  }

  if(payload.scriptMatchScore!==null&&payload.scriptMatchScore<0.8&&!payload.review.scriptMismatchOverride){
    issues.push('script-mismatch');
  }
  return [...new Set(issues)];
}

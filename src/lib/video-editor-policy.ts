import type {
  AudioLibraryAsset, ProductionDNA, Timeline, TimelineClip, Transcript,
  VideoEditCaptionCue, VideoEditCaptionStyle, VideoEditCaptionWord,
  VideoEditClipStyle, VideoEditMotionPreset, VideoEditPayload, VideoEditSfxEvent
} from '@/lib/types';

const EPSILON=.03;
const STOPWORDS=new Set([
  'about','after','again','also','and','are','because','been','before','being','between',
  'but','can','could','did','does','doing','for','from','had','has','have','how','into',
  'its','just','more','most','not','now','of','off','on','only','or','our','out','over',
  'same','should','some','than','that','the','their','them','then','there','these','they',
  'this','those','through','too','under','very','was','we','were','what','when','where',
  'which','while','who','why','will','with','would','you','your'
]);

function captionEnd(
  segment:Transcript['segments'][number],
  next:Transcript['segments'][number]|undefined,
  duration:number
){
  const raw=segment.endSeconds??next?.startSeconds??duration;
  return Math.max(segment.startSeconds,Math.min(duration,raw));
}

function normalizedWord(value:string){
  return value.toLowerCase().replace(/[^a-z0-9']/g,'');
}

function shouldHighlight(value:string){
  const word=normalizedWord(value);
  return word.length>=5&&!STOPWORDS.has(word);
}

function captionPosition(value:string|undefined):'top'|'center'|'bottom'{
  const normalized=(value??'').toLowerCase();
  if(normalized.includes('top'))return 'top';
  if(normalized.includes('center')&&!normalized.includes('bottom'))return 'center';
  return 'bottom';
}

export function defaultCaptionStyle(dna:ProductionDNA|null|undefined):VideoEditCaptionStyle{
  const maxWords=dna?.captions.maxWordsPerCaption;
  return {
    fontFamily:'DejaVu Sans',
    fontWeight:800,
    primaryColor:'#FFFFFF',
    highlightColor:'#F4C95D',
    outlineColor:'#000000',
    outlineWidth:2,
    uppercase:false,
    maxWordsPerLine:Math.max(2,Math.min(12,Math.ceil((maxWords??12)/2))),
    smartBreaks:true,
    highlightMode:dna?.captions.highlightKeywords?'keywords':'none',
    safeMarginPercent:6
  };
}

export function motionPresetValues(preset:VideoEditMotionPreset){
  if(preset==='zoom-in')return {scaleStart:1,scaleEnd:1.08,xStart:0,xEnd:0,yStart:0,yEnd:0};
  if(preset==='zoom-out')return {scaleStart:1.08,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0};
  if(preset==='pan-left')return {scaleStart:1.08,scaleEnd:1.08,xStart:.04,xEnd:-.04,yStart:0,yEnd:0};
  if(preset==='pan-right')return {scaleStart:1.08,scaleEnd:1.08,xStart:-.04,xEnd:.04,yStart:0,yEnd:0};
  return {scaleStart:1,scaleEnd:1,xStart:0,xEnd:0,yStart:0,yEnd:0};
}

function clamp(value:number,min:number,max:number){
  return Math.max(min,Math.min(max,value));
}

export function documentaryClipStyle(
  clip:TimelineClip,
  index:number,
  total:number,
  enabled:boolean
):VideoEditClipStyle{
  const base:VideoEditClipStyle={
    timelineClipId:clip.id,
    sceneId:clip.sceneId!,
    motionPreset:'none',
    ...motionPresetValues('none'),
    transitionIn:'none',
    transitionOut:'none',
    transitionSeconds:0
  };
  if(!enabled||clip.clipKind!=='image')return base;

  const focusX=typeof clip.focusX==='number'?clamp(clip.focusX,0,1):null;
  const focusY=typeof clip.focusY==='number'?clamp(clip.focusY,0,1):null;
  const hasFocus=focusX!==null&&focusY!==null;
  const sourceRatio=clip.sourceWidth&&clip.sourceHeight
    ?clip.sourceWidth/clip.sourceHeight
    :null;

  let motion:Pick<VideoEditClipStyle,
    'motionPreset'|'scaleStart'|'scaleEnd'|'xStart'|'xEnd'|'yStart'|'yEnd'>;

  if(hasFocus){
    const x=clamp((focusX-.5)*1.5,-.7,.7);
    const y=clamp((focusY-.5)*1.5,-.7,.7);
    const offCenter=Math.abs(x)>.12||Math.abs(y)>.12;
    motion=offCenter
      ?{
        motionPreset:'custom',
        scaleStart:1.02,scaleEnd:1.10,
        xStart:0,xEnd:x,yStart:0,yEnd:y
      }
      :(index%2===0
        ?{motionPreset:'zoom-in',...motionPresetValues('zoom-in')}
        :{motionPreset:'zoom-out',...motionPresetValues('zoom-out')});
  }else if(sourceRatio!==null&&sourceRatio>=1.55){
    motion=index%2===0
      ?{motionPreset:'pan-right',...motionPresetValues('pan-right')}
      :{motionPreset:'pan-left',...motionPresetValues('pan-left')};
  }else{
    motion=index%2===0
      ?{motionPreset:'zoom-in',...motionPresetValues('zoom-in')}
      :{motionPreset:'zoom-out',...motionPresetValues('zoom-out')};
  }

  return {
    timelineClipId:clip.id,
    sceneId:clip.sceneId!,
    ...motion,
    transitionIn:index>0?'cross-dissolve':'none',
    transitionOut:index<total-1?'cross-dissolve':'none',
    transitionSeconds:total>1?.35:0
  };
}

function fallbackWords(
  text:string,
  start:number,
  end:number,
  highlight:boolean
):VideoEditCaptionWord[]{
  const tokens=text.trim().split(/\s+/).filter(Boolean);
  if(!tokens.length)return [];
  const span=Math.max(.01,end-start);
  return tokens.map((token,index)=>{
    const wordStart=start+span*(index/tokens.length);
    const wordEnd=start+span*((index+1)/tokens.length);
    return {
      id:crypto.randomUUID(),
      text:token,
      startSeconds:wordStart,
      endSeconds:wordEnd,
      highlighted:highlight&&shouldHighlight(token)
    };
  });
}

function segmentWords(
  transcript:Transcript,
  segment:Transcript['segments'][number],
  end:number,
  highlight:boolean
){
  const byId=new Map(transcript.words.filter(word=>word.type==='word').map(word=>[word.id,word]));
  const words=segment.wordIds
    .map(id=>byId.get(id))
    .filter((word):word is Transcript['words'][number]=>!!word)
    .sort((a,b)=>a.startSeconds-b.startSeconds)
    .map(word=>({
      id:word.id,
      text:word.text,
      startSeconds:Math.max(segment.startSeconds,word.startSeconds),
      endSeconds:Math.min(end,Math.max(word.startSeconds,word.endSeconds)),
      highlighted:highlight&&shouldHighlight(word.text)
    }));
  return words.length?words:fallbackWords(segment.text,segment.startSeconds,end,highlight);
}

function chunkWords(words:VideoEditCaptionWord[],maxWords:number){
  if(words.length<=maxWords)return [words];
  const chunks:VideoEditCaptionWord[][]=[];
  let cursor=0;
  while(cursor<words.length){
    const hardEnd=Math.min(words.length,cursor+maxWords);
    let end=hardEnd;
    const minimum=cursor+Math.max(2,Math.floor(maxWords*.55));
    for(let i=hardEnd-1;i>=minimum;i--){
      if(/[.!?,;:]$/.test(words[i-1]?.text??'')){end=i;break;}
    }
    chunks.push(words.slice(cursor,end));
    cursor=end;
  }
  return chunks;
}

export function buildCaptionCues(
  transcript:Transcript,
  duration:number,
  options:{maxWordsPerCaption?:number;highlightKeywords?:boolean}={}
):VideoEditCaptionCue[]{
  const maxWords=Math.max(2,Math.min(24,options.maxWordsPerCaption??12));
  const highlight=options.highlightKeywords??false;
  const segments=[...transcript.segments].sort((a,b)=>a.startSeconds-b.startSeconds);
  const cues:VideoEditCaptionCue[]=[];

  segments.forEach((segment,index)=>{
    const end=captionEnd(segment,segments[index+1],duration);
    if(!segment.text.trim()||end<=segment.startSeconds)return;
    const words=segmentWords(transcript,segment,end,highlight);
    const chunks=chunkWords(words,maxWords);
    if(!chunks.length){
      cues.push({
        id:crypto.randomUUID(),
        transcriptSegmentId:segment.id,
        startSeconds:segment.startSeconds,
        endSeconds:end,
        text:segment.text.trim(),
        words:[]
      });
      return;
    }
    for(const chunk of chunks){
      if(!chunk.length)continue;
      cues.push({
        id:crypto.randomUUID(),
        transcriptSegmentId:segment.id,
        startSeconds:Math.max(0,chunk[0].startSeconds),
        endSeconds:Math.min(duration,chunk.at(-1)!.endSeconds),
        text:chunk.map(word=>word.text).join(' ').trim(),
        words:chunk
      });
    }
  });
  return cues;
}

export function upgradeVideoEditPayload(
  payload:VideoEditPayload|Record<string,unknown>,
  dna:ProductionDNA|null=null
):VideoEditPayload{
  const raw=payload as Partial<VideoEditPayload>;
  const captions=(raw.captions??{}) as Partial<VideoEditPayload['captions']>;
  const style=(captions.style??{}) as Partial<VideoEditCaptionStyle>;
  const defaultStyle=defaultCaptionStyle(dna);
  const cues=(captions.cues??[]).map(cue=>{
    const candidate=cue as Partial<VideoEditCaptionCue>;
    return {
      id:String(candidate.id??crypto.randomUUID()),
      transcriptSegmentId:String(candidate.transcriptSegmentId??''),
      startSeconds:Number(candidate.startSeconds??0),
      endSeconds:Number(candidate.endSeconds??0),
      text:String(candidate.text??''),
      words:Array.isArray(candidate.words)?candidate.words.map(word=>({
        id:String(word.id??crypto.randomUUID()),
        text:String(word.text??''),
        startSeconds:Number(word.startSeconds??candidate.startSeconds??0),
        endSeconds:Number(word.endSeconds??candidate.endSeconds??0),
        highlighted:Boolean(word.highlighted)
      })):[]
    };
  });

  return {
    ...(raw as VideoEditPayload),
    captions:{
      enabled:captions.enabled??true,
      position:captions.position??captionPosition(dna?.captions.position),
      fontSize:Number(captions.fontSize??52),
      maxLines:Number(captions.maxLines??2),
      backgroundOpacity:Number(captions.backgroundOpacity??.35),
      styleDescription:String(captions.styleDescription??dna?.captions.styleDescription??''),
      style:{
        fontFamily:String(style.fontFamily??defaultStyle.fontFamily),
        fontWeight:(Number(style.fontWeight??defaultStyle.fontWeight) as VideoEditCaptionStyle['fontWeight']),
        primaryColor:String(style.primaryColor??defaultStyle.primaryColor),
        highlightColor:String(style.highlightColor??defaultStyle.highlightColor),
        outlineColor:String(style.outlineColor??defaultStyle.outlineColor),
        outlineWidth:Number(style.outlineWidth??defaultStyle.outlineWidth),
        uppercase:Boolean(style.uppercase??defaultStyle.uppercase),
        maxWordsPerLine:Number(style.maxWordsPerLine??defaultStyle.maxWordsPerLine),
        smartBreaks:Boolean(style.smartBreaks??defaultStyle.smartBreaks),
        highlightMode:style.highlightMode??defaultStyle.highlightMode,
        safeMarginPercent:Number(style.safeMarginPercent??defaultStyle.safeMarginPercent)
      },
      cues
    },
    musicTrack:raw.musicTrack??null,
    sfxEvents:Array.isArray(raw.sfxEvents)?raw.sfxEvents:[],
    overlays:Array.isArray(raw.overlays)?raw.overlays:[],
    clipStyles:Array.isArray(raw.clipStyles)?raw.clipStyles:[],
    audioMix:raw.audioMix??{
      voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true
    },
    review:raw.review??{notes:''}
  };
}

export function buildInitialVideoEdit(
  timeline:Timeline,
  transcript:Transcript,
  dna:ProductionDNA|null=null
):VideoEditPayload{
  const now=new Date().toISOString();
  const visual=timeline.tracks.find(track=>track.type==='visual');
  const visualClips=(visual?.clips??[]).filter(clip=>clip.sceneId);
  const style=defaultCaptionStyle(dna);
  const cues=buildCaptionCues(transcript,timeline.durationSeconds,{
    maxWordsPerCaption:dna?.captions.maxWordsPerCaption??12,
    highlightKeywords:dna?.captions.highlightKeywords??false
  });

  return {
    kind:'video-edit',
    id:crypto.randomUUID(),
    channelId:timeline.channelId,
    episodeId:timeline.episodeId,
    timelineId:timeline.id,
    timelineVersion:timeline.version,
    transcriptId:transcript.id,
    transcriptVersion:transcript.version,
    format:{...timeline.format},
    durationSeconds:timeline.durationSeconds,
    clipStyles:visualClips.map((clip,index)=>
      documentaryClipStyle(clip,index,visualClips.length,Boolean(dna?.editing.kenBurns))
    ),
    captions:{
      enabled:dna?.captions.enabled??(cues.length>0),
      position:captionPosition(dna?.captions.position),
      fontSize:52,
      maxLines:2,
      backgroundOpacity:.35,
      styleDescription:dna?.captions.styleDescription??'',
      style,
      cues
    },
    overlays:[],
    audioMix:{
      voiceVolume:1,
      musicVolume:.2,
      sfxVolume:.7,
      normalizeVoice:true,
      duckMusicUnderVoice:true
    },
    musicTrack:null,
    sfxEvents:[],
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export function normalizeVideoEdit(payload:VideoEditPayload):VideoEditPayload{
  const upgraded=upgradeVideoEditPayload(payload);
  return {
    ...upgraded,
    clipStyles:[...upgraded.clipStyles],
    captions:{
      ...upgraded.captions,
      style:{...upgraded.captions.style},
      cues:[...upgraded.captions.cues]
        .map(cue=>({
          ...cue,
          text:cue.text.trim(),
          words:[...cue.words].map(word=>({...word,text:word.text.trim()}))
        }))
        .sort((a,b)=>a.startSeconds-b.startSeconds)
    },
    overlays:[...upgraded.overlays]
      .map(overlay=>({...overlay,text:overlay.text.trim()}))
      .sort((a,b)=>a.startSeconds-b.startSeconds),
    sfxEvents:[...upgraded.sfxEvents].sort((a,b)=>a.startSeconds-b.startSeconds),
    musicTrack:upgraded.musicTrack?{...upgraded.musicTrack}:null,
    updatedAt:new Date().toISOString()
  };
}

function validHex(value:string){
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function videoEditStructuralIssues(
  editInput:VideoEditPayload,
  timeline:Timeline,
  transcript:Transcript
){
  const edit=upgradeVideoEditPayload(editInput);
  const issues:string[]=[];
  if(edit.timelineVersion!==timeline.version)issues.push('stale-timeline-version');
  if(edit.transcriptVersion!==transcript.version)issues.push('stale-transcript-version');
  if(Math.abs(edit.durationSeconds-timeline.durationSeconds)>EPSILON)issues.push('duration-mismatch');
  if(
    edit.format.width!==timeline.format.width||
    edit.format.height!==timeline.format.height||
    edit.format.fps!==timeline.format.fps||
    edit.format.aspectRatio!==timeline.format.aspectRatio
  )issues.push('format-mismatch');

  const visual=timeline.tracks.find(track=>track.type==='visual');
  const visualClips=(visual?.clips??[]).filter(clip=>clip.sceneId);
  const styles=new Map<string,VideoEditClipStyle>();
  for(const style of edit.clipStyles){
    if(styles.has(style.timelineClipId))issues.push('duplicate-clip-style');
    styles.set(style.timelineClipId,style);
    if(style.scaleStart<1||style.scaleStart>5||style.scaleEnd<1||style.scaleEnd>5)issues.push('invalid-scale');
    if([style.xStart,style.xEnd,style.yStart,style.yEnd].some(value=>value<-2||value>2))issues.push('invalid-pan');
  }

  for(const clip of visualClips){
    const style=styles.get(clip.id);
    if(!style)issues.push('missing-clip-style');
    else{
      if(style.sceneId!==clip.sceneId)issues.push('clip-style-scene-mismatch');
      const hasTransition=style.transitionIn!=='none'||style.transitionOut!=='none';
      if(hasTransition&&style.transitionSeconds<=0)issues.push('transition-duration-missing');
      if(style.transitionSeconds>clip.durationSeconds/2+EPSILON)issues.push('transition-too-long');
    }
  }
  for(const id of styles.keys()){
    if(!visualClips.some(clip=>clip.id===id))issues.push('orphan-clip-style');
  }

  const captionStyle=edit.captions.style;
  if(!captionStyle.fontFamily.trim())issues.push('caption-font-missing');
  if(![400,500,600,700,800,900].includes(captionStyle.fontWeight))issues.push('caption-font-weight-invalid');
  if(!validHex(captionStyle.primaryColor)||!validHex(captionStyle.highlightColor)||!validHex(captionStyle.outlineColor)){
    issues.push('caption-color-invalid');
  }
  if(captionStyle.outlineWidth<0||captionStyle.outlineWidth>12)issues.push('caption-outline-invalid');
  if(captionStyle.maxWordsPerLine<2||captionStyle.maxWordsPerLine>20)issues.push('caption-line-length-invalid');
  if(captionStyle.safeMarginPercent<0||captionStyle.safeMarginPercent>25)issues.push('caption-safe-margin-invalid');

  const transcriptSegments=new Map(transcript.segments.map(segment=>[segment.id,segment]));
  if(edit.captions.enabled&&!edit.captions.cues.length)issues.push('captions-enabled-without-cues');
  let previousEnd=0;
  for(const cue of edit.captions.cues){
    if(!transcriptSegments.has(cue.transcriptSegmentId))issues.push('caption-segment-missing');
    if(!cue.text.trim())issues.push('empty-caption');
    if(cue.endSeconds<=cue.startSeconds)issues.push('invalid-caption-duration');
    if(cue.startSeconds<0||cue.endSeconds>edit.durationSeconds+EPSILON)issues.push('caption-outside-timeline');
    if(cue.startSeconds<previousEnd-EPSILON)issues.push('caption-overlap');
    previousEnd=Math.max(previousEnd,cue.endSeconds);
    let wordEnd=cue.startSeconds;
    for(const word of cue.words){
      if(!word.text.trim())issues.push('empty-caption-word');
      if(word.endSeconds<=word.startSeconds)issues.push('invalid-caption-word-duration');
      if(word.startSeconds<cue.startSeconds-EPSILON||word.endSeconds>cue.endSeconds+EPSILON)issues.push('caption-word-outside-cue');
      if(word.startSeconds<wordEnd-EPSILON)issues.push('caption-word-overlap');
      wordEnd=Math.max(wordEnd,word.endSeconds);
    }
  }

  for(const overlay of edit.overlays){
    if(!overlay.text.trim())issues.push('empty-overlay');
    if(overlay.endSeconds<=overlay.startSeconds)issues.push('invalid-overlay-duration');
    if(overlay.startSeconds<0||overlay.endSeconds>edit.durationSeconds+EPSILON)issues.push('overlay-outside-timeline');
    if(overlay.x<0||overlay.y<0||overlay.x+overlay.width>1+EPSILON||overlay.y+overlay.height>1+EPSILON){
      issues.push('overlay-outside-frame');
    }
  }

  if(edit.musicTrack){
    const track=edit.musicTrack;
    if(track.endSeconds<=track.startSeconds)issues.push('music-duration-invalid');
    if(track.startSeconds<0||track.endSeconds>edit.durationSeconds+EPSILON)issues.push('music-outside-timeline');
    if(track.sourceStartSeconds<0)issues.push('music-source-start-invalid');
    if(track.volume<0||track.volume>2)issues.push('music-volume-invalid');
    const duration=track.endSeconds-track.startSeconds;
    if(track.fadeInSeconds<0||track.fadeOutSeconds<0||track.fadeInSeconds+track.fadeOutSeconds>duration+EPSILON){
      issues.push('music-fade-invalid');
    }
    if(track.duckingStrength<0||track.duckingStrength>1)issues.push('music-ducking-invalid');
  }

  const sfxIds=new Set<string>();
  for(const event of edit.sfxEvents){
    if(sfxIds.has(event.id))issues.push('duplicate-sfx-event');
    sfxIds.add(event.id);
    if(event.startSeconds<0||event.durationSeconds<=0||event.startSeconds+event.durationSeconds>edit.durationSeconds+EPSILON){
      issues.push('sfx-outside-timeline');
    }
    if(event.sourceStartSeconds<0)issues.push('sfx-source-start-invalid');
    if(event.volume<0||event.volume>2)issues.push('sfx-volume-invalid');
  }

  if(edit.audioMix.voiceVolume<0||edit.audioMix.voiceVolume>2)issues.push('invalid-voice-volume');
  if(edit.audioMix.musicVolume<0||edit.audioMix.musicVolume>2)issues.push('invalid-music-volume');
  if(edit.audioMix.sfxVolume<0||edit.audioMix.sfxVolume>2)issues.push('invalid-sfx-volume');

  return [...new Set(issues)];
}

export function videoEditAudioAssetIssues(editInput:VideoEditPayload,audioAssets:AudioLibraryAsset[]){
  const edit=upgradeVideoEditPayload(editInput);
  const assets=new Map(audioAssets.map(asset=>[asset.id,asset]));
  const issues:string[]=[];
  if(edit.musicTrack){
    const asset=assets.get(edit.musicTrack.assetId);
    if(!asset)issues.push('music-asset-missing');
    else if(asset.kind!=='music'||asset.status!=='ready')issues.push('music-asset-not-ready');
  }
  for(const event of edit.sfxEvents){
    const asset=assets.get(event.assetId);
    if(!asset)issues.push('sfx-asset-missing');
    else if(asset.kind!=='sfx'||asset.status!=='ready')issues.push('sfx-asset-not-ready');
  }
  return [...new Set(issues)];
}

export function suggestSfxEvents(
  editInput:VideoEditPayload,
  timeline:Timeline,
  audioAssets:AudioLibraryAsset[]
):VideoEditSfxEvent[]{
  const edit=upgradeVideoEditPayload(editInput);
  const sfx=audioAssets.filter(asset=>asset.kind==='sfx'&&asset.status==='ready');
  if(!sfx.length)return [];
  const byTag=(needles:string[])=>sfx.find(asset=>asset.tags.some(tag=>needles.some(needle=>tag.toLowerCase().includes(needle))));
  const transitionAsset=byTag(['transition','whoosh','swoosh'])??sfx[0];
  const emphasisAsset=byTag(['emphasis','pop','accent','hit'])??null;
  const events:VideoEditSfxEvent[]=[];
  const visual=timeline.tracks.find(track=>track.type==='visual');
  for(const clip of visual?.clips??[]){
    const style=edit.clipStyles.find(item=>item.timelineClipId===clip.id);
    if(!style||style.transitionOut==='none')continue;
    const duration=Math.max(.1,Math.min(transitionAsset.durationSeconds??.6,.9,edit.durationSeconds-clip.endSeconds+.45));
    const start=Math.max(0,Math.min(edit.durationSeconds-duration,clip.endSeconds-duration/2));
    events.push({
      id:crypto.randomUUID(),assetId:transitionAsset.id,eventType:'scene-transition',
      sceneId:clip.sceneId,startSeconds:start,sourceStartSeconds:0,durationSeconds:duration,volume:.75
    });
  }
  if(emphasisAsset){
    const highlighted=edit.captions.cues.flatMap(cue=>cue.words.filter(word=>word.highlighted));
    for(const word of highlighted.slice(0,12)){
      const duration=Math.max(.08,Math.min(emphasisAsset.durationSeconds??.25,.5,edit.durationSeconds-word.startSeconds));
      if(duration<=0)continue;
      events.push({
        id:crypto.randomUUID(),assetId:emphasisAsset.id,eventType:'emphasis',
        startSeconds:word.startSeconds,sourceStartSeconds:0,durationSeconds:duration,volume:.45
      });
    }
  }
  const existing=edit.sfxEvents;
  return events.filter(event=>!existing.some(current=>Math.abs(current.startSeconds-event.startSeconds)<.08&&current.assetId===event.assetId));
}

export function videoEditUpstreamIssues(input:{
  edit:VideoEditPayload;
  timeline:Timeline;
  transcript:Transcript;
}){
  const edit=upgradeVideoEditPayload(input.edit);
  const issues:string[]=[];
  if(input.timeline.status!=='approved')issues.push('timeline-not-approved');
  if(input.transcript.status!=='approved')issues.push('transcript-not-approved');
  if(edit.timelineVersion!==input.timeline.version)issues.push('stale-timeline-version');
  if(edit.transcriptVersion!==input.transcript.version)issues.push('stale-transcript-version');
  if(input.timeline.scenePlanId&&input.transcript.id!==edit.transcriptId)issues.push('transcript-mismatch');
  return [...new Set(issues)];
}

export function videoEditApprovalIssues(
  edit:VideoEditPayload,
  timeline:Timeline,
  transcript:Transcript,
  audioAssets:AudioLibraryAsset[]=[]
){
  return [...new Set([
    ...videoEditStructuralIssues(edit,timeline,transcript),
    ...videoEditUpstreamIssues({edit,timeline,transcript}),
    ...videoEditAudioAssetIssues(edit,audioAssets)
  ])];
}

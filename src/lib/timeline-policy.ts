import type {
  ProductionDNA, ScenePlan, TimelineChapter, TimelineClip, TimelinePayload, TimelineTrack,
  VisualPromptSet, VoiceAsset
} from '@/lib/types';

const EPSILON=.02;
const MAX_SAFE_SOURCE_EXPANSION_SECONDS=1.5;
const MAX_SAFE_HOLD_SECONDS=.75;

export function fitVideoSourceWindow(input:{
  sourceStartSeconds:number;
  sourceEndSeconds:number;
  assetDurationSeconds:number|null;
  desiredDurationSeconds:number;
}){
  let start=Math.max(0,Number(input.sourceStartSeconds)||0);
  let end=Math.max(start,Number(input.sourceEndSeconds)||start);
  const assetDuration=input.assetDurationSeconds===null
    ?null
    :Math.max(0,Number(input.assetDurationSeconds)||0);
  const desired=Math.max(0,Number(input.desiredDurationSeconds)||0);
  const originalWindow=Math.max(0,end-start);
  const originalShortfall=Math.max(0,desired-originalWindow);

  if(
    originalShortfall>EPSILON&&
    originalShortfall<=MAX_SAFE_SOURCE_EXPANSION_SECONDS+EPSILON&&
    assetDuration!==null&&
    assetDuration>0
  ){
    let remaining=originalShortfall;
    const forward=Math.max(0,assetDuration-end);
    const extendForward=Math.min(remaining,forward);
    end+=extendForward;
    remaining-=extendForward;

    if(remaining>EPSILON){
      const extendBackward=Math.min(remaining,start);
      start-=extendBackward;
      remaining-=extendBackward;
    }
  }

  const windowSeconds=Math.max(0,end-start);
  const shortfallSeconds=Math.max(0,desired-windowSeconds);
  const playback=shortfallSeconds<=EPSILON
    ?'trim' as const
    :shortfallSeconds<=MAX_SAFE_HOLD_SECONDS+EPSILON
      ?'hold' as const
      :'loop' as const;

  return {
    sourceStartSeconds:start,
    sourceEndSeconds:end,
    windowSeconds,
    shortfallSeconds,
    playback
  };
}

export type TimelineVisualAssetRef={
  id:string;
  sceneId:string;
  assetKind:'image'|'video'|'graphic';
  durationSeconds:number|null;
  sourceStartSeconds?:number|null;
  sourceEndSeconds?:number|null;
  sourceWidth?:number|null;
  sourceHeight?:number|null;
  focusX?:number|null;
  focusY?:number|null;
};

const CHAPTER_MAX_SECONDS=600;
const LONG_STATIC_IMAGE_SECONDS=15;
const SHORT_CUT_SECONDS=1.5;

function chapterSceneGroups(scenePlan:ScenePlan){
  const scenes=[...scenePlan.scenes].sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!scenes.length)return [] as typeof scenes[];
  const count=Math.max(1,Math.ceil(Math.max(0,scenePlan.audioDurationSeconds)/CHAPTER_MAX_SECONDS));
  if(count===1)return [scenes];

  const target=Math.max(1,scenePlan.audioDurationSeconds/count);
  const groups:Array<typeof scenes>=[];
  let cursor=0;
  for(let chapterIndex=0;chapterIndex<count;chapterIndex++){
    const remainingChapters=count-chapterIndex;
    if(remainingChapters===1){
      groups.push(scenes.slice(cursor));
      break;
    }
    const desiredEnd=target*(chapterIndex+1);
    const maxIndex=scenes.length-remainingChapters;
    let bestIndex=cursor;
    let bestDistance=Infinity;
    for(let index=cursor;index<=maxIndex;index++){
      const distance=Math.abs(scenes[index].endSeconds-desiredEnd);
      if(distance<bestDistance){
        bestDistance=distance;
        bestIndex=index;
      }
    }
    groups.push(scenes.slice(cursor,bestIndex+1));
    cursor=bestIndex+1;
  }
  return groups.filter(group=>group.length);
}

export function buildTimelineChapters(scenePlan:ScenePlan):TimelineChapter[]{
  const now=new Date().toISOString();
  return chapterSceneGroups(scenePlan).map((scenes,index)=>{
    const start=scenes[0]?.startSeconds??0;
    const end=scenes.at(-1)?.endSeconds??start;
    return {
      id:crypto.randomUUID(),
      sequence:index+1,
      label:'Chapter '+String(index+1).padStart(2,'0'),
      startSeconds:start,
      endSeconds:end,
      durationSeconds:Math.max(0,end-start),
      sceneIds:scenes.map(scene=>scene.id),
      status:'draft',
      reviewNotes:'',
      updatedAt:now
    };
  });
}

export function timelineChapters(payload:TimelinePayload):TimelineChapter[]{
  if(payload.chapters?.length){
    return [...payload.chapters].sort((a,b)=>a.sequence-b.sequence).map((chapter,index)=>({
      ...chapter,
      sequence:index+1,
      startSeconds:Math.max(0,chapter.startSeconds),
      endSeconds:Math.min(payload.durationSeconds,Math.max(chapter.startSeconds,chapter.endSeconds)),
      durationSeconds:Math.max(0,Math.min(payload.durationSeconds,Math.max(chapter.startSeconds,chapter.endSeconds))-Math.max(0,chapter.startSeconds))
    }));
  }
  const visual=[...(payload.tracks.find(track=>track.type==='visual')?.clips??[])]
    .filter(clip=>clip.sceneId)
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!visual.length)return [];
  const pseudo:ScenePlan={
    kind:'scene-plan',
    id:payload.scenePlanId,
    channelId:payload.channelId,
    episodeId:payload.episodeId,
    scriptId:payload.scriptId,
    voiceAssetId:payload.voiceAssetId,
    transcriptId:crypto.randomUUID(),
    transcriptVersion:1,
    voiceTake:1,
    audioDurationSeconds:payload.durationSeconds,
    scenes:visual.map((clip,index)=>({
      id:clip.sceneId!,
      sequence:index+1,
      startSeconds:clip.startSeconds,
      endSeconds:clip.endSeconds,
      durationSeconds:clip.durationSeconds,
      narration:'',
      transcriptSegmentIds:[],
      transcriptWordIds:[],
      visualIntent:'',
      shotType:'',
      characterIds:[],
      assetMode:'mixed',
      promptDirection:'',
      notes:''
    })),
    review:{notes:'',durationWarningsAccepted:true},
    createdAt:payload.createdAt,
    updatedAt:payload.updatedAt,
    version:1,
    status:'approved'
  };
  return buildTimelineChapters(pseudo).map(chapter=>({
    ...chapter,
    id:chapter.sceneIds[0]??payload.id,
    updatedAt:payload.updatedAt
  }));
}

export function timelineChapterStructuralIssues(payload:TimelinePayload){
  const chapters=timelineChapters(payload);
  if(!chapters.length)return ['missing-timeline-chapters'];
  const issues:string[]=[];
  const visual=payload.tracks.find(track=>track.type==='visual');
  const expectedSceneIds=new Set((visual?.clips??[]).flatMap(clip=>clip.sceneId?[clip.sceneId]:[]));
  const seenSceneIds=new Set<string>();

  chapters.forEach((chapter,index)=>{
    if(chapter.endSeconds<=chapter.startSeconds)issues.push('invalid-chapter-duration');
    const previous=chapters[index-1];
    if(previous){
      if(chapter.startSeconds<previous.endSeconds-EPSILON)issues.push('chapter-overlap');
      if(chapter.startSeconds>previous.endSeconds+EPSILON)issues.push('chapter-gap');
    }else if(chapter.startSeconds>EPSILON){
      issues.push('chapter-gap-at-start');
    }
    for(const sceneId of chapter.sceneIds){
      if(seenSceneIds.has(sceneId))issues.push('chapter-duplicate-scene');
      seenSceneIds.add(sceneId);
      if(!expectedSceneIds.has(sceneId))issues.push('chapter-unknown-scene');
    }
  });
  if(chapters.at(-1)!.endSeconds<payload.durationSeconds-EPSILON)issues.push('chapter-gap-at-end');
  for(const sceneId of expectedSceneIds)if(!seenSceneIds.has(sceneId))issues.push('chapter-missing-scene');
  return [...new Set(issues)];
}

export function timelineHealth(payload:TimelinePayload){
  const visual=[...(payload.tracks.find(track=>track.type==='visual')?.clips??[])]
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  let gapSeconds=0;
  let cursor=0;
  for(const clip of visual){
    if(clip.startSeconds>cursor)gapSeconds+=clip.startSeconds-cursor;
    cursor=Math.max(cursor,clip.endSeconds);
  }
  if(cursor<payload.durationSeconds)gapSeconds+=payload.durationSeconds-cursor;

  const mediaClips=visual.filter(clip=>clip.clipKind!=='placeholder'&&clip.assetId);
  const uniqueAssets=new Set(mediaClips.map(clip=>clip.assetId)).size;
  const longStaticImages=visual.filter(
    clip=>clip.clipKind==='image'&&clip.durationSeconds>LONG_STATIC_IMAGE_SECONDS
  );
  const shortCuts=visual.filter(
    clip=>clip.clipKind!=='placeholder'&&clip.durationSeconds<SHORT_CUT_SECONDS
  );
  const chapters=timelineChapters(payload);
  const chapterMetrics=chapters.map(chapter=>{
    const clips=visual.filter(clip=>
      clip.endSeconds>chapter.startSeconds+EPSILON&&
      clip.startSeconds<chapter.endSeconds-EPSILON
    );
    const chapterMedia=clips.filter(clip=>clip.clipKind!=='placeholder'&&clip.assetId);
    return {
      chapterId:chapter.id,
      sequence:chapter.sequence,
      durationSeconds:chapter.durationSeconds,
      clipCount:clips.length,
      cutsPerMinute:chapter.durationSeconds>0?clips.length/(chapter.durationSeconds/60):0,
      imageCount:clips.filter(clip=>clip.clipKind==='image').length,
      videoCount:clips.filter(clip=>clip.clipKind==='video').length,
      placeholderCount:clips.filter(clip=>clip.clipKind==='placeholder').length,
      uniqueAssetRatio:chapterMedia.length
        ?new Set(chapterMedia.map(clip=>clip.assetId)).size/chapterMedia.length
        :0
    };
  });
  return {
    coverageRatio:payload.durationSeconds>0
      ?Math.max(0,Math.min(1,(payload.durationSeconds-gapSeconds)/payload.durationSeconds))
      :1,
    gapSeconds,
    clipCount:visual.length,
    cutsPerMinute:payload.durationSeconds>0?visual.length/(payload.durationSeconds/60):0,
    uniqueAssetRatio:mediaClips.length?uniqueAssets/mediaClips.length:0,
    repeatedAssetCount:Math.max(0,mediaClips.length-uniqueAssets),
    longStaticImageCount:longStaticImages.length,
    maxStaticImageSeconds:longStaticImages.length
      ?Math.max(...longStaticImages.map(clip=>clip.durationSeconds))
      :0,
    excessiveCutCount:shortCuts.length,
    chapters:chapterMetrics
  };
}

export function rebuildTimelineChapterPayload(
  currentInput:TimelinePayload,
  freshInput:TimelinePayload,
  chapterId:string
){
  const current=normalizeTimeline(currentInput);
  const fresh=normalizeTimeline(freshInput);
  const chapters=timelineChapters(current);
  const chapter=chapters.find(item=>item.id===chapterId);
  if(!chapter)throw new Error('timeline-chapter-not-found');
  const sceneIds=new Set(chapter.sceneIds);
  const currentVisual=current.tracks.find(track=>track.type==='visual');
  const freshVisual=fresh.tracks.find(track=>track.type==='visual');
  if(!currentVisual||!freshVisual)throw new Error('timeline-visual-track-missing');

  const replacement=new Map(
    freshVisual.clips.filter(clip=>clip.sceneId&&sceneIds.has(clip.sceneId))
      .map(clip=>[clip.sceneId!,clip])
  );
  const visualClips=currentVisual.clips.map(clip=>
    clip.sceneId&&sceneIds.has(clip.sceneId)
      ?structuredClone(replacement.get(clip.sceneId)??clip)
      :clip
  );
  const now=new Date().toISOString();
  return normalizeTimeline({
    ...current,
    tracks:current.tracks.map(track=>track.id===currentVisual.id?{...track,clips:visualClips}:track),
    chapters:chapters.map(item=>item.id===chapterId?{
      ...item,status:'draft',updatedAt:now
    }:item),
    updatedAt:now
  });
}

export function buildInitialTimeline(input:{
  scenePlan:ScenePlan;
  productionDna:ProductionDNA;
  visualPromptSet:VisualPromptSet;
  visualAssets:TimelineVisualAssetRef[];
  voiceAsset:VoiceAsset;
}):TimelinePayload{
  const now=new Date().toISOString();
  const visualByScene=new Map(input.visualAssets.map(asset=>[asset.sceneId,asset]));

  const visualTrack:TimelineTrack={
    id:crypto.randomUUID(),
    type:'visual',
    name:'Visual',
    locked:false,
    muted:false,
    clips:input.scenePlan.scenes.map(scene=>{
      const asset=visualByScene.get(scene.id);
      if(!asset){
        return {
          id:crypto.randomUUID(),
          sceneId:scene.id,
          clipKind:'placeholder',
          label:'Scene '+String(scene.sequence).padStart(3,'0')+' · missing asset',
          startSeconds:scene.startSeconds,
          endSeconds:scene.endSeconds,
          durationSeconds:scene.durationSeconds,
          sourceStartSeconds:null,
          sourceEndSeconds:null,
          fit:'cover',
          playback:'hold',
          volume:1,
          muted:false
        } satisfies TimelineClip;
      }

      const isVideo=asset.assetKind==='video';
      const rawSourceStart=isVideo?Math.max(0,asset.sourceStartSeconds??0):null;
      const rawSourceEnd=isVideo
        ?asset.sourceEndSeconds!==undefined&&asset.sourceEndSeconds!==null
          ?Math.max(rawSourceStart??0,asset.sourceEndSeconds)
          :Math.min(asset.durationSeconds??scene.durationSeconds,scene.durationSeconds)
        :null;
      const fitted=isVideo&&rawSourceStart!==null&&rawSourceEnd!==null
        ?fitVideoSourceWindow({
          sourceStartSeconds:rawSourceStart,
          sourceEndSeconds:rawSourceEnd,
          assetDurationSeconds:asset.durationSeconds,
          desiredDurationSeconds:scene.durationSeconds
        })
        :null;
      const sourceStart=fitted?.sourceStartSeconds??rawSourceStart;
      const sourceEnd=fitted?.sourceEndSeconds??rawSourceEnd;
      const playback=isVideo?(fitted?.playback??'trim'):'hold';

      return {
        id:crypto.randomUUID(),
        sceneId:scene.id,
        assetId:asset.id,
        clipKind:isVideo?'video':'image',
        label:'Scene '+String(scene.sequence).padStart(3,'0'),
        startSeconds:scene.startSeconds,
        endSeconds:scene.endSeconds,
        durationSeconds:scene.durationSeconds,
        sourceStartSeconds:sourceStart,
        sourceEndSeconds:sourceEnd,
        sourceWidth:asset.sourceWidth??null,
        sourceHeight:asset.sourceHeight??null,
        focusX:asset.focusX??null,
        focusY:asset.focusY??null,
        fit:'cover',
        playback,
        volume:1,
        muted:false
      } satisfies TimelineClip;
    })
  };

  const voiceTrack:TimelineTrack={
    id:crypto.randomUUID(),
    type:'voice',
    name:'Narration',
    locked:true,
    muted:false,
    clips:[{
      id:crypto.randomUUID(),
      assetId:input.voiceAsset.id,
      clipKind:'audio',
      label:'Narration · Take '+String(input.voiceAsset.take).padStart(2,'0'),
      startSeconds:0,
      endSeconds:input.scenePlan.audioDurationSeconds,
      durationSeconds:input.scenePlan.audioDurationSeconds,
      sourceStartSeconds:0,
      sourceEndSeconds:input.voiceAsset.durationSeconds??input.scenePlan.audioDurationSeconds,
      fit:'contain',
      playback:'trim',
      volume:1,
      muted:false
    }]
  };

  return {
    kind:'timeline',
    id:crypto.randomUUID(),
    channelId:input.scenePlan.channelId,
    episodeId:input.scenePlan.episodeId,
    scenePlanId:input.scenePlan.id,
    scenePlanVersion:input.scenePlan.version,
    scriptId:input.scenePlan.scriptId,
    voiceAssetId:input.scenePlan.voiceAssetId,
    visualPromptSetId:input.visualPromptSet.id,
    visualPromptSetVersion:input.visualPromptSet.version,
    format:{
      width:input.productionDna.format.width,
      height:input.productionDna.format.height,
      fps:input.productionDna.format.fps,
      aspectRatio:input.productionDna.format.aspectRatio
    },
    durationSeconds:input.scenePlan.audioDurationSeconds,
    tracks:[visualTrack,voiceTrack],
    chapters:buildTimelineChapters(input.scenePlan),
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export function normalizeTimeline(payload:TimelinePayload):TimelinePayload{
  const base={
    ...payload,
    durationSeconds:Math.max(0,payload.durationSeconds),
    tracks:payload.tracks.map(track=>({
      ...track,
      clips:[...track.clips]
        .sort((a,b)=>a.startSeconds-b.startSeconds)
        .map(clip=>({
          ...clip,
          startSeconds:Math.max(0,clip.startSeconds),
          endSeconds:Math.max(0,clip.endSeconds),
          durationSeconds:Math.max(0,clip.endSeconds-clip.startSeconds)
        }))
    })),
    updatedAt:new Date().toISOString()
  };
  return {
    ...base,
    chapters:timelineChapters(base)
  };
}

export function timelineStructuralIssues(payload:TimelinePayload,scenePlan:ScenePlan){
  const issues:string[]=[];
  const visualTracks=payload.tracks.filter(track=>track.type==='visual');
  const voiceTracks=payload.tracks.filter(track=>track.type==='voice');

  if(payload.scenePlanVersion!==scenePlan.version)issues.push('stale-scene-plan-version');
  if(Math.abs(payload.durationSeconds-scenePlan.audioDurationSeconds)>EPSILON)issues.push('timeline-duration-mismatch');
  if(visualTracks.length!==1)issues.push('visual-track-count');
  if(voiceTracks.length!==1)issues.push('voice-track-count');
  issues.push(...timelineChapterStructuralIssues(payload));

  const visual=visualTracks[0];
  if(visual){
    const clips=[...visual.clips].sort((a,b)=>a.startSeconds-b.startSeconds);
    const seen=new Map<string,number>();

    clips.forEach((clip,index)=>{
      if(clip.endSeconds<=clip.startSeconds)issues.push('invalid-visual-clip-duration');
      if(clip.startSeconds<0||clip.endSeconds>payload.durationSeconds+EPSILON)issues.push('visual-clip-outside-timeline');
      if(clip.clipKind==='placeholder'||!clip.assetId)issues.push('missing-scene-asset');
      if(clip.clipKind!=='image'&&clip.clipKind!=='video'&&clip.clipKind!=='placeholder')issues.push('invalid-visual-clip-kind');
      if(!clip.sceneId)issues.push('visual-clip-without-scene');

      const previous=clips[index-1];
      if(previous){
        if(clip.startSeconds<previous.endSeconds-EPSILON)issues.push('visual-overlap');
        if(clip.startSeconds>previous.endSeconds+EPSILON)issues.push('visual-gap');
      }else if(clip.startSeconds>EPSILON){
        issues.push('visual-gap-at-start');
      }

      if(clip.sceneId)seen.set(clip.sceneId,(seen.get(clip.sceneId)??0)+1);
      const scene=clip.sceneId?scenePlan.scenes.find(item=>item.id===clip.sceneId):null;
      if(scene&&(
        Math.abs(clip.startSeconds-scene.startSeconds)>EPSILON||
        Math.abs(clip.endSeconds-scene.endSeconds)>EPSILON
      ))issues.push('visual-clip-scene-time-mismatch');

      if(
        clip.clipKind==='video'&&
        clip.playback==='trim'&&
        clip.sourceStartSeconds!==null&&
        clip.sourceEndSeconds!==null&&
        clip.sourceEndSeconds-clip.sourceStartSeconds+EPSILON<clip.durationSeconds
      )issues.push('video-source-too-short');
      if(
        clip.clipKind==='video'&&
        clip.playback==='loop'
      )issues.push('video-loop-too-long');
    });

    if(clips.length&&clips.at(-1)!.endSeconds<payload.durationSeconds-EPSILON)issues.push('visual-gap-at-end');

    for(const scene of scenePlan.scenes){
      const count=seen.get(scene.id)??0;
      if(count===0)issues.push('missing-scene-clip');
      if(count>1)issues.push('duplicate-scene-clip');
    }
  }

  const voice=voiceTracks[0];
  if(voice){
    if(voice.clips.length!==1)issues.push('voice-clip-count');
    const clip=voice.clips[0];
    if(clip){
      if(clip.assetId!==payload.voiceAssetId)issues.push('voice-asset-mismatch');
      if(clip.clipKind!=='audio')issues.push('invalid-voice-clip-kind');
      if(Math.abs(clip.startSeconds)>EPSILON||Math.abs(clip.endSeconds-payload.durationSeconds)>EPSILON){
        issues.push('voice-does-not-cover-timeline');
      }
      if(clip.sourceStartSeconds!==null&&clip.sourceEndSeconds!==null&&clip.sourceEndSeconds<=clip.sourceStartSeconds){
        issues.push('invalid-voice-source-range');
      }
    }
  }

  return [...new Set(issues)];
}

export function timelineAssetIssues(input:{
  timeline:TimelinePayload;
  currentScenePlanVersion:number;
  currentPromptSetVersion:number;
  voiceReady:boolean;
  voiceSelected:boolean;
  voiceStale:boolean;
  selectedSceneAssets:Map<string,{id:string;stale:boolean;ready:boolean}>;
}){
  const issues:string[]=[];
  if(input.timeline.scenePlanVersion!==input.currentScenePlanVersion)issues.push('stale-scene-plan-version');
  if(input.timeline.visualPromptSetVersion!==input.currentPromptSetVersion)issues.push('stale-visual-prompt-set-version');
  if(!input.voiceReady)issues.push('voice-not-ready');
  if(!input.voiceSelected)issues.push('voice-not-selected');
  if(input.voiceStale)issues.push('voice-stale');

  const visual=input.timeline.tracks.find(track=>track.type==='visual');
  for(const clip of visual?.clips??[]){
    if(!clip.sceneId||!clip.assetId)continue;
    const selected=input.selectedSceneAssets.get(clip.sceneId);
    if(!selected||selected.id!==clip.assetId)issues.push('scene-asset-selection-changed');
    else{
      if(!selected.ready)issues.push('scene-asset-not-ready');
      if(selected.stale)issues.push('scene-asset-stale');
    }
  }

  return [...new Set(issues)];
}

export function timelineApprovalIssues(
  payload:TimelinePayload,
  scenePlan:ScenePlan,
  assetIssues:string[]
){
  return [...new Set([
    ...timelineStructuralIssues(payload,scenePlan),
    ...assetIssues
  ])];
}

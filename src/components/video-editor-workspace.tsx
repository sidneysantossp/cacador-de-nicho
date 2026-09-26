'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Captions, Clapperboard, Eye,
  History, Layers3, Pause, Play, Plus, Save, Sparkles, Trash2, Volume2
} from 'lucide-react';
import type {
  AudioLibraryAsset, ManagedChannel, Timeline, Transcript, VideoEdit, VideoEditClipStyle,
  VideoEditMotionPreset, VideoEditOverlay, VideoEditPayload, VideoEditSfxEvent, VideoEditVersion
} from '@/lib/types';
import {
  motionPresetValues, normalizeVideoEdit, suggestSfxEvents,
  videoEditAudioAssetIssues, videoEditChapterCaptions, videoEditChapterClips,
  videoEditorChapters, videoEditStructuralIssues
} from '@/lib/video-editor-policy';

type Source={
  assetId:string;
  kind:'image'|'video'|'audio';
  signedUrl:string|null;
  mimeType:string;
  title:string;
};
type Tab='editor'|'captions'|'overlays'|'audio'|'review'|'history';

function time(value:number){
  const m=Math.floor(value/60);
  const s=(value%60).toFixed(1).padStart(4,'0');
  return String(m).padStart(2,'0')+':'+s;
}
function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:VideoEdit):VideoEditPayload{const {version:_version,status:_status,...payload}=value;return payload;}
function comparable(value:VideoEditPayload){
  const {updatedAt:_updated,...rest}=value;
  return JSON.stringify(rest);
}

export default function VideoEditorWorkspace({channel}:{channel:ManagedChannel}){
  const [edits,setEdits]=useState<VideoEdit[]>([]);
  const [timelines,setTimelines]=useState<Timeline[]>([]);
  const [current,setCurrent]=useState<VideoEdit|null>(null);
  const [draft,setDraft]=useState<VideoEditPayload|null>(null);
  const [timeline,setTimeline]=useState<Timeline|null>(null);
  const [transcript,setTranscript]=useState<Transcript|null>(null);
  const [sources,setSources]=useState<Source[]>([]);
  const [audioAssets,setAudioAssets]=useState<AudioLibraryAsset[]>([]);
  const [history,setHistory]=useState<VideoEditVersion[]>([]);
  const [tab,setTab]=useState<Tab>('editor');
  const [selectedClipId,setSelectedClipId]=useState('');
  const [activeChapterId,setActiveChapterId]=useState('');
  const [playhead,setPlayhead]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const editTimelineIds=useMemo(()=>new Set(edits.map(edit=>edit.timelineId)),[edits]);
  const eligibleTimelines=useMemo(()=>timelines.filter(item=>!editTimelineIds.has(item.id)),[timelines,editTimelineIds]);
  const sourceMap=useMemo(()=>new Map(sources.map(source=>[source.assetId,source])),[sources]);
  const musicAssets=useMemo(()=>audioAssets.filter(asset=>asset.kind==='music'&&asset.status==='ready'),[audioAssets]);
  const sfxAssets=useMemo(()=>audioAssets.filter(asset=>asset.kind==='sfx'&&asset.status==='ready'),[audioAssets]);
  const chapters=useMemo(()=>timeline?videoEditorChapters(timeline):[],[timeline]);
  const activeChapter=useMemo(()=>
    chapters.find(chapter=>chapter.id===activeChapterId)??chapters[0]??null,
    [chapters,activeChapterId]
  );
  const visualClips=useMemo(()=>
    timeline?videoEditChapterClips(timeline,activeChapter?.id):[],
    [timeline,activeChapter?.id]
  );
  const visibleCaptions=useMemo(()=>
    draft&&timeline?videoEditChapterCaptions(draft,timeline,activeChapter?.id):[],
    [draft,timeline,activeChapter?.id]
  );
  const structuralIssues=useMemo(()=>draft&&timeline&&transcript?[...new Set([
    ...videoEditStructuralIssues(normalizeVideoEdit(draft),timeline,transcript),
    ...videoEditAudioAssetIssues(draft,audioAssets)
  ])]:[],[draft,timeline,transcript,audioAssets]);
  const dirty=useMemo(()=>draft&&current?comparable(draft)!==comparable(payloadOnly(current)):!!draft,[draft,current]);

  const currentClip=useMemo(()=>{
    if(!timeline)return null;
    return visualClips.find(clip=>playhead>=clip.startSeconds&&playhead<clip.endSeconds)
      ??visualClips.at(-1)
      ??null;
  },[timeline,visualClips,playhead]);
  const currentStyle=useMemo(()=>draft&&currentClip?draft.clipStyles.find(style=>style.timelineClipId===currentClip.id)??null:null,[draft,currentClip]);
  const selectedStyle=useMemo(()=>draft?draft.clipStyles.find(style=>style.timelineClipId===selectedClipId)??null:null,[draft,selectedClipId]);
  const currentCue=useMemo(()=>draft?.captions.enabled?visibleCaptions.find(cue=>playhead>=cue.startSeconds&&playhead<cue.endSeconds)??null:null,[draft?.captions.enabled,visibleCaptions,playhead]);
  const currentOverlays=useMemo(()=>draft?.overlays.filter(overlay=>playhead>=overlay.startSeconds&&playhead<overlay.endSeconds)??[],[draft,playhead]);

  useEffect(()=>{
    if(!playing||!draft)return;
    const id=window.setInterval(()=>{
      setPlayhead(value=>{
        const next=value+.1;
        if(next>=draft.durationSeconds){setPlaying(false);return draft.durationSeconds;}
        return next;
      });
    },100);
    return()=>window.clearInterval(id);
  },[playing,draft?.durationSeconds]);

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/video-editor?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Video Editor.');
      setEdits(body.edits??[]);
      setTimelines(body.timelines??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Video Editor.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  async function openEdit(id:string,chapterId?:string){
    setBusy('open');setMessage('');
    try{
      const query=new URLSearchParams({videoEditId:id});
      if(chapterId)query.set('chapterId',chapterId);
      const res=await fetch('/api/video-editor?'+query.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir Video Edit.');
      setCurrent(body.videoEdit);
      setDraft(payloadOnly(body.videoEdit));
      setTimeline(body.timeline);
      setTranscript(body.transcript);
      setSources(body.sources??[]);
      setAudioAssets(body.audioAssets??[]);
      setHistory(body.history??[]);
      const resolvedChapterId=String(body.activeChapterId??'');
      setActiveChapterId(resolvedChapterId);
      const scopedClips=body.timeline
        ?videoEditChapterClips(body.timeline,resolvedChapterId)
        :[];
      const first=scopedClips[0]?.id??body.videoEdit.clipStyles?.[0]?.timelineClipId??'';
      setSelectedClipId(first);
      const firstClip=scopedClips.find((clip:Timeline['tracks'][number]['clips'][number])=>clip.id===first);
      setPlayhead(firstClip?.startSeconds??0);
      setPlaying(false);
      setTab('editor');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Video Edit.');}
    finally{setBusy('');}
  }

  async function openChapter(chapterId:string){
    if(!current||!timeline||chapterId===activeChapter?.id)return;
    setBusy('chapter:'+chapterId);setMessage('');
    try{
      const query=new URLSearchParams({videoEditId:current.id,chapterId});
      const res=await fetch('/api/video-editor?'+query.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar capítulo.');
      const resolvedChapterId=String(body.activeChapterId??chapterId);
      const scopedClips=videoEditChapterClips(timeline,resolvedChapterId);
      setSources(body.sources??[]);
      setAudioAssets(body.audioAssets??[]);
      setActiveChapterId(resolvedChapterId);
      setSelectedClipId(scopedClips[0]?.id??'');
      const chapter=videoEditorChapters(timeline).find(item=>item.id===resolvedChapterId);
      setPlayhead(scopedClips[0]?.startSeconds??chapter?.startSeconds??0);
      setPlaying(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar capítulo.');}
    finally{setBusy('');}
  }

  async function create(timelineId:string){
    setBusy('create:'+timelineId);setMessage('');
    try{
      const res=await fetch('/api/video-editor',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'create',timelineId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao criar Video Edit.');
      setEdits(prev=>[body.videoEdit,...prev.filter(item=>item.id!==body.videoEdit.id)]);
      setMessage(body.message??'Video Edit criado.');
      await openEdit(body.videoEdit.id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Video Edit.');}
    finally{setBusy('');}
  }

  async function save(status:VideoEdit['status']='draft',payload=draft){
    if(!payload)return false;
    setBusy('save');setMessage('');
    try{
      const normalized=normalizeVideoEdit(payload);
      const res=await fetch('/api/video-editor',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,chapterId:activeChapter?.id,videoEdit:normalized})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Video Edit.');
      setCurrent(body.videoEdit);
      setDraft(payloadOnly(body.videoEdit));
      setTimeline(body.timeline);
      setTranscript(body.transcript);
      setSources(body.sources??[]);
      setAudioAssets(body.audioAssets??[]);
      setHistory(body.history??[]);
      setActiveChapterId(String(body.activeChapterId??activeChapter?.id??''));
      setEdits(prev=>[body.videoEdit,...prev.filter(item=>item.id!==body.videoEdit.id)]);
      setMessage(body.message??'Video Edit salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Video Edit.');return false;}
    finally{setBusy('');}
  }

  function updateStyle(id:string,patch:Partial<VideoEditClipStyle>){
    setDraft(prev=>prev?{...prev,clipStyles:prev.clipStyles.map(style=>style.timelineClipId===id?{...style,...patch}:style)}:prev);
  }

  function setMotion(id:string,preset:VideoEditMotionPreset){
    updateStyle(id,{motionPreset:preset,...motionPresetValues(preset)});
  }

  function updateOverlay(id:string,patch:Partial<VideoEditOverlay>){
    setDraft(prev=>prev?{...prev,overlays:prev.overlays.map(item=>item.id===id?{...item,...patch}:item)}:prev);
  }

  function updateCaptionStyle(patch:Partial<VideoEditPayload['captions']['style']>){
    setDraft(prev=>prev?{...prev,captions:{...prev.captions,style:{...prev.captions.style,...patch}}}:prev);
  }

  function toggleCaptionWord(cueId:string,wordId:string){
    setDraft(prev=>prev?{
      ...prev,
      captions:{...prev.captions,cues:prev.captions.cues.map(cue=>cue.id===cueId?{
        ...cue,words:cue.words.map(word=>word.id===wordId?{...word,highlighted:!word.highlighted}:word)
      }:cue)}
    }:prev);
  }

  function selectMusic(assetId:string){
    if(!draft)return;
    if(!assetId){setDraft({...draft,musicTrack:null});return;}
    setDraft({...draft,musicTrack:{
      assetId,startSeconds:0,endSeconds:draft.durationSeconds,sourceStartSeconds:0,
      loop:true,volume:1,fadeInSeconds:.5,fadeOutSeconds:.8,
      duckUnderVoice:true,duckingStrength:.7
    }});
  }

  function addSfx(assetId:string){
    if(!draft||!assetId)return;
    const asset=audioAssets.find(item=>item.id===assetId);
    if(!asset)return;
    const remaining=Math.max(.01,draft.durationSeconds-playhead);
    const event:VideoEditSfxEvent={
      id:crypto.randomUUID(),assetId,eventType:'custom',
      startSeconds:Math.min(playhead,draft.durationSeconds-.01),
      sourceStartSeconds:0,
      durationSeconds:Math.max(.01,Math.min(asset.durationSeconds??.6,2,remaining)),
      volume:.7
    };
    setDraft({...draft,sfxEvents:[...draft.sfxEvents,event]});
  }

  function autoSfx(){
    if(!draft||!timeline)return;
    const suggested=suggestSfxEvents(draft,timeline,audioAssets);
    if(!suggested.length){setMessage('Nenhum SFX compatível encontrado. Use tags como transition, whoosh, pop ou emphasis.');return;}
    setDraft({...draft,sfxEvents:[...draft.sfxEvents,...suggested]});
    setMessage(suggested.length+' SFX sugerido(s) a partir de transições e palavras destacadas.');
  }

  async function uploadAudio(kind:'music'|'sfx',file:File|null){
    if(!file)return;
    setBusy('audio-upload');setMessage('');
    try{
      const form=new FormData();
      form.set('channelId',channel.id);
      form.set('kind',kind);
      form.set('file',file);
      form.set('tags',kind==='music'?'music':'sfx');
      const res=await fetch('/api/audio-library',{method:'POST',body:form});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha no upload de áudio.');
      setAudioAssets(body.assets??[]);
      setMessage(body.message??'Áudio salvo na biblioteca.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha no upload de áudio.');}
    finally{setBusy('');}
  }

  function addOverlay(){
    if(!draft)return;
    const start=Math.min(playhead,draft.durationSeconds-.5);
    const overlay:VideoEditOverlay={
      id:crypto.randomUUID(),type:'text',text:'Novo texto',
      startSeconds:start,endSeconds:Math.min(draft.durationSeconds,start+3),
      x:.1,y:.1,width:.8,height:.16,opacity:1,fontSize:54
    };
    setDraft({...draft,overlays:[...draft.overlays,overlay]});
    setTab('overlays');
  }

  const previewTransform=useMemo(()=>{
    if(!currentClip||!currentStyle)return 'none';
    const progress=Math.max(0,Math.min(1,(playhead-currentClip.startSeconds)/Math.max(.001,currentClip.durationSeconds)));
    const lerp=(a:number,b:number)=>a+(b-a)*progress;
    const scale=lerp(currentStyle.scaleStart,currentStyle.scaleEnd);
    const x=lerp(currentStyle.xStart,currentStyle.xEnd)*100;
    const y=lerp(currentStyle.yStart,currentStyle.yEnd)*100;
    return 'translate('+x+'%,'+y+'%) scale('+scale+')';
  },[currentClip,currentStyle,playhead]);

  if(loading)return <div className="video-editor-loading"><Sparkles className="spin" size={20}/>Carregando Video Editor…</div>;

  if(draft&&timeline&&transcript){
    const currentSource=currentClip?.assetId?sourceMap.get(currentClip.assetId):null;
    return <div className="video-editor">
      <div className="video-editor-back"><button onClick={()=>{setDraft(null);setCurrent(null);setTimeline(null);setTranscript(null);setSources([]);setHistory([]);setActiveChapterId('');setSelectedClipId('');setPlaying(false);}}><ArrowLeft size={15}/>Projetos</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

      <section className="video-editor-hero">
        <div><span>VIDEO EDITOR</span><h2>{time(draft.durationSeconds)} · {draft.format.width}×{draft.format.height}</h2><p>Timeline v{draft.timelineVersion} · Transcript v{draft.transcriptVersion}</p></div>
        <div><em>{structuralIssues.length?structuralIssues.length+' BLOCKER(S)':'EDIT STRUCTURE OK'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save()}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="video-editor-message"><CheckCircle2 size={15}/>{message}</div>}

      <nav className="video-editor-tabs">
        <button className={tab==='editor'?'active':''} onClick={()=>setTab('editor')}><Eye size={15}/>Editor</button>
        <button className={tab==='captions'?'active':''} onClick={()=>setTab('captions')}><Captions size={15}/>Legendas</button>
        <button className={tab==='overlays'?'active':''} onClick={()=>setTab('overlays')}><Layers3 size={15}/>Overlays</button>
        <button className={tab==='audio'?'active':''} onClick={()=>setTab('audio')}><Volume2 size={15}/>Áudio</button>
        <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><CheckCircle2 size={15}/>Review</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      {chapters.length>0&&<section className="video-editor-chapters">
        <div className="video-section-head">
          <div><span>LONG-FORM CHAPTERS</span><h3>{chapters.length} capítulo(s) · clips, captions e mídia carregados por bloco.</h3></div>
          {activeChapter&&<small>{time(activeChapter.startSeconds)}–{time(activeChapter.endSeconds)} · {visualClips.length} clips · {visibleCaptions.length} captions</small>}
        </div>
        <div className="video-editor-chapter-list">{chapters.map(chapter=><button
          key={chapter.id}
          className={chapter.id===activeChapter?.id?'active':''}
          disabled={busy==='chapter:'+chapter.id}
          onClick={()=>void openChapter(chapter.id)}
        >
          <span>{String(chapter.sequence).padStart(2,'0')}</span>
          <strong>{chapter.label}</strong>
          <small>{time(chapter.startSeconds)}–{time(chapter.endSeconds)}</small>
          <em>{chapter.sceneIds.length} cenas</em>
        </button>)}</div>
      </section>}

      {tab==='editor'&&<div className="video-editor-content">
        <section className="video-preview-shell">
          <div className="video-preview-frame" style={{aspectRatio:draft.format.width+'/'+draft.format.height}}>
            <div className="video-preview-media" style={{transform:previewTransform}}>
              {currentSource?.signedUrl&&currentSource.kind==='image'?<img src={currentSource.signedUrl} alt=""/>:
               currentSource?.signedUrl&&currentSource.kind==='video'?<video src={currentSource.signedUrl} muted autoPlay={playing} loop playsInline/>:
               <div className="video-preview-missing"><AlertTriangle size={28}/>Preview indisponível</div>}
            </div>
            {currentCue&&<div className={'video-preview-caption '+draft.captions.position} style={{
              fontSize:Math.max(12,draft.captions.fontSize*.42),
              background:'rgba(0,0,0,'+draft.captions.backgroundOpacity+')',
              color:draft.captions.style.primaryColor,
              fontFamily:draft.captions.style.fontFamily,
              fontWeight:draft.captions.style.fontWeight,
              textTransform:draft.captions.style.uppercase?'uppercase':'none',
              WebkitTextStroke:Math.max(0,draft.captions.style.outlineWidth*.35)+'px '+draft.captions.style.outlineColor
            }}>{currentCue.words.length?currentCue.words.map((word,index)=>{
              const active=draft.captions.style.highlightMode==='active-word'&&playhead>=word.startSeconds&&playhead<word.endSeconds;
              const keyword=draft.captions.style.highlightMode==='keywords'&&word.highlighted;
              return <span key={word.id} style={{color:active||keyword?draft.captions.style.highlightColor:draft.captions.style.primaryColor}}>{index?' ':''}{word.text}</span>;
            }):currentCue.text}</div>}
            {currentOverlays.map(overlay=><div key={overlay.id} className="video-preview-overlay" style={{
              left:(overlay.x*100)+'%',top:(overlay.y*100)+'%',width:(overlay.width*100)+'%',height:(overlay.height*100)+'%',
              opacity:overlay.opacity,fontSize:Math.max(10,overlay.fontSize*.38)
            }}>{overlay.text}</div>)}
          </div>
          <div className="video-transport">
            <button onClick={()=>{if(playhead>=draft.durationSeconds)setPlayhead(0);setPlaying(v=>!v);}}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>
            <strong>{time(playhead)}</strong>
            <input type="range" min="0" max={draft.durationSeconds} step=".05" value={playhead} onChange={e=>{setPlaying(false);setPlayhead(Number(e.target.value));}}/>
            <span>{time(draft.durationSeconds)}</span>
          </div>
        </section>

        <section className="video-clip-strip">{visualClips.map(clip=>{
          const source=clip.assetId?sourceMap.get(clip.assetId):null;
          const style=draft.clipStyles.find(item=>item.timelineClipId===clip.id);
          return <button key={clip.id} className={selectedClipId===clip.id?'active':''} onClick={()=>{setSelectedClipId(clip.id);setPlayhead(clip.startSeconds);}}>
            <div>{source?.signedUrl&&source.kind==='image'?<img src={source.signedUrl} alt=""/>:source?.signedUrl&&source.kind==='video'?<video src={source.signedUrl} muted preload="metadata"/>:<Clapperboard size={19}/>}</div>
            <span>{time(clip.startSeconds)}–{time(clip.endSeconds)}</span>
            <strong>{style?.motionPreset??'none'}</strong>
          </button>;
        })}</section>

        {selectedStyle&&(()=>{
          const clip=visualClips.find(item=>item.id===selectedStyle.timelineClipId);
          return <section className="video-clip-inspector">
            <div className="video-section-head"><div><span>CLIP EFFECTS</span><h3>{clip?.label??'Clip'}</h3></div><small>{clip?clip.durationSeconds.toFixed(2)+'s':''}</small></div>
            <div className="video-grid three">
              <label>Motion<select value={selectedStyle.motionPreset} onChange={e=>setMotion(selectedStyle.timelineClipId,e.target.value as VideoEditMotionPreset)}><option value="none">None</option><option value="zoom-in">Zoom in</option><option value="zoom-out">Zoom out</option><option value="pan-left">Pan left</option><option value="pan-right">Pan right</option><option value="custom">Custom</option></select></label>
              <label>Transition in<select value={selectedStyle.transitionIn} onChange={e=>updateStyle(selectedStyle.timelineClipId,{transitionIn:e.target.value as VideoEditClipStyle['transitionIn']})}><option value="none">None</option><option value="fade">Fade</option><option value="cross-dissolve">Cross dissolve</option></select></label>
              <label>Transition out<select value={selectedStyle.transitionOut} onChange={e=>updateStyle(selectedStyle.timelineClipId,{transitionOut:e.target.value as VideoEditClipStyle['transitionOut']})}><option value="none">None</option><option value="fade">Fade</option><option value="cross-dissolve">Cross dissolve</option></select></label>
              <label>Transition seconds<input type="number" min="0" max={Math.max(0,(clip?.durationSeconds??0)/2)} step=".05" value={selectedStyle.transitionSeconds} onChange={e=>updateStyle(selectedStyle.timelineClipId,{transitionSeconds:Number(e.target.value)})}/></label>
              <label>Scale start<input type="number" min="1" max="5" step=".01" value={selectedStyle.scaleStart} onChange={e=>updateStyle(selectedStyle.timelineClipId,{motionPreset:'custom',scaleStart:Number(e.target.value)})}/></label>
              <label>Scale end<input type="number" min="1" max="5" step=".01" value={selectedStyle.scaleEnd} onChange={e=>updateStyle(selectedStyle.timelineClipId,{motionPreset:'custom',scaleEnd:Number(e.target.value)})}/></label>
            </div>
          </section>;
        })()}
      </div>}

      {tab==='captions'&&<div className="video-editor-content">
        <section className="video-settings-card">
          <div className="video-section-head"><div><span>CAPTION SYSTEM</span><h3>Estilo do canal + word timing + destaque.</h3><p>{draft.captions.styleDescription||'Sem descrição de estilo no Production DNA.'} · exibindo {visibleCaptions.length} de {draft.captions.cues.length} captions.</p></div><label className="video-toggle"><input type="checkbox" checked={draft.captions.enabled} onChange={e=>setDraft({...draft,captions:{...draft.captions,enabled:e.target.checked}})}/><span>Ativas</span></label></div>
          <div className="video-grid four">
            <label>Posição<select value={draft.captions.position} onChange={e=>setDraft({...draft,captions:{...draft.captions,position:e.target.value as VideoEditPayload['captions']['position']}})}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
            <label>Font size<input type="number" min="10" max="160" value={draft.captions.fontSize} onChange={e=>setDraft({...draft,captions:{...draft.captions,fontSize:Number(e.target.value)}})}/></label>
            <label>Max lines<input type="number" min="1" max="6" value={draft.captions.maxLines} onChange={e=>setDraft({...draft,captions:{...draft.captions,maxLines:Number(e.target.value)}})}/></label>
            <label>Background<input type="number" min="0" max="1" step=".05" value={draft.captions.backgroundOpacity} onChange={e=>setDraft({...draft,captions:{...draft.captions,backgroundOpacity:Number(e.target.value)}})}/></label>
            <label>Font family<input value={draft.captions.style.fontFamily} onChange={e=>updateCaptionStyle({fontFamily:e.target.value})}/></label>
            <label>Weight<select value={draft.captions.style.fontWeight} onChange={e=>updateCaptionStyle({fontWeight:Number(e.target.value) as VideoEditPayload['captions']['style']['fontWeight']})}><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option><option value="900">900</option></select></label>
            <label>Highlight<select value={draft.captions.style.highlightMode} onChange={e=>updateCaptionStyle({highlightMode:e.target.value as VideoEditPayload['captions']['style']['highlightMode']})}><option value="none">None</option><option value="keywords">Keywords</option><option value="active-word">Active word</option></select></label>
            <label>Words / line<input type="number" min="2" max="20" value={draft.captions.style.maxWordsPerLine} onChange={e=>updateCaptionStyle({maxWordsPerLine:Number(e.target.value)})}/></label>
            <label>Primary color<input type="color" value={draft.captions.style.primaryColor} onChange={e=>updateCaptionStyle({primaryColor:e.target.value.toUpperCase()})}/></label>
            <label>Highlight color<input type="color" value={draft.captions.style.highlightColor} onChange={e=>updateCaptionStyle({highlightColor:e.target.value.toUpperCase()})}/></label>
            <label>Outline color<input type="color" value={draft.captions.style.outlineColor} onChange={e=>updateCaptionStyle({outlineColor:e.target.value.toUpperCase()})}/></label>
            <label>Outline width<input type="number" min="0" max="12" step=".5" value={draft.captions.style.outlineWidth} onChange={e=>updateCaptionStyle({outlineWidth:Number(e.target.value)})}/></label>
            <label>Safe margin %<input type="number" min="0" max="25" step=".5" value={draft.captions.style.safeMarginPercent} onChange={e=>updateCaptionStyle({safeMarginPercent:Number(e.target.value)})}/></label>
          </div>
          <div className="video-caption-toggles">
            <label className="video-check"><input type="checkbox" checked={draft.captions.style.smartBreaks} onChange={e=>updateCaptionStyle({smartBreaks:e.target.checked})}/><span>Quebras inteligentes</span></label>
            <label className="video-check"><input type="checkbox" checked={draft.captions.style.uppercase} onChange={e=>updateCaptionStyle({uppercase:e.target.checked})}/><span>Uppercase</span></label>
          </div>
        </section>
        <div className="video-caption-list">{visibleCaptions.map(cue=><article key={cue.id}>
          <div><strong>{time(cue.startSeconds)} → {time(cue.endSeconds)}</strong><small>{cue.transcriptSegmentId.slice(0,8)}</small></div>
          <div className="video-caption-edit">
            <textarea rows={2} value={cue.text} onChange={e=>setDraft({...draft,captions:{...draft.captions,cues:draft.captions.cues.map(item=>item.id===cue.id?{...item,text:e.target.value}:item)}})}/>
            {!!cue.words.length&&<div className="video-caption-words">{cue.words.map(word=><button key={word.id} className={word.highlighted?'active':''} onClick={()=>toggleCaptionWord(cue.id,word.id)} title={time(word.startSeconds)+' → '+time(word.endSeconds)}>{word.text}</button>)}</div>}
          </div>
        </article>)}</div>
      </div>}

      {tab==='overlays'&&<div className="video-editor-content">
        <div className="video-section-head"><div><span>TEXT OVERLAYS</span><h3>Elementos temporais sobre o vídeo.</h3></div><button className="button primary small" onClick={addOverlay}><Plus size={14}/>Novo overlay</button></div>
        <div className="video-overlay-list">{draft.overlays.map(overlay=><article key={overlay.id}>
          <div className="video-overlay-head"><strong>{time(overlay.startSeconds)} → {time(overlay.endSeconds)}</strong><button onClick={()=>setDraft({...draft,overlays:draft.overlays.filter(item=>item.id!==overlay.id)})}><Trash2 size={14}/></button></div>
          <label>Texto<input value={overlay.text} onChange={e=>updateOverlay(overlay.id,{text:e.target.value})}/></label>
          <div className="video-grid four">
            <label>Start<input type="number" min="0" max={draft.durationSeconds} step=".05" value={overlay.startSeconds} onChange={e=>updateOverlay(overlay.id,{startSeconds:Number(e.target.value)})}/></label>
            <label>End<input type="number" min="0" max={draft.durationSeconds} step=".05" value={overlay.endSeconds} onChange={e=>updateOverlay(overlay.id,{endSeconds:Number(e.target.value)})}/></label>
            <label>Font<input type="number" min="10" max="200" value={overlay.fontSize} onChange={e=>updateOverlay(overlay.id,{fontSize:Number(e.target.value)})}/></label>
            <label>Opacity<input type="number" min="0" max="1" step=".05" value={overlay.opacity} onChange={e=>updateOverlay(overlay.id,{opacity:Number(e.target.value)})}/></label>
          </div>
        </article>)}</div>
        {!draft.overlays.length&&<div className="video-empty-inline">Nenhum overlay. Posicione o playhead e crie um texto quando precisar.</div>}
      </div>}

      {tab==='audio'&&<div className="video-editor-content">
        <section className="video-settings-card">
          <div className="video-section-head"><div><span>AUDIO MIX</span><h3>Narração, música e efeitos.</h3><p>Volumes globais são multiplicados pelos volumes de cada faixa/evento no render.</p></div><Volume2 size={21}/></div>
          <div className="video-grid three">
            <label>Voice volume<input type="number" min="0" max="2" step=".05" value={draft.audioMix.voiceVolume} onChange={e=>setDraft({...draft,audioMix:{...draft.audioMix,voiceVolume:Number(e.target.value)}})}/></label>
            <label>Music master<input type="number" min="0" max="2" step=".05" value={draft.audioMix.musicVolume} onChange={e=>setDraft({...draft,audioMix:{...draft.audioMix,musicVolume:Number(e.target.value)}})}/></label>
            <label>SFX master<input type="number" min="0" max="2" step=".05" value={draft.audioMix.sfxVolume} onChange={e=>setDraft({...draft,audioMix:{...draft.audioMix,sfxVolume:Number(e.target.value)}})}/></label>
          </div>
          <label className="video-check"><input type="checkbox" checked={draft.audioMix.normalizeVoice} onChange={e=>setDraft({...draft,audioMix:{...draft.audioMix,normalizeVoice:e.target.checked}})}/><span>Normalizar narração no render</span></label>
          <label className="video-check"><input type="checkbox" checked={draft.audioMix.duckMusicUnderVoice} onChange={e=>setDraft({...draft,audioMix:{...draft.audioMix,duckMusicUnderVoice:e.target.checked}})}/><span>Permitir ducking de música durante a voz</span></label>
        </section>

        <section className="video-settings-card">
          <div className="video-section-head"><div><span>MUSIC TRACK</span><h3>Trilha principal do episódio.</h3></div><label className="video-audio-upload">Upload music<input type="file" accept="audio/*" disabled={busy==='audio-upload'} onChange={e=>{void uploadAudio('music',e.target.files?.[0]??null);e.currentTarget.value='';}}/></label></div>
          <div className="video-grid three">
            <label>Asset<select value={draft.musicTrack?.assetId??''} onChange={e=>selectMusic(e.target.value)}><option value="">Sem música</option>{musicAssets.map(asset=><option key={asset.id} value={asset.id}>{asset.originalName??asset.id.slice(0,8)} · {asset.durationSeconds?time(asset.durationSeconds):'?'}</option>)}</select></label>
            {draft.musicTrack&&<><label>Track volume<input type="number" min="0" max="2" step=".05" value={draft.musicTrack.volume} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,volume:Number(e.target.value)}})}/></label>
            <label>Ducking strength<input type="number" min="0" max="1" step=".05" value={draft.musicTrack.duckingStrength} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,duckingStrength:Number(e.target.value)}})}/></label>
            <label>Start<input type="number" min="0" max={draft.durationSeconds} step=".05" value={draft.musicTrack.startSeconds} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,startSeconds:Number(e.target.value)}})}/></label>
            <label>End<input type="number" min="0" max={draft.durationSeconds} step=".05" value={draft.musicTrack.endSeconds} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,endSeconds:Number(e.target.value)}})}/></label>
            <label>Source start<input type="number" min="0" step=".05" value={draft.musicTrack.sourceStartSeconds} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,sourceStartSeconds:Number(e.target.value)}})}/></label>
            <label>Fade in<input type="number" min="0" max="60" step=".1" value={draft.musicTrack.fadeInSeconds} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,fadeInSeconds:Number(e.target.value)}})}/></label>
            <label>Fade out<input type="number" min="0" max="60" step=".1" value={draft.musicTrack.fadeOutSeconds} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,fadeOutSeconds:Number(e.target.value)}})}/></label></>}
          </div>
          {draft.musicTrack&&<div className="video-caption-toggles"><label className="video-check"><input type="checkbox" checked={draft.musicTrack.loop} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,loop:e.target.checked}})}/><span>Loop</span></label><label className="video-check"><input type="checkbox" checked={draft.musicTrack.duckUnderVoice} onChange={e=>setDraft({...draft,musicTrack:{...draft.musicTrack!,duckUnderVoice:e.target.checked}})}/><span>Duck under voice</span></label></div>}
          {!musicAssets.length&&<div className="video-empty-inline">Nenhuma música na Audio Library deste canal.</div>}
        </section>

        <section className="video-settings-card">
          <div className="video-section-head"><div><span>SFX EVENTS</span><h3>Efeitos pontuais na timeline.</h3><p>Posicione o playhead para adicionar manualmente ou use Auto SFX.</p></div><div className="video-audio-actions"><button className="button subtle small" disabled={!sfxAssets.length} onClick={autoSfx}><Sparkles size={13}/>Auto SFX</button><label className="video-audio-upload">Upload SFX<input type="file" accept="audio/*" disabled={busy==='audio-upload'} onChange={e=>{void uploadAudio('sfx',e.target.files?.[0]??null);e.currentTarget.value='';}}/></label></div></div>
          <div className="video-sfx-add"><select defaultValue="" onChange={e=>{addSfx(e.target.value);e.currentTarget.value='';}}><option value="">Adicionar SFX no playhead ({time(playhead)})</option>{sfxAssets.map(asset=><option key={asset.id} value={asset.id}>{asset.originalName??asset.id.slice(0,8)} · {(asset.tags??[]).join(', ')}</option>)}</select></div>
          <div className="video-sfx-list">{draft.sfxEvents.map(event=>{
            const asset=audioAssets.find(item=>item.id===event.assetId);
            return <article key={event.id}><div><strong>{event.eventType}</strong><span>{asset?.originalName??event.assetId.slice(0,8)}</span></div><div className="video-grid four"><label>Start<input type="number" min="0" max={draft.durationSeconds} step=".05" value={event.startSeconds} onChange={e=>setDraft({...draft,sfxEvents:draft.sfxEvents.map(item=>item.id===event.id?{...item,startSeconds:Number(e.target.value)}:item)})}/></label><label>Duration<input type="number" min=".01" max="300" step=".05" value={event.durationSeconds} onChange={e=>setDraft({...draft,sfxEvents:draft.sfxEvents.map(item=>item.id===event.id?{...item,durationSeconds:Number(e.target.value)}:item)})}/></label><label>Volume<input type="number" min="0" max="2" step=".05" value={event.volume} onChange={e=>setDraft({...draft,sfxEvents:draft.sfxEvents.map(item=>item.id===event.id?{...item,volume:Number(e.target.value)}:item)})}/></label><label>Source start<input type="number" min="0" step=".05" value={event.sourceStartSeconds} onChange={e=>setDraft({...draft,sfxEvents:draft.sfxEvents.map(item=>item.id===event.id?{...item,sourceStartSeconds:Number(e.target.value)}:item)})}/></label></div><button className="button subtle small" onClick={()=>setDraft({...draft,sfxEvents:draft.sfxEvents.filter(item=>item.id!==event.id)})}><Trash2 size={13}/>Remover</button></article>;
          })}</div>
          {!sfxAssets.length&&<div className="video-empty-inline">Nenhum SFX na Audio Library. Faça upload e use tags como transition, whoosh, pop ou emphasis para automação.</div>}
        </section>
      </div>}

      {tab==='review'&&<div className="video-editor-content">
        <section className={structuralIssues.length?'video-review blocked':'video-review ready'}>
          {structuralIssues.length?<AlertTriangle size={30}/>:<CheckCircle2 size={30}/>}
          <div><span>VIDEO EDIT GATE</span><h3>{structuralIssues.length?'Ainda existem bloqueios editoriais.':'Projeto editorial consistente.'}</h3><p>A aprovação também é revalidada no servidor contra as versões atuais de Timeline e Transcript.</p></div>
        </section>
        {structuralIssues.length>0&&<div className="video-issues">{structuralIssues.map(issue=><span key={issue}>{issue}</span>)}</div>}
        <label className="video-review-notes"><span>NOTAS DE REVIEW</span><textarea rows={5} value={draft.review.notes} onChange={e=>setDraft({...draft,review:{notes:e.target.value}})}/></label>
        <div className="video-review-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={structuralIssues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={15}/>Aprovar para render</button></div>
      </div>}

      {tab==='history'&&<div className="video-editor-content"><div className="video-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · {item.payload.clipStyles.length} clip styles · {item.payload.captions.cues.length} captions</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('editor');setMessage('Versão '+item.version+' carregada no editor.');}}>Carregar</button></article>)}</div></div>}
    </div>;
  }

  return <div className="video-editor-list">
    {message&&<div className="video-editor-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="video-editor-list-hero"><div><span>VIDEO EDITOR</span><h2>A camada editorial final antes do render.</h2><p>Transições, movimento, legendas, overlays e mix são aplicados sem alterar a Timeline ou os assets originais.</p></div></section>

    {eligibleTimelines.length>0&&<section className="video-ready">
      <div className="video-section-head"><div><span>READY TO EDIT</span><h3>Timelines aprovadas esperando edição.</h3></div><Clapperboard size={21}/></div>
      {eligibleTimelines.map(item=><article key={item.id}><div><strong>{time(item.durationSeconds)} · {item.format.width}×{item.format.height}</strong><p>Timeline v{item.version}</p></div><button className="button primary small" disabled={!!busy} onClick={()=>void create(item.id)}>{busy==='create:'+item.id?'Criando…':'Abrir no editor'}</button></article>)}
    </section>}

    <section className="video-project-grid">{edits.map(item=><article key={item.id}><div><span>{item.status}</span><em>v{item.version}</em></div><h3>{item.clipStyles.length} clips</h3><p>{time(item.durationSeconds)} · {item.captions.cues.length} captions</p><small>{item.overlays.length} overlay(s)</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openEdit(item.id)}>Editar projeto</button></article>)}</section>

    {!edits.length&&!eligibleTimelines.length&&<div className="video-editor-empty"><Clapperboard size={28}/><h3>Nenhuma Timeline aprovada pronta.</h3><p>Finalize e aprove uma Timeline antes de iniciar a edição.</p></div>}
  </div>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clapperboard, History,
  Image as ImageIcon, Save, Sparkles, Video, Volume2
} from 'lucide-react';
import type {
  ManagedChannel, ScenePlan, Timeline, TimelineChapterStatus, TimelineClip, TimelinePayload,
  TimelineVersion
} from '@/lib/types';
import {
  normalizeTimeline, timelineChapters, timelineHealth, timelineStructuralIssues
} from '@/lib/timeline-policy';

type Source={
  assetId:string;
  kind:'image'|'video'|'audio';
  signedUrl:string|null;
  mimeType:string;
  title:string;
};
type Tab='timeline'|'review'|'history';
type TimelineView=Timeline&{stale?:boolean;staleReason?:string};
type ScenePlanView=ScenePlan&{stale?:boolean;staleReason?:string};

function time(value:number){
  const m=Math.floor(value/60);
  const s=(value%60).toFixed(2).padStart(5,'0');
  return String(m).padStart(2,'0')+':'+s;
}
function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:Timeline):TimelinePayload{const {version:_version,status:_status,...payload}=value;return payload;}

export default function TimelineEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [timelines,setTimelines]=useState<TimelineView[]>([]);
  const [scenePlans,setScenePlans]=useState<ScenePlanView[]>([]);
  const [current,setCurrent]=useState<Timeline|null>(null);
  const [draft,setDraft]=useState<TimelinePayload|null>(null);
  const [scenePlan,setScenePlan]=useState<ScenePlan|null>(null);
  const [sources,setSources]=useState<Source[]>([]);
  const [history,setHistory]=useState<TimelineVersion[]>([]);
  const [selectedClipId,setSelectedClipId]=useState('');
  const [activeChapterId,setActiveChapterId]=useState('');
  const [tab,setTab]=useState<Tab>('timeline');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const timelinePlanIds=useMemo(()=>new Set(timelines.map(item=>item.scenePlanId)),[timelines]);
  const eligiblePlans=useMemo(()=>scenePlans.filter(item=>!item.stale&&!timelinePlanIds.has(item.id)),[scenePlans,timelinePlanIds]);
  const sourceMap=useMemo(()=>new Map(sources.map(source=>[source.assetId,source])),[sources]);
  const voiceSource=useMemo(()=>{
    const voiceClip=draft?.tracks.find(track=>track.type==='voice')?.clips[0];
    return voiceClip?.assetId?sourceMap.get(voiceClip.assetId)??null:null;
  },[draft,sourceMap]);
  const chapters=useMemo(()=>draft?timelineChapters(draft):[],[draft]);
  const activeChapter=useMemo(
    ()=>chapters.find(chapter=>chapter.id===activeChapterId)??chapters[0]??null,
    [chapters,activeChapterId]
  );
  const health=useMemo(()=>draft?timelineHealth(draft):null,[draft]);
  const structuralIssues=useMemo(()=>draft&&scenePlan?timelineStructuralIssues(normalizeTimeline(draft),scenePlan):[],[draft,scenePlan]);
  const dirty=useMemo(()=>{
    if(!draft)return false;
    if(!current)return true;
    const left=normalizeTimeline(draft);
    const right=normalizeTimeline(payloadOnly(current));
    return JSON.stringify({...left,updatedAt:''})!==JSON.stringify({...right,updatedAt:''});
  },[draft,current]);
  const selectedClip=useMemo(()=>{
    if(!draft)return null;
    for(const track of draft.tracks){
      const clip=track.clips.find(item=>item.id===selectedClipId);
      if(clip)return {track,clip};
    }
    return null;
  },[draft,selectedClipId]);

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/timeline-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Timeline Engine.');
      setTimelines(body.timelines??[]);
      setScenePlans(body.scenePlans??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Timeline Engine.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  async function openTimeline(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch('/api/timeline-engine?timelineId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir Timeline.');
      setCurrent(body.timeline);
      setDraft(payloadOnly(body.timeline));
      setScenePlan(body.scenePlan??null);
      setSources(body.sources??[]);
      setHistory(body.history??[]);
      const opened=body.timeline as Timeline;
      const openedChapters=timelineChapters(opened);
      const chapterId=String(body.activeChapterId??openedChapters[0]?.id??'');
      setActiveChapterId(chapterId);
      const chapter=openedChapters.find(item=>item.id===chapterId)??openedChapters[0];
      const sceneIds=new Set(chapter?.sceneIds??[]);
      setSelectedClipId(opened.tracks.find((track:Timeline['tracks'][number])=>track.type==='visual')?.clips.find(
        (clip:TimelineClip)=>Boolean(clip.sceneId&&sceneIds.has(clip.sceneId))
      )?.id??'');
      setTab('timeline');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Timeline.');}
    finally{setBusy('');}
  }

  async function create(scenePlanId:string){
    setBusy('create:'+scenePlanId);setMessage('');
    try{
      const res=await fetch('/api/timeline-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'create',scenePlanId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao criar Timeline.');
      setTimelines(prev=>[body.timeline,...prev.filter(item=>item.id!==body.timeline.id)]);
      setMessage(body.message??'Timeline criada.');
      await openTimeline(body.timeline.id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Timeline.');}
    finally{setBusy('');}
  }

  async function save(status:Timeline['status']='draft',payload=draft){
    if(!payload)return false;
    setBusy('save');setMessage('');
    try{
      const normalized=normalizeTimeline(payload);
      const res=await fetch('/api/timeline-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'save',expectedVersion:current?.version??0,status,
          chapterId:activeChapter?.id,
          timeline:normalized
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Timeline.');
      setCurrent(body.timeline);
      setDraft(payloadOnly(body.timeline));
      setHistory(body.history??[]);
      setSources(body.sources??sources);
      setActiveChapterId(String(body.activeChapterId??activeChapter?.id??''));
      setTimelines(prev=>[body.timeline,...prev.filter(item=>item.id!==body.timeline.id)]);
      setMessage(body.message??'Timeline salva.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Timeline.');return false;}
    finally{setBusy('');}
  }

  function updateClip(trackId:string,clipId:string,patch:Partial<TimelineClip>){
    setDraft(prev=>{
      if(!prev)return prev;
      return normalizeTimeline({...prev,tracks:prev.tracks.map(track=>track.id===trackId?{
        ...track,
        clips:track.clips.map(clip=>clip.id===clipId?{...clip,...patch}:clip)
      }:track)});
    });
  }

  function updateChapterStatus(status:TimelineChapterStatus){
    if(!activeChapter)return;
    setDraft(prev=>{
      if(!prev)return prev;
      const now=new Date().toISOString();
      return normalizeTimeline({
        ...prev,
        chapters:timelineChapters(prev).map(chapter=>chapter.id===activeChapter.id
          ?{...chapter,status,updatedAt:now}
          :chapter)
      });
    });
  }

  async function openChapter(chapterId:string){
    if(!current||chapterId===activeChapterId)return;
    setBusy('chapter:'+chapterId);setMessage('');
    try{
      const res=await fetch(
        '/api/timeline-engine?timelineId='+encodeURIComponent(current.id)+
        '&chapterId='+encodeURIComponent(chapterId),
        {cache:'no-store'}
      );
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar capítulo.');
      setSources(body.sources??[]);
      setActiveChapterId(chapterId);
      const chapter=timelineChapters(draft??current).find(item=>item.id===chapterId);
      const sceneIds=new Set(chapter?.sceneIds??[]);
      const visual=(draft??current).tracks.find(track=>track.type==='visual');
      setSelectedClipId(visual?.clips.find(clip=>Boolean(clip.sceneId&&sceneIds.has(clip.sceneId)))?.id??'');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar capítulo.');}
    finally{setBusy('');}
  }

  async function refreshChapter(){
    if(!current||!activeChapter)return;
    if(dirty){
      setMessage('Salve a Timeline antes de reprocessar o capítulo.');
      return;
    }
    setBusy('refresh-chapter');setMessage('');
    try{
      const res=await fetch('/api/timeline-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'refresh-chapter',
          timelineId:current.id,
          chapterId:activeChapter.id
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao reprocessar capítulo.');
      setCurrent(body.timeline);
      setDraft(payloadOnly(body.timeline));
      setHistory(body.history??[]);
      setSources(body.sources??[]);
      setActiveChapterId(String(body.activeChapterId??activeChapter.id));
      setTimelines(prev=>[body.timeline,...prev.filter(item=>item.id!==body.timeline.id)]);
      setMessage(body.message??'Capítulo reprocessado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao reprocessar capítulo.');}
    finally{setBusy('');}
  }

  if(loading)return <div className="timeline-loading"><Sparkles className="spin" size={20}/>Carregando Timeline Engine…</div>;

  if(draft&&scenePlan){
    const chapterStart=activeChapter?.startSeconds??0;
    const chapterEnd=activeChapter?.endSeconds??draft.durationSeconds;
    const chapterDuration=Math.max(.01,chapterEnd-chapterStart);
    const chapterSceneIds=new Set(activeChapter?.sceneIds??[]);
    const canvasWidth=Math.max(1000,Math.min(6000,chapterDuration*18));
    return <div className="timeline-editor">
      <div className="timeline-back"><button onClick={()=>{setDraft(null);setCurrent(null);setScenePlan(null);setSources([]);setHistory([]);setSelectedClipId('');setActiveChapterId('');}}><ArrowLeft size={15}/>Todas as timelines</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

      <section className="timeline-hero">
        <div><span>TIMELINE ENGINE</span><h2>{time(draft.durationSeconds)} · {draft.format.width}×{draft.format.height} · {draft.format.fps}fps</h2><p>Scene Plan v{draft.scenePlanVersion} · Visual Prompt v{draft.visualPromptSetVersion} · {voiceSource?.title??'Narração vinculada'}</p></div>
        <div><em>{structuralIssues.length?structuralIssues.length+' BLOCKER(S)':'STRUCTURE OK'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save('draft')}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="timeline-message"><CheckCircle2 size={15}/>{message}</div>}

      <nav className="timeline-tabs">
        <button className={tab==='timeline'?'active':''} onClick={()=>setTab('timeline')}><Clapperboard size={15}/>Timeline</button>
        <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><CheckCircle2 size={15}/>Review</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      <section className="timeline-chapters">
        <div className="timeline-section-head">
          <div><span>LONG-FORM CHAPTERS</span><h3>{chapters.length} capítulo(s) · apenas o capítulo ativo carrega mídia.</h3></div>
          {activeChapter&&<div className="timeline-chapter-actions">
            <button className="button subtle small" disabled={!!busy||dirty} onClick={()=>void refreshChapter()}>
              {busy==='refresh-chapter'?'Reprocessando…':'Reprocessar capítulo'}
            </button>
            <button className="button subtle small" onClick={()=>updateChapterStatus('review')}>Em revisão</button>
            <button className="button subtle small" onClick={()=>updateChapterStatus('approved')}><CheckCircle2 size={14}/>Aprovar capítulo</button>
          </div>}
        </div>
        <div className="timeline-chapter-list">{chapters.map(chapter=>{
          const metric=health?.chapters.find(item=>item.chapterId===chapter.id);
          return <button key={chapter.id} className={chapter.id===activeChapter?.id?'active':''} disabled={busy==='chapter:'+chapter.id} onClick={()=>void openChapter(chapter.id)}>
            <span>{String(chapter.sequence).padStart(2,'0')}</span>
            <strong>{chapter.label}</strong>
            <small>{time(chapter.startSeconds)}–{time(chapter.endSeconds)} · {metric?.clipCount??chapter.sceneIds.length} clips</small>
            <em>{chapter.status}</em>
          </button>;
        })}</div>
        {health&&<div className="timeline-density-map" aria-label="Mapa global de densidade visual">
          {health.chapters.map(metric=><div key={metric.chapterId} title={'Capítulo '+metric.sequence+' · '+metric.cutsPerMinute.toFixed(1)+' cortes/min'}>
            <span style={{height:Math.max(8,Math.min(100,metric.cutsPerMinute*5))+'%'}}/>
            <small>{metric.cutsPerMinute.toFixed(1)}</small>
          </div>)}
        </div>}
      </section>

      {tab==='timeline'&&<div className="timeline-content">
        <section className="timeline-stage">
          <div className="timeline-stage-preview">
            {selectedClip?.clip.assetId&&sourceMap.get(selectedClip.clip.assetId)?.signedUrl
              ?<MediaPreview source={sourceMap.get(selectedClip.clip.assetId)!}/>
              :<div className="timeline-placeholder-preview"><AlertTriangle size={28}/><span>{selectedClip?.clip.label??'Selecione um clip'}</span></div>}
          </div>
          {selectedClip&&<div className="timeline-inspector">
            <span>CLIP INSPECTOR</span><h3>{selectedClip.clip.label}</h3>
            <div className="timeline-inspector-times"><strong>{time(selectedClip.clip.startSeconds)}</strong><em>→</em><strong>{time(selectedClip.clip.endSeconds)}</strong><small>{selectedClip.clip.durationSeconds.toFixed(2)}s</small></div>
            {selectedClip.track.type==='visual'&&selectedClip.clip.clipKind!=='placeholder'&&<>
              <label>Fit<select value={selectedClip.clip.fit} onChange={e=>updateClip(selectedClip.track.id,selectedClip.clip.id,{fit:e.target.value as TimelineClip['fit']})}><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></label>
              {selectedClip.clip.clipKind==='video'&&<div className="timeline-inspector-grid">
                <label>Playback<select value={selectedClip.clip.playback} onChange={e=>updateClip(selectedClip.track.id,selectedClip.clip.id,{playback:e.target.value as TimelineClip['playback']})}><option value="trim">Trim</option><option value="loop">Loop</option></select></label>
                <label>Source start<input type="number" min="0" step=".01" value={selectedClip.clip.sourceStartSeconds??0} onChange={e=>updateClip(selectedClip.track.id,selectedClip.clip.id,{sourceStartSeconds:Number(e.target.value)})}/></label>
                <label>Source end<input type="number" min="0" step=".01" value={selectedClip.clip.sourceEndSeconds??selectedClip.clip.durationSeconds} onChange={e=>updateClip(selectedClip.track.id,selectedClip.clip.id,{sourceEndSeconds:Number(e.target.value)})}/></label>
              </div>}
            </>}
          </div>}
        </section>

        <section className="timeline-scroll">
          <div className="timeline-canvas" style={{width:canvasWidth}}>
            <div className="timeline-ruler">{Array.from({length:Math.ceil(chapterDuration/10)+1},(_,i)=>{
              const offset=Math.min(chapterDuration,i*10);
              return <span key={i} style={{left:(offset/chapterDuration*100)+'%'}}>{time(chapterStart+offset)}</span>;
            })}</div>
            {draft.tracks.filter(track=>track.type==='visual'||track.type==='voice').map(track=>{
              const visibleClips=track.clips.filter(clip=>
                track.type==='voice'
                  ?clip.endSeconds>chapterStart&&clip.startSeconds<chapterEnd
                  :Boolean(clip.sceneId&&chapterSceneIds.has(clip.sceneId))
              );
              return <div className={'timeline-track '+track.type} key={track.id}>
                <div className="timeline-track-label">{track.type==='visual'?<ImageIcon size={15}/>:<Volume2 size={15}/>}<span>{track.name}</span>{track.locked&&<small>LOCKED</small>}</div>
                <div className="timeline-track-lane">{visibleClips.map(clip=>{
                  const visibleStart=Math.max(chapterStart,clip.startSeconds);
                  const visibleEnd=Math.min(chapterEnd,clip.endSeconds);
                  const left=(visibleStart-chapterStart)/chapterDuration*100;
                  const width=Math.max(.2,(visibleEnd-visibleStart)/chapterDuration*100);
                  return <button key={clip.id} style={{left:left+'%',width:width+'%'}} className={'timeline-clip '+clip.clipKind+(selectedClipId===clip.id?' selected':'')} onClick={()=>setSelectedClipId(clip.id)}>
                    {clip.clipKind==='image'?<ImageIcon size={14}/>:
                     clip.clipKind==='video'?<Video size={14}/>:
                     clip.clipKind==='audio'?<Volume2 size={14}/>:
                     <AlertTriangle size={14}/>}
                    <span>{clip.label}</span>
                  </button>;
                })}</div>
              </div>;
            })}
          </div>
        </section>
      </div>}

      {tab==='review'&&<div className="timeline-content">
        <section className={structuralIssues.length?'timeline-review blocked':'timeline-review ready'}>
          {structuralIssues.length?<AlertTriangle size={30}/>:<CheckCircle2 size={30}/>}
          <div><span>TIMELINE GATE</span><h3>{structuralIssues.length?'A estrutura ainda tem bloqueios.':'Estrutura temporal consistente.'}</h3><p>A aprovação final também valida se os assets continuam selecionados, ready e não-stale.</p></div>
        </section>
        {structuralIssues.length>0&&<div className="timeline-issues">{structuralIssues.map(issue=><span key={issue}>{issue}</span>)}</div>}
        {health&&<section className="timeline-health-grid">
          <div><strong>{(health.coverageRatio*100).toFixed(1)}%</strong><small>cobertura visual</small></div>
          <div><strong>{health.cutsPerMinute.toFixed(1)}</strong><small>cortes/min</small></div>
          <div><strong>{(health.uniqueAssetRatio*100).toFixed(0)}%</strong><small>origens únicas</small></div>
          <div><strong>{health.repeatedAssetCount}</strong><small>repetições</small></div>
          <div><strong>{health.longStaticImageCount}</strong><small>imagens &gt;15s</small></div>
          <div><strong>{health.excessiveCutCount}</strong><small>cortes &lt;1,5s</small></div>
        </section>}
        {activeChapter&&<label className="timeline-notes"><span>REVIEW DO CAPÍTULO {activeChapter.sequence}</span><textarea rows={3} value={activeChapter.reviewNotes} onChange={e=>setDraft(prev=>prev?normalizeTimeline({...prev,chapters:timelineChapters(prev).map(chapter=>chapter.id===activeChapter.id?{...chapter,reviewNotes:e.target.value,updatedAt:new Date().toISOString()}:chapter)}):prev)}/></label>}
        <label className="timeline-notes"><span>NOTAS DE REVIEW MASTER</span><textarea rows={5} value={draft.review.notes} onChange={e=>setDraft({...draft,review:{notes:e.target.value}})}/></label>
        <div className="timeline-approval-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={structuralIssues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={16}/>Aprovar Timeline</button></div>
      </div>}

      {tab==='history'&&<div className="timeline-content"><div className="timeline-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · {item.payload.tracks.find(track=>track.type==='visual')?.clips.length??0} clips · {time(item.payload.durationSeconds)}</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('timeline');setMessage('Versão '+item.version+' carregada no editor.');}}>Carregar</button></article>)}</div></div>}
    </div>;
  }

  return <div className="timeline-engine">
    {message&&<div className="timeline-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="timeline-list-hero"><div><span>TIMELINE ENGINE</span><h2>Do Scene Plan para um projeto de edição real.</h2><p>Assets selecionados viram clips sincronizados com a narração. Placeholders permanecem explícitos até a mídia estar pronta.</p></div></section>

    {eligiblePlans.length>0&&<section className="timeline-ready">
      <div className="timeline-section-head"><div><span>READY FOR TIMELINE</span><h3>Scene Plans aprovados esperando projeto de edição.</h3></div><Clapperboard size={21}/></div>
      {eligiblePlans.map(plan=><article key={plan.id}><div><strong>Take {plan.voiceTake} · {plan.scenes.length} cenas</strong><p>{time(plan.audioDurationSeconds)} · Scene Plan v{plan.version}</p></div><button className="button primary small" disabled={!!busy} onClick={()=>void create(plan.id)}>{busy==='create:'+plan.id?'Criando…':'Criar Timeline'}</button></article>)}
    </section>}

    <section className="timeline-project-grid">{timelines.map(item=>{
      const visuals=item.tracks.find(track=>track.type==='visual')?.clips??[];
      const placeholders=visuals.filter(clip=>clip.clipKind==='placeholder').length;
      return <article key={item.id}><div><span>{item.stale?'stale':item.status}</span><em>v{item.version}</em></div><h3>{visuals.length} cenas</h3><p>{time(item.durationSeconds)} · {item.format.width}×{item.format.height}</p><small>{item.stale?'Take de voz mudou · reconstrução necessária':placeholders?placeholders+' placeholder(s)':'mídia completa'}</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openTimeline(item.id)}>Abrir Timeline</button></article>;
    })}</section>

    {!timelines.length&&!eligiblePlans.length&&<div className="timeline-empty"><Clapperboard size={28}/><h3>Nenhum Scene Plan pronto para Timeline.</h3><p>A timeline nasce somente depois do Scene Timecode e Visual Prompt Engine aprovados.</p></div>}
  </div>;
}

function MediaPreview({source}:{source:Source}){
  if(!source.signedUrl)return <div>Preview indisponível.</div>;
  if(source.kind==='image')return <img src={source.signedUrl} alt=""/>;
  if(source.kind==='video')return <video controls src={source.signedUrl}/>;
  return <audio controls src={source.signedUrl}/>;
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clapperboard, History,
  Image as ImageIcon, Save, Sparkles, Video, Volume2
} from 'lucide-react';
import type {
  ManagedChannel, ScenePlan, Timeline, TimelineClip, TimelinePayload,
  TimelineVersion
} from '@/lib/types';
import {
  normalizeTimeline, timelineStructuralIssues
} from '@/lib/timeline-policy';

type Source={
  assetId:string;
  kind:'image'|'video'|'audio';
  signedUrl:string|null;
  mimeType:string;
  title:string;
};
type Tab='timeline'|'review'|'history';

function time(value:number){
  const m=Math.floor(value/60);
  const s=(value%60).toFixed(2).padStart(5,'0');
  return String(m).padStart(2,'0')+':'+s;
}
function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:Timeline):TimelinePayload{const {version:_version,status:_status,...payload}=value;return payload;}

export default function TimelineEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [timelines,setTimelines]=useState<Timeline[]>([]);
  const [scenePlans,setScenePlans]=useState<ScenePlan[]>([]);
  const [current,setCurrent]=useState<Timeline|null>(null);
  const [draft,setDraft]=useState<TimelinePayload|null>(null);
  const [scenePlan,setScenePlan]=useState<ScenePlan|null>(null);
  const [sources,setSources]=useState<Source[]>([]);
  const [history,setHistory]=useState<TimelineVersion[]>([]);
  const [selectedClipId,setSelectedClipId]=useState('');
  const [tab,setTab]=useState<Tab>('timeline');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const timelinePlanIds=useMemo(()=>new Set(timelines.map(item=>item.scenePlanId)),[timelines]);
  const eligiblePlans=useMemo(()=>scenePlans.filter(item=>!timelinePlanIds.has(item.id)),[scenePlans,timelinePlanIds]);
  const sourceMap=useMemo(()=>new Map(sources.map(source=>[source.assetId,source])),[sources]);
  const voiceSource=useMemo(()=>{
    const voiceClip=draft?.tracks.find(track=>track.type==='voice')?.clips[0];
    return voiceClip?.assetId?sourceMap.get(voiceClip.assetId)??null:null;
  },[draft,sourceMap]);
  const structuralIssues=useMemo(()=>draft&&scenePlan?timelineStructuralIssues(normalizeTimeline(draft),scenePlan):[],[draft,scenePlan]);
  const dirty=useMemo(()=>draft&&current?JSON.stringify(normalizeTimeline(draft))!==JSON.stringify(payloadOnly(current)):!!draft,[draft,current]);
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
      setSelectedClipId(body.timeline.tracks.find((track:Timeline['tracks'][number])=>track.type==='visual')?.clips[0]?.id??'');
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
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,timeline:normalized})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Timeline.');
      setCurrent(body.timeline);
      setDraft(payloadOnly(body.timeline));
      setHistory(body.history??[]);
      setSources(body.sources??[]);
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

  if(loading)return <div className="timeline-loading"><Sparkles className="spin" size={20}/>Carregando Timeline Engine…</div>;

  if(draft&&scenePlan){
    const canvasWidth=Math.max(1000,Math.min(6000,draft.durationSeconds*18));
    return <div className="timeline-editor">
      <div className="timeline-back"><button onClick={()=>{setDraft(null);setCurrent(null);setScenePlan(null);setSources([]);setHistory([]);setSelectedClipId('');}}><ArrowLeft size={15}/>Todas as timelines</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

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
            <div className="timeline-ruler">{Array.from({length:Math.ceil(draft.durationSeconds/10)+1},(_,i)=><span key={i} style={{left:(i*10/draft.durationSeconds*100)+'%'}}>{time(i*10)}</span>)}</div>
            {draft.tracks.filter(track=>track.type==='visual'||track.type==='voice').map(track=><div className={'timeline-track '+track.type} key={track.id}>
              <div className="timeline-track-label">{track.type==='visual'?<ImageIcon size={15}/>:<Volume2 size={15}/>}<span>{track.name}</span>{track.locked&&<small>LOCKED</small>}</div>
              <div className="timeline-track-lane">{track.clips.map(clip=>{
                const left=clip.startSeconds/draft.durationSeconds*100;
                const width=Math.max(.2,clip.durationSeconds/draft.durationSeconds*100);
                const source=clip.assetId?sourceMap.get(clip.assetId):null;
                return <button key={clip.id} style={{left:left+'%',width:width+'%'}} className={'timeline-clip '+clip.clipKind+(selectedClipId===clip.id?' selected':'')} onClick={()=>setSelectedClipId(clip.id)}>
                  {clip.clipKind==='image'&&source?.signedUrl?<img src={source.signedUrl} alt=""/>:
                   clip.clipKind==='video'&&source?.signedUrl?<video src={source.signedUrl} muted preload="metadata"/>:
                   clip.clipKind==='audio'?<Volume2 size={14}/>:
                   <AlertTriangle size={14}/>}
                  <span>{clip.label}</span>
                </button>;
              })}</div>
            </div>)}
          </div>
        </section>
      </div>}

      {tab==='review'&&<div className="timeline-content">
        <section className={structuralIssues.length?'timeline-review blocked':'timeline-review ready'}>
          {structuralIssues.length?<AlertTriangle size={30}/>:<CheckCircle2 size={30}/>}
          <div><span>TIMELINE GATE</span><h3>{structuralIssues.length?'A estrutura ainda tem bloqueios.':'Estrutura temporal consistente.'}</h3><p>A aprovação final também valida se os assets continuam selecionados, ready e não-stale.</p></div>
        </section>
        {structuralIssues.length>0&&<div className="timeline-issues">{structuralIssues.map(issue=><span key={issue}>{issue}</span>)}</div>}
        <label className="timeline-notes"><span>NOTAS DE REVIEW</span><textarea rows={5} value={draft.review.notes} onChange={e=>setDraft({...draft,review:{notes:e.target.value}})}/></label>
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
      return <article key={item.id}><div><span>{item.status}</span><em>v{item.version}</em></div><h3>{visuals.length} cenas</h3><p>{time(item.durationSeconds)} · {item.format.width}×{item.format.height}</p><small>{placeholders?placeholders+' placeholder(s)':'mídia completa'}</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openTimeline(item.id)}>Abrir Timeline</button></article>;
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

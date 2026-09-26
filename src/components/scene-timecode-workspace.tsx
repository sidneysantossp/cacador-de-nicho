'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, CircleAlert, Clapperboard, History, Plus,
  Save, Sparkles, Trash2
} from 'lucide-react';
import type {
  ManagedChannel, ProductionDNA, SceneAssetMode, ScenePlan, ScenePlanPayload,
  ScenePlanVersion, SceneTimecode, Transcript, VoiceAsset
} from '@/lib/types';
import {
  normalizeScenePlan, sceneDurationWarnings, scenePlanApprovalIssues,
  scenePlanStructuralIssues
} from '@/lib/scene-timecode-policy';
import { formatTranscriptTimestamp } from '@/lib/transcript-policy';

type VoiceAssetView=VoiceAsset&{signedUrl:string|null;stale:boolean};
type ScenePlanView=ScenePlan&{stale?:boolean;staleReason?:string};
type Tab='scenes'|'review'|'history';

function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:ScenePlan):ScenePlanPayload{const {version:_version,status:_status,...payload}=value;return payload;}

export default function SceneTimecodeWorkspace({channel}:{channel:ManagedChannel}){
  const [plans,setPlans]=useState<ScenePlanView[]>([]);
  const [transcripts,setTranscripts]=useState<Transcript[]>([]);
  const [current,setCurrent]=useState<ScenePlan|null>(null);
  const [draft,setDraft]=useState<ScenePlanPayload|null>(null);
  const [transcript,setTranscript]=useState<Transcript|null>(null);
  const [dna,setDna]=useState<ProductionDNA|null>(null);
  const [history,setHistory]=useState<ScenePlanVersion[]>([]);
  const [audioUrl,setAudioUrl]=useState<string|null>(null);
  const [tab,setTab]=useState<Tab>('scenes');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const plannedTranscriptIds=useMemo(()=>new Set(plans.map(plan=>plan.transcriptId)),[plans]);
  const eligible=useMemo(()=>transcripts.filter(item=>!plannedTranscriptIds.has(item.id)),[transcripts,plannedTranscriptIds]);
  const structural=useMemo(()=>draft&&transcript?scenePlanStructuralIssues(normalizeScenePlan(draft),transcript):[],[draft,transcript]);
  const durationWarnings=useMemo(()=>draft?sceneDurationWarnings(normalizeScenePlan(draft),dna):[],[draft,dna]);
  const approvalIssues=useMemo(()=>draft&&transcript?scenePlanApprovalIssues(normalizeScenePlan(draft),transcript,dna):[],[draft,transcript,dna]);
  const dirty=useMemo(()=>draft&&current?JSON.stringify(normalizeScenePlan(draft))!==JSON.stringify(payloadOnly(current)):!!draft,[draft,current]);

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/scene-timecode?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Scene Timecode.');
      setPlans(body.plans??[]);
      setTranscripts(body.transcripts??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Scene Timecode.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  async function loadAudio(scriptId:string,voiceAssetId:string){
    setAudioUrl(null);
    try{
      const res=await fetch('/api/voice-engine?scriptId='+encodeURIComponent(scriptId),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)return;
      const asset=(body.assets??[]).find((item:VoiceAssetView)=>item.id===voiceAssetId);
      setAudioUrl(asset?.signedUrl??null);
    }catch{}
  }

  async function openPlan(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch('/api/scene-timecode?planId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir Scene Plan.');
      setCurrent(body.plan);
      setDraft(payloadOnly(body.plan));
      setTranscript(body.transcript??null);
      setDna(body.productionDna??null);
      setHistory(body.history??[]);
      setTab('scenes');
      void loadAudio(body.plan.scriptId,body.plan.voiceAssetId);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Scene Plan.');}
    finally{setBusy('');}
  }

  async function create(transcriptId:string){
    setBusy('create:'+transcriptId);setMessage('');
    try{
      const res=await fetch('/api/scene-timecode',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'create',transcriptId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao criar Scene Plan.');
      setPlans(prev=>[body.plan,...prev.filter(item=>item.id!==body.plan.id)]);
      setMessage(body.message??'Scene Plan criado.');
      await openPlan(body.plan.id);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Scene Plan.');}
    finally{setBusy('');}
  }

  async function save(status:ScenePlan['status']='draft',payload=draft){
    if(!payload)return false;
    setBusy('save');setMessage('');
    try{
      const normalized=normalizeScenePlan(payload);
      const res=await fetch('/api/scene-timecode',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,plan:normalized})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Scene Plan.');
      setCurrent(body.plan);setDraft(payloadOnly(body.plan));setHistory(body.history??[]);
      setPlans(prev=>[body.plan,...prev.filter(item=>item.id!==body.plan.id)]);
      setMessage(body.message??'Scene Plan salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Scene Plan.');return false;}
    finally{setBusy('');}
  }

  function updateScene(index:number,next:SceneTimecode){
    setDraft(prev=>prev?normalizeScenePlan({...prev,scenes:prev.scenes.map((scene,i)=>i===index?next:scene)}):prev);
  }

  function removeScene(index:number){
    setDraft(prev=>prev?normalizeScenePlan({...prev,scenes:prev.scenes.filter((_,i)=>i!==index)}):prev);
  }

  function addScene(){
    if(!draft)return;
    const last=draft.scenes.at(-1);
    const start=last?.endSeconds??0;
    const end=Math.min(draft.audioDurationSeconds,start+1);
    if(end<=start)return;
    setDraft(normalizeScenePlan({...draft,scenes:[...draft.scenes,{
      id:crypto.randomUUID(),
      sequence:draft.scenes.length+1,
      startSeconds:start,
      endSeconds:end,
      durationSeconds:end-start,
      narration:'',
      transcriptSegmentIds:[],
      transcriptWordIds:[],
      visualIntent:'',
      shotType:'',
      characterIds:[],
      assetMode:'image',
      promptDirection:'',
      notes:''
    }]}));
  }

  if(loading)return <div className="scene-timecode-loading"><Sparkles className="spin" size={20}/>Carregando Scene Timecode…</div>;

  if(draft&&transcript){
    return <div className="scene-timecode-editor">
      <div className="scene-timecode-back"><button onClick={()=>{setDraft(null);setCurrent(null);setTranscript(null);setDna(null);setHistory([]);setAudioUrl(null);}}><ArrowLeft size={15}/>Todos os planos</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

      <section className="scene-timecode-hero">
        <div><span>SCENE TIMECODE PROTOCOL</span><h2>{draft.scenes.length} cenas · {formatTranscriptTimestamp(draft.audioDurationSeconds)}</h2><p>Take {draft.voiceTake} · transcript v{draft.transcriptVersion} · cada cena permanece vinculada ao timing aprovado.</p></div>
        <div><em>{approvalIssues.length?approvalIssues.length+' BLOCKER(S)':'READY'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save('draft')}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="scene-timecode-message"><CheckCircle2 size={15}/>{message}</div>}
      {audioUrl&&<section className="scene-timecode-audio"><audio controls preload="metadata" src={audioUrl}/><div><strong>Take {draft.voiceTake}</strong><small>Use o player para conferir cortes e pausas.</small></div></section>}

      <nav className="scene-timecode-tabs">
        <button className={tab==='scenes'?'active':''} onClick={()=>setTab('scenes')}><Clapperboard size={15}/>Cenas</button>
        <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><CheckCircle2 size={15}/>Review</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      {tab==='scenes'&&<div className="scene-timecode-content">
        <div className="scene-timecode-list">{draft.scenes.map((scene,index)=><section className="scene-card" key={scene.id}>
          <header>
            <div><span>SCENE {String(scene.sequence).padStart(3,'0')}</span><strong>{formatTranscriptTimestamp(scene.startSeconds)} → {formatTranscriptTimestamp(scene.endSeconds)}</strong><small>{scene.durationSeconds.toFixed(2)}s</small></div>
            <button className="icon-button" disabled={draft.scenes.length<=1} onClick={()=>removeScene(index)}><Trash2 size={15}/></button>
          </header>
          <div className="scene-time-grid">
            <Field label="Start"><input type="number" step="0.01" value={scene.startSeconds} onChange={e=>updateScene(index,{...scene,startSeconds:Number(e.target.value)})}/></Field>
            <Field label="End"><input type="number" step="0.01" value={scene.endSeconds} onChange={e=>updateScene(index,{...scene,endSeconds:Number(e.target.value)})}/></Field>
            <Field label="Shot type"><input value={scene.shotType} onChange={e=>updateScene(index,{...scene,shotType:e.target.value})} placeholder="medium-wide, close-up…"/></Field>
            <Field label="Asset mode"><select value={scene.assetMode} onChange={e=>updateScene(index,{...scene,assetMode:e.target.value as SceneAssetMode})}><option value="image">Image</option><option value="video">Video</option><option value="stock">Stock</option><option value="mixed">Mixed</option><option value="none">None</option></select></Field>
          </div>
          <Text label="NARRAÇÃO" value={scene.narration} onChange={v=>updateScene(index,{...scene,narration:v})} rows={4}/>
          {!!scene.visualBeats?.length&&<div className="scene-visual-beats">
            {scene.visualBeats.map(beat=><article key={beat.id}>
              <div><span>VISUAL BEAT {String(beat.sequence).padStart(2,'0')}</span><em>{beat.type} · {beat.sourcePreference}</em></div>
              <p>{beat.narration}</p>
              {!!beat.entities.length&&<small>{beat.entities.map(entity=>entity.value).join(' · ')}</small>}
              <div>{beat.queries.map(query=><code key={query}>{query}</code>)}</div>
            </article>)}
          </div>}
          <div className="scene-time-grid two">
            <Text label="INTENÇÃO VISUAL" value={scene.visualIntent} onChange={v=>updateScene(index,{...scene,visualIntent:v})} rows={4}/>
            <Text label="PROMPT DIRECTION" value={scene.promptDirection} onChange={v=>updateScene(index,{...scene,promptDirection:v})} rows={4}/>
          </div>
          <div className="scene-time-grid two">
            <Field label="Character IDs"><input value={scene.characterIds.join(', ')} onChange={e=>updateScene(index,{...scene,characterIds:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})} placeholder="grug"/></Field>
            <Field label="Transcript segments"><input readOnly value={scene.transcriptSegmentIds.join(', ')}/></Field>
          </div>
          <Text label="NOTAS" value={scene.notes} onChange={v=>updateScene(index,{...scene,notes:v})} rows={2}/>
        </section>)}</div>
        <button className="button subtle" onClick={addScene}><Plus size={15}/>Adicionar cena</button>
      </div>}

      {tab==='review'&&<div className="scene-timecode-content">
        <section className={approvalIssues.length?'scene-review blocked':'scene-review ready'}>
          {approvalIssues.length?<CircleAlert size={30}/>:<CheckCircle2 size={30}/>}
          <div><span>TIMELINE GATE</span><h3>{approvalIssues.length?'Ainda existem bloqueios.':'Timeline pronta para produção visual.'}</h3><p>{draft.scenes.length} cenas cobrindo {formatTranscriptTimestamp(draft.audioDurationSeconds)}.</p></div>
        </section>
        {structural.length>0&&<div className="scene-issues structural">{structural.map(issue=><span key={issue}>{issue}</span>)}</div>}
        {durationWarnings.length>0&&<div className="scene-duration-warning"><CircleAlert size={16}/><div><strong>{durationWarnings.length} alerta(s) de duração</strong>{durationWarnings.map(item=><span key={item}>{item}</span>)}</div></div>}
        {durationWarnings.length>0&&<label className="scene-warning-accept"><input type="checkbox" checked={draft.review.durationWarningsAccepted} onChange={e=>setDraft({...draft,review:{...draft.review,durationWarningsAccepted:e.target.checked}})}/><span>Aceito conscientemente as exceções de duração deste plano.</span></label>}
        <Text label="NOTAS DE REVIEW" value={draft.review.notes} onChange={v=>setDraft({...draft,review:{...draft.review,notes:v}})} rows={5}/>
        <div className="scene-approval-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={approvalIssues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={16}/>Aprovar Scene Plan</button></div>
      </div>}

      {tab==='history'&&<div className="scene-timecode-content"><div className="scene-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · {item.payload.scenes.length} cenas · {formatTranscriptTimestamp(item.payload.audioDurationSeconds)}</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('scenes');setMessage('Versão '+item.version+' carregada no editor.');}}>Carregar</button></article>)}</div></div>}
    </div>;
  }

  return <div className="scene-timecode">
    {message&&<div className="scene-timecode-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="scene-timecode-list-hero"><div><span>SCENE TIMECODE PROTOCOL</span><h2>Transforme narração aprovada em timeline de produção.</h2><p>O transcript define o tempo. O Scene Plan define onde cada visual começa, termina e o que precisa comunicar.</p></div></section>

    {eligible.length>0&&<section className="scene-ready">
      <div className="scene-section-head"><div><span>READY FOR SCENES</span><h3>Transcripts aprovados esperando timeline.</h3></div><Clapperboard size={21}/></div>
      {eligible.map(item=><article key={item.id}><div><strong>Take {item.voiceTake} · transcript v{item.version}</strong><p>{item.segments.length} segmentos · match {item.scriptMatchScore===null?'—':Math.round(item.scriptMatchScore*100)+'%'}</p></div><button className="button primary small" disabled={!!busy} onClick={()=>void create(item.id)}>{busy==='create:'+item.id?'Criando…':'Criar Scene Plan'}</button></article>)}
    </section>}

    <section className="scene-plan-grid">{plans.map(plan=><article key={plan.id}><div><span>{plan.stale?'stale':plan.status}</span><em>v{plan.version}</em></div><h3>Take {plan.voiceTake}</h3><p>{plan.scenes.length} cenas · {formatTranscriptTimestamp(plan.audioDurationSeconds)}</p><small>{plan.stale?'Take de voz mudou · reconstrução necessária':'transcript v'+plan.transcriptVersion}</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openPlan(plan.id)}>Abrir timeline</button></article>)}</section>

    {!plans.length&&!eligible.length&&<div className="scene-timecode-empty"><Clapperboard size={28}/><h3>Nenhum transcript aprovado para cenas.</h3><p>A timeline começa somente depois da aprovação da transcrição.</p></div>}
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="scene-field"><span>{label}</span>{children}</label>;}
function Text({label,value,onChange,rows=4}:{label:string;value:string;onChange:(value:string)=>void;rows?:number}){return <label className="scene-text"><span>{label}</span><textarea rows={rows} value={value} onChange={e=>onChange(e.target.value)}/></label>;}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, CircleAlert, FileText, History, Plus,
  RefreshCw, Save, Sparkles, Trash2, Upload
} from 'lucide-react';
import type {
  EpisodeScript, ManagedChannel, Transcript, TranscriptPayload,
  TranscriptSegment, TranscriptVersionSummary, VoiceAsset
} from '@/lib/types';
import { formatTranscriptTimestamp, normalizeTranscriptPayload, transcriptApprovalIssues } from '@/lib/transcript-policy';
import {
  buildLongFormEditorWindows, timedContentDuration, timedEntriesInWindow
} from '@/lib/long-form-editor-window';

type VoiceAssetView=VoiceAsset&{signedUrl:string|null;stale:boolean};
type Tab='segments'|'words'|'review'|'history';

function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:Transcript):TranscriptPayload{const {version:_version,status:_status,...payload}=value;return payload;}

export default function TranscriptionEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [scripts,setScripts]=useState<EpisodeScript[]>([]);
  const [scriptId,setScriptId]=useState('');
  const [assets,setAssets]=useState<VoiceAssetView[]>([]);
  const [assetId,setAssetId]=useState('');
  const [transcripts,setTranscripts]=useState<Transcript[]>([]);
  const [current,setCurrent]=useState<Transcript|null>(null);
  const [draft,setDraft]=useState<TranscriptPayload|null>(null);
  const [history,setHistory]=useState<TranscriptVersionSummary[]>([]);
  const [tab,setTab]=useState<Tab>('segments');
  const [activeWindowId,setActiveWindowId]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const selectedScript=useMemo(()=>scripts.find(item=>item.id===scriptId)??null,[scripts,scriptId]);
  const selectedAsset=useMemo(()=>assets.find(item=>item.id===assetId)??null,[assets,assetId]);
  const editorDuration=useMemo(()=>draft?Math.max(
    timedContentDuration(draft.words),
    timedContentDuration(draft.segments)
  ):0,[draft]);
  const editorWindows=useMemo(()=>buildLongFormEditorWindows(editorDuration),[editorDuration]);
  const activeWindow=useMemo(()=>
    editorWindows.find(item=>item.id===activeWindowId)??editorWindows[0]??null,
    [editorWindows,activeWindowId]
  );
  const visibleSegments=useMemo(()=>
    timedEntriesInWindow(draft?.segments??[],activeWindow),
    [draft?.segments,activeWindow]
  );
  const visibleWords=useMemo(()=>
    timedEntriesInWindow(draft?.words??[],activeWindow),
    [draft?.words,activeWindow]
  );
  const issues=useMemo(()=>draft&&selectedScript?transcriptApprovalIssues(normalizeTranscriptPayload(draft,selectedScript.content),selectedScript.version):[],[draft,selectedScript]);
  const dirty=useMemo(()=>draft&&current&&selectedScript?JSON.stringify(normalizeTranscriptPayload(draft,selectedScript.content))!==JSON.stringify(payloadOnly(current)):!!draft,[draft,current,selectedScript]);

  async function loadScriptData(id:string){
    if(!id){setAssets([]);setTranscripts([]);setAssetId('');return;}
    setBusy('load-script');
    try{
      const [voiceRes,transcriptRes]=await Promise.all([
        fetch('/api/voice-engine?scriptId='+encodeURIComponent(id),{cache:'no-store'}),
        fetch('/api/transcription-engine?scriptId='+encodeURIComponent(id),{cache:'no-store'})
      ]);
      const voiceBody=await voiceRes.json().catch(()=>({}));
      const transcriptBody=await transcriptRes.json().catch(()=>({}));
      if(!voiceRes.ok)throw new Error(voiceBody.message??'Falha ao carregar takes de voz.');
      if(!transcriptRes.ok)throw new Error(transcriptBody.message??'Falha ao carregar transcrições.');
      const nextAssets=voiceBody.assets??[];
      setAssets(nextAssets);
      setTranscripts(transcriptBody.transcripts??[]);
      const active=nextAssets.find((item:VoiceAssetView)=>item.selected)??nextAssets[0];
      setAssetId(active?.id??'');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Transcription Engine.');}
    finally{setBusy('');}
  }

  async function loadInitial(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/script-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar roteiros.');
      const approved=(body.scripts??[]).filter((item:EpisodeScript)=>item.status==='approved');
      setScripts(approved);
      const first=approved[0]?.id??'';
      setScriptId(first);
      if(first)await loadScriptData(first);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Transcription Engine.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void loadInitial();},[channel.id]);

  useEffect(()=>{
    if(!editorWindows.length){setActiveWindowId('');return;}
    if(!editorWindows.some(item=>item.id===activeWindowId)){
      setActiveWindowId(editorWindows[0].id);
    }
  },[editorWindows,activeWindowId]);

  async function openTranscript(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch('/api/transcription-engine?transcriptId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir transcript.');
      setCurrent(body.transcript);setDraft(payloadOnly(body.transcript));setHistory(body.history??[]);setTab('segments');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir transcript.');}
    finally{setBusy('');}
  }

  async function loadHistoryVersion(version:number){
    if(!current)return;
    setBusy('history:'+version);setMessage('');
    try{
      const query=new URLSearchParams({transcriptId:current.id,historyVersion:String(version)});
      const res=await fetch('/api/transcription-engine?'+query.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar versão histórica.');
      if(!body.historyVersion?.payload)throw new Error('Versão histórica sem payload.');
      setDraft({...body.historyVersion.payload,updatedAt:new Date().toISOString()});
      setTab('segments');
      setMessage('Versão '+version+' carregada no editor. Salve para criar uma nova versão.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar versão histórica.');}
    finally{setBusy('');}
  }

  async function create(action:'alignment'|'scribe'){
    if(!assetId)return;
    setBusy(action);setMessage('');
    try{
      const res=await fetch('/api/transcription-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,voiceAssetId:assetId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao criar transcript.');
      setCurrent(body.transcript);setDraft(payloadOnly(body.transcript));setHistory(body.history??[]);
      setTranscripts(prev=>[body.transcript,...prev.filter(item=>item.id!==body.transcript.id)]);setTab('segments');
      setMessage(body.message??'Transcript criado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar transcript.');}
    finally{setBusy('');}
  }

  async function importFile(){
    if(!assetId||!file)return;
    setBusy('import');setMessage('');
    try{
      const form=new FormData();form.set('voiceAssetId',assetId);form.set('file',file);
      const res=await fetch('/api/transcription-engine',{method:'POST',body:form});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao importar transcrição.');
      setCurrent(body.transcript);setDraft(payloadOnly(body.transcript));setHistory(body.history??[]);
      setTranscripts(prev=>[body.transcript,...prev.filter(item=>item.id!==body.transcript.id)]);setTab('segments');
      setFile(null);setMessage(body.message??'Transcrição importada.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao importar transcrição.');}
    finally{setBusy('');}
  }

  async function save(status:Transcript['status']='draft',payload=draft){
    if(!payload||!selectedScript)return false;
    setBusy('save');setMessage('');
    try{
      const normalized=normalizeTranscriptPayload(payload,selectedScript.content);
      const res=await fetch('/api/transcription-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,transcript:normalized})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao salvar transcript.');
      setCurrent(body.transcript);setDraft(payloadOnly(body.transcript));setHistory(body.history??[]);
      setTranscripts(prev=>[body.transcript,...prev.filter(item=>item.id!==body.transcript.id)]);
      setMessage(body.message??'Transcript salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar transcript.');return false;}
    finally{setBusy('');}
  }

  function updateSegment(index:number,next:TranscriptSegment){
    if(!draft||!selectedScript)return;
    setDraft(normalizeTranscriptPayload({...draft,segments:draft.segments.map((item,i)=>i===index?next:item)},selectedScript.content));
  }

  if(loading)return <div className="transcript-loading"><Sparkles className="spin" size={20}/>Carregando Transcription Engine…</div>;

  if(draft&&selectedScript){
    return <div className="transcript-editor">
      <div className="transcript-back"><button onClick={()=>{setDraft(null);setCurrent(null);setHistory([]);setActiveWindowId('');}}><ArrowLeft size={15}/>Todos os transcripts</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>
      <section className="transcript-hero">
        <div><span>TRANSCRIPTION ENGINE</span><h2>Take {draft.voiceTake} · {draft.sourceType}</h2><p>{draft.segments.length} segmentos · {draft.words.length} words temporizadas · match {draft.scriptMatchScore===null?'—':Math.round(draft.scriptMatchScore*100)+'%'}</p></div>
        <div><em>{issues.length?issues.length+' BLOCKER(S)':'READY'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save('draft')}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>
      {message&&<div className="transcript-message"><CheckCircle2 size={15}/>{message}</div>}
      <nav className="transcript-tabs">
        <button className={tab==='segments'?'active':''} onClick={()=>setTab('segments')}><FileText size={15}/>Segmentos</button>
        <button className={tab==='words'?'active':''} onClick={()=>setTab('words')}><Sparkles size={15}/>Words</button>
        <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><CheckCircle2 size={15}/>Review</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      {editorWindows.length>1&&<section className="long-form-window-nav">
        <div><span>EDITOR WINDOWS</span><strong>{editorWindows.length} blocos · máximo 10 minutos por tela</strong>{activeWindow&&<small>{formatTranscriptTimestamp(activeWindow.startSeconds)}–{formatTranscriptTimestamp(activeWindow.endSeconds)} · {visibleSegments.length} segmentos · {visibleWords.length} words</small>}</div>
        <div className="long-form-window-list">{editorWindows.map(window=><button key={window.id} className={window.id===activeWindow?.id?'active':''} onClick={()=>setActiveWindowId(window.id)}>
          <span>{String(window.sequence).padStart(2,'0')}</span>
          <strong>{formatTranscriptTimestamp(window.startSeconds)}–{formatTranscriptTimestamp(window.endSeconds)}</strong>
        </button>)}</div>
      </section>}

      {tab==='segments'&&<div className="transcript-content">
        <div className="transcript-segment-list">{visibleSegments.map(({item:segment,index})=><section className="transcript-segment" key={segment.id}>
          <header><span>{String(index+1).padStart(3,'0')}</span><div><label>START<input type="number" step="0.001" value={segment.startSeconds} onChange={e=>updateSegment(index,{...segment,startSeconds:Number(e.target.value)})}/></label><label>END<input type="number" step="0.001" value={segment.endSeconds??''} onChange={e=>updateSegment(index,{...segment,endSeconds:e.target.value===''?null:Number(e.target.value)})}/></label><em>{formatTranscriptTimestamp(segment.startSeconds)} → {segment.endSeconds===null?'?':formatTranscriptTimestamp(segment.endSeconds)}</em></div><button className="icon-button" disabled={draft.segments.length<=1} onClick={()=>setDraft(normalizeTranscriptPayload({...draft,segments:draft.segments.filter(item=>item.id!==segment.id)},selectedScript.content))}><Trash2 size={15}/></button></header>
          <textarea rows={3} value={segment.text} onChange={e=>updateSegment(index,{...segment,text:e.target.value})}/>
        </section>)}</div>
        <button className="button subtle" onClick={()=>{const last=draft.segments.at(-1);setDraft(normalizeTranscriptPayload({...draft,segments:[...draft.segments,{id:crypto.randomUUID(),startSeconds:last?.endSeconds??last?.startSeconds??0,endSeconds:null,text:'Novo segmento',wordIds:[]}]},selectedScript.content));}}><Plus size={15}/>Adicionar segmento</button>
      </div>}

      {tab==='words'&&<div className="transcript-content">
        {draft.words.length?<div className="transcript-word-grid">{visibleWords.map(({item:word})=><span key={word.id} title={formatTranscriptTimestamp(word.startSeconds)+' → '+formatTranscriptTimestamp(word.endSeconds)}>{word.text}<small>{word.startSeconds.toFixed(2)}</small></span>)}</div>:<div className="transcript-empty-inline">Este formato não possui word-level timestamps. Os segmentos continuam válidos para a timeline.</div>}
      </div>}

      {tab==='review'&&<div className="transcript-content">
        <section className={issues.length?'transcript-review blocked':'transcript-review ready'}>{issues.length?<CircleAlert size={30}/>:<CheckCircle2 size={30}/>}<div><span>SYNC GATE</span><h3>{issues.length?'Ainda existem bloqueios.':'Transcript pronto para produção.'}</h3><p>Compatibilidade com roteiro: <strong>{draft.scriptMatchScore===null?'não calculada':Math.round(draft.scriptMatchScore*100)+'%'}</strong></p></div></section>
        {issues.length>0&&<div className="transcript-issues">{issues.map(issue=><span key={issue}>{issue}</span>)}</div>}
        {draft.scriptMatchScore!==null&&draft.scriptMatchScore<0.8&&<label className="transcript-override"><input type="checkbox" checked={draft.review.scriptMismatchOverride} onChange={e=>setDraft({...draft,review:{...draft.review,scriptMismatchOverride:e.target.checked}})}/><span>Esta divergência é intencional. Permitir aprovação mesmo com match abaixo de 80%.</span></label>}
        <label className="transcript-notes"><span>NOTAS DE REVIEW</span><textarea rows={5} value={draft.review.notes} onChange={e=>setDraft({...draft,review:{...draft.review,notes:e.target.value}})}/></label>
        <div className="transcript-approval-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={issues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={16}/>Aprovar transcript</button></div>
      </div>}

      {tab==='history'&&<div className="transcript-content"><div className="transcript-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · payload carregado somente sob demanda</span><button className="button subtle small" disabled={busy==='history:'+item.version} onClick={()=>void loadHistoryVersion(item.version)}>{busy==='history:'+item.version?'Carregando…':'Carregar'}</button></article>)}</div></div>}
    </div>;
  }

  return <div className="transcription-engine">
    {message&&<div className="transcript-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="transcription-hero"><div><span>TRANSCRIPTION ENGINE</span><h2>Áudio e texto na mesma linha do tempo.</h2><p>Reaproveite alignment, transcreva com Scribe v2 ou importe TurboScribe/SRT/VTT/TXT/JSON. Tudo vira o mesmo formato interno.</p></div></section>

    {!scripts.length?<div className="transcript-empty"><FileText size={28}/><h3>Nenhum roteiro aprovado.</h3><p>O Transcription Engine começa depois do Script Engine e do Voice Engine.</p></div>:<>
      <section className="transcription-source">
        <label><span>ROTEIRO</span><select value={scriptId} onChange={e=>{setScriptId(e.target.value);void loadScriptData(e.target.value);}}>{scripts.map(script=><option key={script.id} value={script.id}>{script.title} · v{script.version}</option>)}</select></label>
        <label><span>TAKE DE VOZ</span><select value={assetId} onChange={e=>setAssetId(e.target.value)}><option value="">Selecione</option>{assets.map(asset=><option key={asset.id} value={asset.id}>Take {asset.take}{asset.selected?' · ATIVO':''}{asset.stale?' · STALE':''}</option>)}</select></label>
      </section>

      {selectedAsset&&<section className="transcription-actions">
        <div className="transcription-audio">{selectedAsset.signedUrl&&<audio controls preload="metadata" src={selectedAsset.signedUrl}/>}<div><strong>Take {selectedAsset.take}</strong><small>{selectedAsset.sourceType} · script v{selectedAsset.scriptVersion}</small></div></div>
        <div className="transcription-action-grid">
          <article className={selectedAsset.alignment?'available':'disabled'}><Sparkles size={21}/><div><strong>Usar alignment</strong><p>{selectedAsset.alignment?'Sem custo adicional. Timing já veio da geração de voz.':'Este take não possui alignment.'}</p></div><button className="button subtle small" disabled={!selectedAsset.alignment||!!busy} onClick={()=>void create('alignment')}>{busy==='alignment'?'Processando…':'Criar transcript'}</button></article>
          <article><RefreshCw size={21}/><div><strong>Scribe v2</strong><p>Transcrição automática com word-level timestamps.</p></div><button className="button subtle small" disabled={!!busy} onClick={()=>void create('scribe')}>{busy==='scribe'?'Transcrevendo…':'Transcrever áudio'}</button></article>
          <article><Upload size={21}/><div><strong>Importar arquivo</strong><p>SRT, VTT, TXT com timestamps ou JSON.</p></div><label className="transcript-file"><input type="file" accept=".srt,.vtt,.txt,.json,text/plain,application/json" onChange={e=>setFile(e.target.files?.[0]??null)}/><span>{file?file.name:'Selecionar arquivo'}</span></label><button className="button subtle small" disabled={!file||!!busy} onClick={()=>void importFile()}>{busy==='import'?'Importando…':'Importar'}</button></article>
        </div>
      </section>}

      <section className="transcript-list">
        <div className="transcript-section-head"><div><span>TRANSCRIPTS</span><h3>Versões temporais por take.</h3></div><span>{transcripts.length}</span></div>
        {!transcripts.length&&<div className="transcript-empty-inline">Nenhum transcript criado para este roteiro.</div>}
        {transcripts.map(item=><article key={item.id}><div><span>{item.sourceType}</span><strong>Take {item.voiceTake} · {item.status}</strong><small>{item.segments.length} segmentos · match {item.scriptMatchScore===null?'—':Math.round(item.scriptMatchScore*100)+'%'}</small></div><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openTranscript(item.id)}>Abrir transcript</button></article>)}
      </section>
    </>}
  </div>;
}

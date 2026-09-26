'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, CircleAlert, Copy, History, Image as ImageIcon,
  Save, Sparkles, WandSparkles
} from 'lucide-react';
import type {
  ManagedChannel, ProductionDNA, ScenePlan, ScenePlanListItem, VisualCharacterReference,
  VisualPromptSet, VisualPromptSetListItem, VisualPromptSetPayload, VisualPromptSetVersionSummary, VisualScenePrompt
} from '@/lib/types';
import { compileScenePrompt, visualPromptIssues } from '@/lib/visual-prompt-policy';
import {
  buildLongFormEditorWindows, timedEntriesInWindow
} from '@/lib/long-form-editor-window';

type Tab='references'|'scenes'|'review'|'history';

function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:VisualPromptSet):VisualPromptSetPayload{const {version:_version,status:_status,...payload}=value;return payload;}

export default function VisualPromptEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [sets,setSets]=useState<VisualPromptSetListItem[]>([]);
  const [plans,setPlans]=useState<ScenePlanListItem[]>([]);
  const [current,setCurrent]=useState<VisualPromptSet|null>(null);
  const [draft,setDraft]=useState<VisualPromptSetPayload|null>(null);
  const [plan,setPlan]=useState<ScenePlan|null>(null);
  const [dna,setDna]=useState<ProductionDNA|null>(null);
  const [history,setHistory]=useState<VisualPromptSetVersionSummary[]>([]);
  const [tab,setTab]=useState<Tab>('references');
  const [activeWindowId,setActiveWindowId]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const plannedIds=useMemo(()=>new Set(sets.map(item=>item.scenePlanId)),[sets]);
  const eligible=useMemo(()=>plans.filter(item=>!plannedIds.has(item.id)),[plans,plannedIds]);
  const editorWindows=useMemo(()=>
    buildLongFormEditorWindows(plan?.audioDurationSeconds??0),
    [plan?.audioDurationSeconds]
  );
  const activeWindow=useMemo(()=>
    editorWindows.find(item=>item.id===activeWindowId)??editorWindows[0]??null,
    [editorWindows,activeWindowId]
  );
  const visiblePrompts=useMemo(()=>
    timedEntriesInWindow(draft?.scenePrompts??[],activeWindow),
    [draft?.scenePrompts,activeWindow]
  );
  const refsReady=useMemo(()=>!!draft&&draft.characterReferences.every(ref=>ref.assetReady),[draft]);
  const issues=useMemo(()=>draft&&plan&&dna?visualPromptIssues(draft,plan,dna,true):[],[draft,plan,dna]);
  const dirty=useMemo(()=>{
    if(!draft||!current)return !!draft;
    return JSON.stringify({...draft,updatedAt:current.updatedAt})!==JSON.stringify(payloadOnly(current));
  },[draft,current]);

  async function load(){
    setLoading(true);setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Visual Prompt Engine.');
      setSets(body.promptSets??[]);
      setPlans(body.scenePlans??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Visual Prompt Engine.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[channel.id]);

  useEffect(()=>{
    if(!editorWindows.length){setActiveWindowId('');return;}
    if(!editorWindows.some(item=>item.id===activeWindowId)){
      setActiveWindowId(editorWindows[0].id);
    }
  },[editorWindows,activeWindowId]);

  async function openSet(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine?setId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir Visual Prompt Set.');
      setCurrent(body.promptSet);
      setDraft(payloadOnly(body.promptSet));
      setPlan(body.scenePlan??null);
      setDna(body.productionDna??null);
      setHistory(body.history??[]);
      const needsRefs=(body.promptSet.characterReferences??[]).some((ref:VisualCharacterReference)=>!ref.assetReady);
      setTab(needsRefs?'references':'scenes');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Visual Prompt Set.');}
    finally{setBusy('');}
  }

  async function loadHistoryVersion(version:number){
    if(!current)return;
    setBusy('history:'+version);setMessage('');
    try{
      const query=new URLSearchParams({setId:current.id,historyVersion:String(version)});
      const res=await fetch('/api/visual-prompt-engine?'+query.toString(),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar versão histórica.');
      if(!body.historyVersion?.payload)throw new Error('Versão histórica sem payload.');
      const payload=body.historyVersion.payload as VisualPromptSetPayload;
      setDraft({...payload,updatedAt:new Date().toISOString()});
      setTab(payload.characterReferences.some(ref=>!ref.assetReady)?'references':'scenes');
      setMessage('Versão '+version+' carregada no editor. Salve para criar uma nova versão.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar versão histórica.');}
    finally{setBusy('');}
  }

  async function create(scenePlanId:string){
    setBusy('create:'+scenePlanId);setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'create',scenePlanId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao criar Visual Prompt Set.');
      setMessage(body.message??'Visual Prompt Set criado.');
      await openSet(body.promptSet.id);
      void load();
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Visual Prompt Set.');}
    finally{setBusy('');}
  }

  async function generate(){
    if(!current)return;
    setBusy('generate');setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'generate',setId:current.id})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao gerar direções visuais.');
      setCurrent(body.promptSet);setDraft(payloadOnly(body.promptSet));setHistory(body.history??[]);
      void load();
      setMessage(body.message??'Direções visuais atualizadas.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao gerar direções visuais.');}
    finally{setBusy('');}
  }

  async function save(status:VisualPromptSet['status']='draft',payload=draft){
    if(!payload)return false;
    setBusy('save');setMessage('');
    try{
      const res=await fetch('/api/visual-prompt-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,promptSet:payload})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Visual Prompt Set.');
      setCurrent(body.promptSet);setDraft(payloadOnly(body.promptSet));setHistory(body.history??[]);
      void load();
      setMessage(body.message??'Visual Prompt Set salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Visual Prompt Set.');return false;}
    finally{setBusy('');}
  }

  function updateRef(index:number,next:VisualCharacterReference){
    setDraft(prev=>prev?{...prev,characterReferences:prev.characterReferences.map((ref,i)=>i===index?next:ref)}:prev);
  }

  function updateScene(index:number,next:VisualScenePrompt){
    setDraft(prev=>prev?{...prev,scenePrompts:prev.scenePrompts.map((scene,i)=>i===index?next:scene)}:prev);
  }

  function updateDirection(index:number,value:string){
    if(!draft||!plan||!dna)return;
    const item=draft.scenePrompts[index];
    const source=plan.scenes.find(scene=>scene.id===item.sceneId);
    if(!source)return;
    const recurring=draft.characterReferences.map(ref=>ref.characterId);
    const compiled=compileScenePrompt(source,dna,item.characterIds,value,recurring);
    updateScene(index,{...compiled,direction:value});
  }

  async function copy(value:string){
    try{await navigator.clipboard.writeText(value);setMessage('Prompt copiado.');}
    catch{setMessage('Não foi possível copiar automaticamente.');}
  }

  if(loading)return <div className="visual-prompt-loading"><Sparkles className="spin" size={20}/>Carregando Visual Prompt Engine…</div>;

  if(draft&&plan&&dna){
    return <div className="visual-prompt-editor">
      <div className="visual-prompt-back"><button onClick={()=>{setDraft(null);setCurrent(null);setPlan(null);setDna(null);setHistory([]);setActiveWindowId('');}}><ArrowLeft size={15}/>Todos os prompt sets</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

      <section className="visual-prompt-hero">
        <div><span>VISUAL PROMPT ENGINE</span><h2>{draft.scenePrompts.length} beats visuais · {draft.characterReferences.length} referência(s)</h2><p>Scene Plan v{draft.scenePlanVersion} · Production DNA v{draft.productionDnaVersion} · stage {refsReady?'scenes':'references'}</p></div>
        <div><em>{issues.length?issues.length+' BLOCKER(S)':'READY'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save('draft')}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="visual-prompt-message"><CheckCircle2 size={15}/>{message}</div>}

      <nav className="visual-prompt-tabs">
        <button className={tab==='references'?'active':''} onClick={()=>setTab('references')}><ImageIcon size={15}/>1. References</button>
        <button className={tab==='scenes'?'active':''} disabled={!refsReady} onClick={()=>refsReady&&setTab('scenes')}><WandSparkles size={15}/>2. Scene Prompts</button>
        <button className={tab==='review'?'active':''} onClick={()=>setTab('review')}><CheckCircle2 size={15}/>Review</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      {tab==='scenes'&&editorWindows.length>1&&<section className="long-form-window-nav">
        <div><span>EDITOR WINDOWS</span><strong>{editorWindows.length} blocos · máximo 10 minutos por tela</strong>{activeWindow&&<small>{activeWindow.startSeconds.toFixed(0)}s–{activeWindow.endSeconds.toFixed(0)}s · {visiblePrompts.length} prompts visíveis de {draft.scenePrompts.length}</small>}</div>
        <div className="long-form-window-list">{editorWindows.map(window=><button key={window.id} className={window.id===activeWindow?.id?'active':''} onClick={()=>setActiveWindowId(window.id)}>
          <span>{String(window.sequence).padStart(2,'0')}</span>
          <strong>{Math.floor(window.startSeconds/60)}m–{Math.ceil(window.endSeconds/60)}m</strong>
        </button>)}</div>
      </section>}

      {tab==='references'&&<div className="visual-prompt-content">
        <section className="visual-ai-box"><div><Sparkles size={22}/><div><strong>Visual Planner</strong><p>Analisa todas as cenas sem mudar timecodes e sugere personagens conhecidos, enquadramento e direção visual.</p></div></div><button className="button subtle" disabled={!!busy} onClick={()=>void generate()}>{busy==='generate'?'Planejando…':'Sugerir com IA'}</button></section>

        {!draft.characterReferences.length&&<div className="visual-no-refs"><CheckCircle2 size={24}/><h3>Nenhuma referência recorrente necessária.</h3><p>O fluxo pode seguir diretamente para os prompts das cenas.</p><button className="button primary small" onClick={()=>setTab('scenes')}>Abrir Scene Prompts</button></div>}

        {draft.characterReferences.map((ref,index)=><section className="visual-reference-card" key={ref.characterId}>
          <header><div><span>{ref.refName}</span><strong>{ref.sceneIds.length} cenas</strong></div><label><input type="checkbox" checked={ref.assetReady} onChange={e=>updateRef(index,{...ref,assetReady:e.target.checked})}/><span>Referência disponível</span></label></header>
          <textarea rows={8} value={ref.prompt} onChange={e=>updateRef(index,{...ref,prompt:e.target.value})}/>
          <div><button className="button subtle small" onClick={()=>void copy(ref.prompt)}><Copy size={14}/>Copiar prompt</button></div>
        </section>)}

        {draft.characterReferences.length>0&&!refsReady&&<div className="visual-reference-gate"><CircleAlert size={18}/><div><strong>Stage 2 bloqueado.</strong><p>Gere as referências acima no provider visual e marque cada uma como disponível antes de usar os prompts @Name.</p></div></div>}
        {refsReady&&draft.characterReferences.length>0&&<div className="visual-reference-gate ready"><CheckCircle2 size={18}/><div><strong>Referências prontas.</strong><p>Stage 2 liberado.</p></div><button className="button primary small" onClick={()=>setTab('scenes')}>Abrir Scene Prompts</button></div>}
      </div>}

      {tab==='scenes'&&refsReady&&<div className="visual-prompt-content">
        <section className="visual-style-lock"><span>STYLE LOCK</span><p>{draft.styleLock||'Production DNA não possui base prompt.'}</p></section>
        <div className="visual-scene-list">{visiblePrompts.map(({item:scene,index})=><section className="visual-scene-card" key={scene.sceneId}>
          <header><div><span>{scene.timecodeLabel}</span><strong>SCENE {String(scene.sequence).padStart(3,'0')}</strong></div><div>{scene.referenceNames.map(name=><em key={name}>{name}</em>)}</div></header>
          <label><span>DIREÇÃO VISUAL</span><textarea rows={4} value={scene.direction} onChange={e=>updateDirection(index,e.target.value)}/></label>
          <label><span>PROMPT FINAL</span><textarea rows={8} value={scene.prompt} onChange={e=>updateScene(index,{...scene,prompt:e.target.value})}/></label>
          <footer><small>{scene.startSeconds.toFixed(2)}s → {scene.endSeconds.toFixed(2)}s</small><button className="button subtle small" onClick={()=>void copy(scene.timecodeLabel+'\n'+scene.prompt)}><Copy size={14}/>Copiar bloco</button></footer>
        </section>)}</div>
      </div>}

      {tab==='review'&&<div className="visual-prompt-content">
        <section className={issues.length?'visual-review blocked':'visual-review ready'}>
          {issues.length?<CircleAlert size={30}/>:<CheckCircle2 size={30}/>}
          <div><span>VISUAL GATE</span><h3>{issues.length?'Ainda existem bloqueios.':'Prompt set pronto para geração de assets.'}</h3><p>{draft.scenePrompts.length} prompts para {plan.scenes.length} timecodes aprovados.</p></div>
        </section>
        {issues.length>0&&<div className="visual-issues">{issues.map(issue=><span key={issue}>{issue}</span>)}</div>}
        <label className="visual-review-notes"><span>NOTAS DE REVIEW</span><textarea rows={5} value={draft.review.notes} onChange={e=>setDraft({...draft,review:{notes:e.target.value}})}/></label>
        <div className="visual-approval-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={issues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={16}/>Aprovar prompts</button></div>
      </div>}

      {tab==='history'&&<div className="visual-prompt-content"><div className="visual-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · payload carregado somente sob demanda</span><button className="button subtle small" disabled={busy==='history:'+item.version} onClick={()=>void loadHistoryVersion(item.version)}>{busy==='history:'+item.version?'Carregando…':'Carregar'}</button></article>)}</div></div>}
    </div>;
  }

  return <div className="visual-prompt-engine">
    {message&&<div className="visual-prompt-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="visual-prompt-list-hero"><div><span>VISUAL PROMPT ENGINE</span><h2>Do timecode aprovado ao prompt visual consistente.</h2><p>Referências recorrentes primeiro. Depois, exatamente um prompt para cada beat existente no Scene Plan.</p></div></section>

    {eligible.length>0&&<section className="visual-ready">
      <div className="visual-section-head"><div><span>READY FOR VISUAL</span><h3>Scene Plans aprovados esperando prompts.</h3></div><WandSparkles size={21}/></div>
      {eligible.map(item=><article key={item.id}><div><strong>Take {item.voiceTake} · {item.sceneCount} cenas</strong><p>Scene Plan v{item.version}</p></div><button className="button primary small" disabled={!!busy} onClick={()=>void create(item.id)}>{busy==='create:'+item.id?'Criando…':'Criar Visual Prompt Set'}</button></article>)}
    </section>}

    <section className="visual-set-grid">{sets.map(item=><article key={item.id}><div><span>{item.status}</span><em>v{item.version}</em></div><h3>{item.scenePromptCount} scene prompts</h3><p>{item.characterReferenceCount} referências · {item.workflowStage}</p><small>Scene Plan v{item.scenePlanVersion} · DNA v{item.productionDnaVersion}</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openSet(item.id)}>Abrir prompts</button></article>)}</section>

    {!sets.length&&!eligible.length&&<div className="visual-prompt-empty"><ImageIcon size={28}/><h3>Nenhum Scene Plan aprovado para visual.</h3><p>O Visual Prompt Engine começa depois da aprovação da timeline.</p></div>}
  </div>;
}

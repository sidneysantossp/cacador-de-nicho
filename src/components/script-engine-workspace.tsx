'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, CircleAlert, FileCheck2, FileText, History, Link2, Plus, RefreshCw,
  Save, Sparkles, Trash2, WandSparkles
} from 'lucide-react';
import type {
  ContentProject, EpisodeScript, EpisodeScriptPayload, EpisodeScriptSection,
  EpisodeScriptVersion, ManagedChannel, ProductionDNA
} from '@/lib/types';
import { combineScriptSections, countScriptWords, scriptApprovalIssues } from '@/lib/script-policy';

type Tab='script'|'provenance'|'continuity'|'history';

function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:EpisodeScript):EpisodeScriptPayload{const {version:_version,status:_status,...payload}=value;return payload;}
function syncPayload(value:EpisodeScriptPayload):EpisodeScriptPayload{
  const content=combineScriptSections(value.sections);
  return {...value,content,wordCount:Math.max(1,countScriptWords(content)),updatedAt:new Date().toISOString()};
}

export default function ScriptEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [projects,setProjects]=useState<ContentProject[]>([]);
  const [scripts,setScripts]=useState<EpisodeScript[]>([]);
  const [current,setCurrent]=useState<EpisodeScript|null>(null);
  const [draft,setDraft]=useState<EpisodeScriptPayload|null>(null);
  const [project,setProject]=useState<ContentProject|null>(null);
  const [productionDna,setProductionDna]=useState<ProductionDNA|null>(null);
  const [history,setHistory]=useState<EpisodeScriptVersion[]>([]);
  const [tab,setTab]=useState<Tab>('script');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [manualProjectId,setManualProjectId]=useState('');
  const [manualTitle,setManualTitle]=useState('');
  const [manualContent,setManualContent]=useState('');

  async function reload(){
    setLoading(true);setMessage('');
    try{
      const [projectsRes,scriptsRes]=await Promise.all([
        fetch(`/api/content-os?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'}),
        fetch(`/api/script-engine?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'})
      ]);
      const projectsBody=await projectsRes.json().catch(()=>({}));
      const scriptsBody=await scriptsRes.json().catch(()=>({}));
      if(!projectsRes.ok)throw new Error(projectsBody.message??'Falha ao carregar Content Projects.');
      if(!scriptsRes.ok)throw new Error(scriptsBody.message??'Falha ao carregar roteiros.');
      setProjects((projectsBody.projects??[]).filter((project:ContentProject)=>project.status==='approved'&&project.approval.status==='approved'));
      setScripts(scriptsBody.scripts??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Script Engine.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void reload();},[channel.id]);

  const scriptedProjectIds=useMemo(()=>new Set(scripts.map(script=>script.contentProjectId)),[scripts]);
  const readyProjects=useMemo(()=>projects.filter(project=>!scriptedProjectIds.has(project.id)),[projects,scriptedProjectIds]);
  const dirty=useMemo(()=>draft&&current?JSON.stringify(syncPayload(draft))!==JSON.stringify(payloadOnly(current)):!!draft,[draft,current]);
  const documentaryMode=Boolean(
    productionDna?.research?.documentaryMode||
    productionDna?.research?.requireClaimLedger
  );
  const issues=useMemo(()=>draft?scriptApprovalIssues(
    syncPayload(draft),
    project?{claims:project.research.factChecks,documentaryMode}:undefined
  ):[],[draft,project,documentaryMode]);
  const supportedClaims=useMemo(()=>project?.research.factChecks.filter(
    claim=>claim.status==='supported'&&claim.narrationRule!=='exclude'
  )??[],[project]);

  async function openScript(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch(`/api/script-engine?scriptId=${encodeURIComponent(id)}`,{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir roteiro.');
      setCurrent(body.script);setDraft(payloadOnly(body.script));setProject(body.project??null);setProductionDna(body.productionDna??null);setHistory(body.history??[]);setTab('script');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir roteiro.');}
    finally{setBusy('');}
  }

  async function generate(projectId:string){
    setBusy('generate:'+projectId);setMessage('');
    try{
      const res=await fetch('/api/script-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'generate',projectId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao gerar roteiro.');
      setCurrent(body.script);setDraft(payloadOnly(body.script));setProject(body.project??null);setProductionDna(body.productionDna??null);setHistory(body.history??[]);
      setScripts(prev=>[body.script,...prev.filter(item=>item.id!==body.script.id)]);setTab('script');
      setMessage(body.message??'Roteiro gerado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao gerar roteiro.');}
    finally{setBusy('');}
  }

  async function save(status:EpisodeScript['status']='draft',payload=draft){
    if(!payload)return false;
    setBusy('save');setMessage('');
    try{
      const normalized=syncPayload(payload);
      const res=await fetch('/api/script-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'save',expectedVersion:current?.version??0,status,script:normalized})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao salvar roteiro.');
      setCurrent(body.script);setDraft(payloadOnly(body.script));setProject(body.project??project);setProductionDna(body.productionDna??productionDna);setHistory(body.history??[]);
      setScripts(prev=>[body.script,...prev.filter(item=>item.id!==body.script.id)]);
      setMessage(body.message??'Roteiro salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar roteiro.');return false;}
    finally{setBusy('');}
  }

  async function createManual(){
    const project=projects.find(item=>item.id===manualProjectId);
    const content=manualContent.trim();
    if(!project||!content)return;
    const now=new Date().toISOString();
    const section:EpisodeScriptSection={id:crypto.randomUUID(),label:'Narration',purpose:'Imported or manually written narration.',content,claimIds:[]};
    setProject(project);
    const payload:EpisodeScriptPayload=syncPayload({
      kind:'episode-script',
      id:crypto.randomUUID(),
      channelId:channel.id,
      episodeId:project.episodeId,
      contentProjectId:project.id,
      title:manualTitle.trim()||project.brief.workingTitle,
      language:'English',
      sections:[section],
      content,
      wordCount:1,
      estimatedMinutes:null,
      continuityNotes:[],
      factCheckWarnings:[],
      provenance:{generatedBy:'operator'},
      createdAt:now,
      updatedAt:now
    });
    const ok=await save('draft',payload);
    if(ok){setManualProjectId('');setManualTitle('');setManualContent('');}
  }

  async function regenerate(sectionId:string){
    if(!current||dirty)return;
    setBusy('section:'+sectionId);setMessage('');
    try{
      const res=await fetch('/api/script-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'regenerateSection',scriptId:current.id,sectionId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao regenerar trecho.');
      setCurrent(body.script);setDraft(payloadOnly(body.script));setProject(body.project??project);setProductionDna(body.productionDna??productionDna);setHistory(body.history??[]);
      setScripts(prev=>[body.script,...prev.filter(item=>item.id!==body.script.id)]);
      setMessage(body.message??'Trecho regenerado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao regenerar trecho.');}
    finally{setBusy('');}
  }

  function updateSection(index:number,next:EpisodeScriptSection){
    setDraft(prev=>prev?syncPayload({...prev,sections:prev.sections.map((section,i)=>i===index?next:section)}):prev);
  }

  if(loading)return <div className="script-engine-loading"><Sparkles className="spin" size={20}/>Carregando Script Engine…</div>;

  if(draft){
    return <div className="script-engine-editor">
      <div className="script-engine-back"><button onClick={()=>{setDraft(null);setCurrent(null);setProject(null);setProductionDna(null);setHistory([]);}}><ArrowLeft size={15}/>Todos os roteiros</button><span>{current?.status??'draft'} · v{current?.version??0}</span></div>

      <section className="script-engine-hero">
        <div><span>SCRIPT ENGINE</span><h2>{draft.title}</h2><p>{draft.wordCount} palavras{draft.estimatedMinutes!==null?` · ~${draft.estimatedMinutes} min`:''} · {draft.language}</p></div>
        <div><em>{issues.length?issues.length+' BLOCKER(S)':'READY'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void save('draft')}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="script-engine-message"><CheckCircle2 size={15}/>{message}</div>}
      {draft.factCheckWarnings.length>0&&<div className="script-engine-warning"><CircleAlert size={17}/><div><strong>Fact-check warnings</strong>{draft.factCheckWarnings.map(item=><span key={item}>{item}</span>)}</div></div>}

      <nav className="script-engine-tabs">
        <button className={tab==='script'?'active':''} onClick={()=>setTab('script')}><FileText size={15}/>Roteiro</button>
        <button className={tab==='provenance'?'active':''} onClick={()=>setTab('provenance')}><FileCheck2 size={15}/>Claim Ledger</button>
        <button className={tab==='continuity'?'active':''} onClick={()=>setTab('continuity')}><Sparkles size={15}/>Continuidade</button>
        <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><History size={15}/>Versões</button>
      </nav>

      {tab==='script'&&<div className="script-engine-content">
        <label className="script-title-field"><span>TÍTULO</span><input value={draft.title} onChange={e=>setDraft(syncPayload({...draft,title:e.target.value}))}/></label>
        <div className="script-section-list">{draft.sections.map((section,index)=><section key={section.id} className="script-section">
          <header><div><span>{String(index+1).padStart(2,'0')}</span><input value={section.label} onChange={e=>updateSection(index,{...section,label:e.target.value})}/></div><div><button className="button subtle small" disabled={dirty||busy==='section:'+section.id} onClick={()=>void regenerate(section.id)}><RefreshCw size={14}/>{busy==='section:'+section.id?'Regenerando…':'Regenerar trecho'}</button><button className="icon-button" disabled={draft.sections.length<=1} onClick={()=>setDraft(syncPayload({...draft,sections:draft.sections.filter(item=>item.id!==section.id)}))}><Trash2 size={15}/></button></div></header>
          <label><span>PROPÓSITO</span><input value={section.purpose} onChange={e=>updateSection(index,{...section,purpose:e.target.value})}/></label>
          <textarea rows={Math.max(8,Math.min(24,Math.ceil(section.content.length/110)))} value={section.content} onChange={e=>updateSection(index,{...section,content:e.target.value})}/>
          {documentaryMode&&<div className="content-os-source-checks">
            <span>CLAIMS USADOS NESTA SEÇÃO</span>
            {supportedClaims.length?supportedClaims.map(claim=><label key={claim.id}><input type="checkbox" checked={(section.claimIds??[]).includes(claim.id)} onChange={e=>updateSection(index,{...section,claimIds:e.target.checked?[...new Set([...(section.claimIds??[]),claim.id])]:(section.claimIds??[]).filter(id=>id!==claim.id)})}/>{claim.claim}</label>):<small>Nenhum claim sustentado disponível no Content OS.</small>}
          </div>}
        </section>)}</div>
        <button className="button subtle" onClick={()=>setDraft(syncPayload({...draft,sections:[...draft.sections,{id:crypto.randomUUID(),label:'New section',purpose:'',content:'Write this section.',claimIds:[]}]}))}><Plus size={15}/>Adicionar seção</button>
        <div className="script-engine-approval-actions"><button className="button subtle" onClick={()=>void save('review')}>Marcar para revisão</button><button className="button primary" disabled={issues.length>0||busy==='save'} onClick={()=>void save('approved')}><CheckCircle2 size={16}/>Aprovar roteiro</button></div>
      </div>}

      {tab==='provenance'&&<div className="script-engine-content">
        <section className="script-continuity">
          <span>DOCUMENTARY PROVENANCE</span>
          <p>{documentaryMode?'Gate documental ativo para este canal.':'Canal sem gate documental obrigatório.'}</p>
        </section>
        {draft.sections.map((section,index)=><section key={section.id} className="script-continuity">
          <span>SEÇÃO {String(index+1).padStart(2,'0')} · {section.label}</span>
          {(section.claimIds??[]).length?(section.claimIds??[]).map(id=>{
            const claim=project?.research.factChecks.find(item=>item.id===id);
            if(!claim)return <p key={id}>Claim ausente: {id}</p>;
            const sources=claim.sourceIds.map(sourceId=>project?.research.sources.find(source=>source.id===sourceId)).filter(Boolean);
            return <article key={id} className="script-provenance-claim">
              <strong>{claim.claim}</strong>
              <p>{claim.status} · {claim.claimType??'legacy'} · {claim.narrationRule??'sem regra'}</p>
              {sources.length?sources.map(source=><a key={source!.id} href={source!.url} target="_blank" rel="noreferrer"><Link2 size={13}/>{source!.title} · {source!.origin??source!.sourceType}</a>):<small>Sem fonte vinculada.</small>}
            </article>;
          }):<p>Nenhum claim vinculado a esta seção.</p>}
        </section>)}
      </div>}

      {tab==='continuity'&&<div className="script-engine-content">
        <section className="script-continuity"><span>CONTINUITY NOTES</span>{draft.continuityNotes.length?draft.continuityNotes.map(item=><p key={item}>{item}</p>):<p>Nenhuma observação de continuidade registrada.</p>}</section>
        <section className="script-continuity"><span>PROVENIÊNCIA</span><p>{draft.provenance.generatedBy}{draft.provenance.model?' · '+draft.provenance.model:''}</p></section>
        <section className="script-continuity"><span>APPROVAL GATE</span>{issues.length?issues.map(item=><p key={item}>{item}</p>):<p>Sem bloqueios técnicos para aprovação.</p>}</section>
      </div>}

      {tab==='history'&&<div className="script-engine-content">
        <div className="script-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · {item.payload.wordCount} palavras · {item.payload.sections.length} seções</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('script');setMessage('Versão '+item.version+' carregada no editor.');}}>Carregar</button></article>)}</div>
      </div>}
    </div>;
  }

  return <div className="script-engine">
    {message&&<div className="script-engine-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="script-engine-list-hero"><div><span>SCRIPT ENGINE</span><h2>Roteiros que já conhecem o canal.</h2><p>Somente Content Projects aprovados entram aqui. Gere com IA ou importe um roteiro externo e continue versionando dentro da plataforma.</p></div></section>

    {readyProjects.length>0&&<section className="script-ready-projects">
      <div className="script-engine-section-head"><div><span>READY FOR SCRIPT</span><h3>Projetos aprovados esperando roteiro.</h3></div><WandSparkles size={21}/></div>
      {readyProjects.map(project=><article key={project.id}><div><strong>{project.brief.workingTitle}</strong><p>{project.brief.thesis}</p><small>{project.opportunityId?'Opportunity vinculada':'Projeto manual'}</small></div><div><button className="button primary small" disabled={!!busy} onClick={()=>void generate(project.id)}><Sparkles size={14}/>{busy==='generate:'+project.id?'Gerando…':'Gerar com IA'}</button><button className="button subtle small" onClick={()=>{setManualProjectId(project.id);setManualTitle(project.brief.workingTitle);setManualContent('');}}>Importar/manual</button></div></article>)}
    </section>}

    {manualProjectId&&<section className="script-manual-import">
      <div className="script-engine-section-head"><div><span>MANUAL / EXTERNAL</span><h3>Importar narração pronta.</h3></div><FileText size={20}/></div>
      <label><span>Título</span><input value={manualTitle} onChange={e=>setManualTitle(e.target.value)}/></label>
      <label><span>Roteiro / narração</span><textarea rows={16} value={manualContent} onChange={e=>setManualContent(e.target.value)} placeholder="Cole aqui o roteiro gerado externamente ou escrito manualmente."/></label>
      <div><button className="button subtle" onClick={()=>{setManualProjectId('');setManualContent('');}}>Cancelar</button><button className="button primary" disabled={!manualContent.trim()||busy==='save'} onClick={()=>void createManual()}>Salvar como draft</button></div>
    </section>}

    <section className="script-grid">{scripts.map(script=><article key={script.id}><div><span>{script.status}</span><em>v{script.version}</em></div><h3>{script.title}</h3><p>{script.wordCount} palavras{script.estimatedMinutes!==null?' · ~'+script.estimatedMinutes+' min':''}</p><small>{script.sections.length} seções · {script.provenance.generatedBy}</small><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openScript(script.id)}>Abrir roteiro</button></article>)}</section>

    {!scripts.length&&!readyProjects.length&&<div className="script-engine-empty"><FileText size={28}/><h3>Nenhum projeto aprovado para roteiro.</h3><p>Finalize um Content Project primeiro. O Script Engine não pula o gate editorial.</p></div>}
  </div>;
}

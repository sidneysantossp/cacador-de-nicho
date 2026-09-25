'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpenCheck, CheckCircle2, CircleAlert, FileCheck2, History,
  Image as ImageIcon, Link2, Plus, Save, Search, Sparkles, Trash2, Users, Workflow
} from 'lucide-react';
import type {
  ChannelBrain, ChannelEpisode, ContentFactCheck, ContentProject, ContentProjectPayload,
  ContentProjectVersion, ContentResearchPack, ContentResearchSource, ManagedChannel, NarrativeBundle
} from '@/lib/types';
import { contentProjectReadiness } from '@/lib/content-os-policy';

type EditorTab='brief'|'research'|'pack'|'factcheck'|'approval'|'history';
const emptyBundle:NarrativeBundle={arcs:[],episodes:[],concepts:[]};

function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:ContentProject):ContentProjectPayload{const {version:_version,status:_status,...payload}=value;return payload;}
function blankResearchPack():ContentResearchPack{return {question:'',storyAngle:'',entities:[],timeline:[],audienceSignals:[],visualLeads:[]};}
function blankProject(channel:ManagedChannel,episode:ChannelEpisode):ContentProjectPayload{
  const now=new Date().toISOString();
  return {
    kind:'content-project',
    id:crypto.randomUUID(),
    channelId:channel.id,
    episodeId:episode.id,
    opportunityId:channel.opportunityId,
    brief:{
      theme:'',
      thesis:episode.thesis||'',
      angle:'',
      promise:'',
      workingTitle:episode.title,
      thumbnailConcept:'',
      targetAudience:'',
      objective:'',
      previousEpisodeConnection:'',
      arcConnection:''
    },
    research:{notes:'',sources:[],factChecks:[],pack:blankResearchPack()},
    approval:{status:'draft',notes:''},
    createdAt:now,
    updatedAt:now
  };
}

export default function ContentOsWorkspace({channel,brain}:{channel:ManagedChannel;brain:ChannelBrain|null}){
  const [bundle,setBundle]=useState<NarrativeBundle>(emptyBundle);
  const [projects,setProjects]=useState<ContentProject[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [current,setCurrent]=useState<ContentProject|null>(null);
  const [draft,setDraft]=useState<ContentProjectPayload|null>(null);
  const [history,setHistory]=useState<ContentProjectVersion[]>([]);
  const [tab,setTab]=useState<EditorTab>('brief');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [showCreate,setShowCreate]=useState(false);

  const [newTitle,setNewTitle]=useState('');
  const [newTheme,setNewTheme]=useState('');
  const [newThesis,setNewThesis]=useState('');
  const [newAngle,setNewAngle]=useState('');
  const [newPromise,setNewPromise]=useState('');
  const [newAudience,setNewAudience]=useState('');
  const [newObjective,setNewObjective]=useState('');
  const [newArcId,setNewArcId]=useState('');
  const [newOpportunityId,setNewOpportunityId]=useState(channel.opportunityId??'');

  const [sourceTitle,setSourceTitle]=useState('');
  const [sourceUrl,setSourceUrl]=useState('');
  const [sourceType,setSourceType]=useState<ContentResearchSource['sourceType']>('primary');
  const [sourceOrigin,setSourceOrigin]=useState<NonNullable<ContentResearchSource['origin']>>('institutional');
  const [sourceRole,setSourceRole]=useState<NonNullable<ContentResearchSource['role']>>('evidence');
  const [sourceClaim,setSourceClaim]=useState('');
  const [timelineDate,setTimelineDate]=useState('');
  const [timelineEvent,setTimelineEvent]=useState('');
  const [timelineSourceIds,setTimelineSourceIds]=useState<string[]>([]);
  const [audienceKind,setAudienceKind]=useState<ContentResearchPack['audienceSignals'][number]['kind']>('question');
  const [audienceSourceId,setAudienceSourceId]=useState('');
  const [audienceSignal,setAudienceSignal]=useState('');
  const [audienceNotes,setAudienceNotes]=useState('');
  const [visualTitle,setVisualTitle]=useState('');
  const [visualUrl,setVisualUrl]=useState('');
  const [visualProvider,setVisualProvider]=useState('archive');
  const [visualMediaType,setVisualMediaType]=useState<ContentResearchPack['visualLeads'][number]['mediaType']>('image');
  const [visualPeriod,setVisualPeriod]=useState('');
  const [visualLocation,setVisualLocation]=useState('');
  const [visualRights,setVisualRights]=useState<ContentResearchPack['visualLeads'][number]['rightsStatus']>('unknown');
  const [visualLicense,setVisualLicense]=useState('');
  const [visualAttribution,setVisualAttribution]=useState('');
  const [visualNotes,setVisualNotes]=useState('');
  const [factClaim,setFactClaim]=useState('');
  const [factStatus,setFactStatus]=useState<ContentFactCheck['status']>('unverified');
  const [factNotes,setFactNotes]=useState('');
  const [factSourceIds,setFactSourceIds]=useState<string[]>([]);

  async function reload(){
    setLoading(true);setMessage('');
    try{
      const [narrativeRes,projectsRes]=await Promise.all([
        fetch(`/api/narrative?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'}),
        fetch(`/api/content-os?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'})
      ]);
      const narrativeBody=await narrativeRes.json().catch(()=>({}));
      const projectsBody=await projectsRes.json().catch(()=>({}));
      if(!narrativeRes.ok)throw new Error(narrativeBody.message??'Falha ao carregar episódios.');
      if(!projectsRes.ok)throw new Error(projectsBody.message??'Falha ao carregar Content OS.');
      setBundle(narrativeBody);
      setProjects(projectsBody.projects??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Content OS.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void reload();},[channel.id]);

  async function openProject(id:string){
    setBusy('open');setMessage('');
    try{
      const res=await fetch(`/api/content-os?projectId=${encodeURIComponent(id)}`,{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao abrir Content Project.');
      setSelectedId(id);setCurrent(body.project);setDraft(payloadOnly(body.project));setHistory(body.history??[]);setTab('brief');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao abrir Content Project.');}
    finally{setBusy('');}
  }

  const plannedEpisodeIds=useMemo(()=>new Set(projects.map(item=>item.episodeId)),[projects]);
  const unplannedEpisodes=useMemo(()=>bundle.episodes.filter(item=>!plannedEpisodeIds.has(item.id)),[bundle.episodes,plannedEpisodeIds]);
  const selectedEpisode=useMemo(()=>draft?bundle.episodes.find(item=>item.id===draft.episodeId)??null:null,[draft,bundle.episodes]);
  const readiness=useMemo(()=>draft&&selectedEpisode?contentProjectReadiness(draft,selectedEpisode,bundle.concepts,brain):null,[draft,selectedEpisode,bundle.concepts,brain]);
  const dirty=useMemo(()=>draft&&current?JSON.stringify(draft)!==JSON.stringify(payloadOnly(current)):!!draft,[draft,current]);
  const researchPack=draft?.research.pack??blankResearchPack();

  async function postProject(project:ContentProjectPayload,expectedVersion:number|null){
    const res=await fetch('/api/content-os',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedVersion,project})
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.message??'Falha ao salvar Content Project.');
    return body;
  }

  async function saveDraft(next=draft){
    if(!next)return false;
    setBusy('save');setMessage('');
    try{
      const body=await postProject({...next,updatedAt:new Date().toISOString()},current?.version??0);
      setCurrent(body.project);setDraft(payloadOnly(body.project));setHistory(body.history??[]);
      setProjects(prev=>[body.project,...prev.filter(item=>item.id!==body.project.id)]);
      setMessage(body.message??'Content Project salvo.');
      return true;
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Content Project.');return false;}
    finally{setBusy('');}
  }

  async function createManual(){
    const title=newTitle.trim();if(!title)return;
    setBusy('create');setMessage('');
    try{
      const now=new Date().toISOString();
      const episode:ChannelEpisode={
        id:crypto.randomUUID(),
        channelId:channel.id,
        arcId:newArcId||undefined,
        sequence:bundle.episodes.length+1,
        status:'idea',
        title,
        thesis:newThesis.trim(),
        narrativeSummary:newObjective.trim(),
        prerequisiteConcepts:[],
        introducesConcepts:[],
        reinforcesConcepts:[],
        opensThreads:[],
        resolvesThreads:[],
        repetitionKeys:[],
        createdAt:now,
        updatedAt:now
      };

      const episodeRes=await fetch('/api/narrative',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'episode',episode})
      });
      const episodeBody=await episodeRes.json().catch(()=>({}));
      if(!episodeRes.ok)throw new Error(episodeBody.message??'Falha ao criar episódio.');

      const project=blankProject(channel,episode);
      project.opportunityId=newOpportunityId.trim()||undefined;
      project.brief.theme=newTheme.trim();
      project.brief.thesis=newThesis.trim();
      project.brief.angle=newAngle.trim();
      project.brief.promise=newPromise.trim();
      project.brief.workingTitle=title;
      project.brief.targetAudience=newAudience.trim();
      project.brief.objective=newObjective.trim();
      project.brief.arcConnection=newArcId?(bundle.arcs.find(item=>item.id===newArcId)?.name??''):'';

      const body=await postProject(project,0);
      setBundle(episodeBody.bundle??bundle);
      setProjects(prev=>[body.project,...prev]);
      setCurrent(body.project);setDraft(payloadOnly(body.project));setHistory(body.history??[]);setSelectedId(body.project.id);setTab('brief');
      setShowCreate(false);
      setNewTitle('');setNewTheme('');setNewThesis('');setNewAngle('');setNewPromise('');setNewAudience('');setNewObjective('');setNewArcId('');
      setMessage('Content Project criado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Content Project.');}
    finally{setBusy('');}
  }

  async function createForEpisode(episode:ChannelEpisode){
    setBusy(`create:${episode.id}`);setMessage('');
    try{
      const body=await postProject(blankProject(channel,episode),0);
      setProjects(prev=>[body.project,...prev]);setCurrent(body.project);setDraft(payloadOnly(body.project));setHistory(body.history??[]);setSelectedId(body.project.id);setTab('brief');
      setMessage('Content Project criado para o episódio.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar Content Project.');}
    finally{setBusy('');}
  }

  function brief<K extends keyof ContentProjectPayload['brief']>(key:K,value:ContentProjectPayload['brief'][K]){
    setDraft(prev=>prev?{...prev,brief:{...prev.brief,[key]:value}}:prev);
  }

  function setResearchPack(next:ContentResearchPack){
    setDraft(prev=>prev?{...prev,research:{...prev.research,pack:next}}:prev);
  }

  function addSource(){
    if(!draft||!sourceTitle.trim()||!sourceUrl.trim())return;
    const source:ContentResearchSource={id:crypto.randomUUID(),title:sourceTitle.trim(),url:sourceUrl.trim(),sourceType,origin:sourceOrigin,role:sourceRole,claim:sourceClaim.trim(),checkedAt:new Date().toISOString()};
    setDraft({...draft,research:{...draft.research,sources:[...draft.research.sources,source]}});
    setSourceTitle('');setSourceUrl('');setSourceClaim('');
  }

  function addTimelineItem(){
    if(!timelineEvent.trim())return;
    setResearchPack({...researchPack,timeline:[...researchPack.timeline,{id:crypto.randomUUID(),dateLabel:timelineDate.trim(),event:timelineEvent.trim(),sourceIds:timelineSourceIds}]});
    setTimelineDate('');setTimelineEvent('');setTimelineSourceIds([]);
  }

  function addAudienceSignal(){
    if(!audienceSourceId||!audienceSignal.trim())return;
    setResearchPack({...researchPack,audienceSignals:[...researchPack.audienceSignals,{id:crypto.randomUUID(),sourceId:audienceSourceId,kind:audienceKind,signal:audienceSignal.trim(),notes:audienceNotes.trim()}]});
    setAudienceSignal('');setAudienceNotes('');
  }

  function addVisualLead(){
    if(!visualTitle.trim()||!visualUrl.trim())return;
    setResearchPack({...researchPack,visualLeads:[...researchPack.visualLeads,{id:crypto.randomUUID(),title:visualTitle.trim(),pageUrl:visualUrl.trim(),provider:visualProvider.trim()||'other',mediaType:visualMediaType,period:visualPeriod.trim(),location:visualLocation.trim(),rightsStatus:visualRights,licenseLabel:visualLicense.trim(),attribution:visualAttribution.trim(),notes:visualNotes.trim()}]});
    setVisualTitle('');setVisualUrl('');setVisualPeriod('');setVisualLocation('');setVisualLicense('');setVisualAttribution('');setVisualNotes('');setVisualRights('unknown');
  }

  function addFactCheck(){
    if(!draft||!factClaim.trim())return;
    const fact:ContentFactCheck={id:crypto.randomUUID(),claim:factClaim.trim(),status:factStatus,sourceIds:factSourceIds,notes:factNotes.trim()};
    setDraft({...draft,research:{...draft.research,factChecks:[...draft.research.factChecks,fact]}});
    setFactClaim('');setFactStatus('unverified');setFactNotes('');setFactSourceIds([]);
  }

  async function approve(){
    if(!draft)return;
    const next:ContentProjectPayload={...draft,approval:{...draft.approval,status:'approved',approvedAt:new Date().toISOString(),approvedBy:'operator'}};
    const ok=await saveDraft(next);
    if(ok)setTab('approval');
  }

  if(loading)return <div className="content-os-loading"><Sparkles className="spin" size={20}/>Carregando Content OS…</div>;

  if(draft&&selectedEpisode){
    return <div className="content-os-editor">
      <div className="content-os-back"><button onClick={()=>{setDraft(null);setCurrent(null);setSelectedId('');setHistory([]);}}><ArrowLeft size={15}/>Todos os projetos</button><span>{current?.status??'brief'} · v{current?.version??0}</span></div>

      <section className="content-os-project-hero">
        <div><span>CONTENT PROJECT</span><h2>{draft.brief.workingTitle||selectedEpisode.title}</h2><p>{draft.brief.thesis||'Defina a tese editorial antes de avançar para o roteiro.'}</p></div>
        <div><em>{readiness?.ready?'READY':'NOT READY'}</em><button className="button primary" disabled={busy==='save'||!dirty} onClick={()=>void saveDraft()}><Save size={15}/>{busy==='save'?'Salvando…':'Salvar versão'}</button></div>
      </section>

      {message&&<div className="content-os-message"><CheckCircle2 size={15}/>{message}</div>}

      <section className="content-os-readiness">
        <div><strong>{readiness?.missingBrief.length??0}</strong><small>campos essenciais faltando</small></div>
        <div><strong>{readiness?.unresolvedFactChecks.length??0}</strong><small>fact-checks não resolvidos</small></div>
        <div><strong>{readiness?.contradictedFactChecks.length??0}</strong><small>claims contraditórios</small></div>
        <div><strong>{readiness?.narrative.missingConcepts.length??0}</strong><small>pré-requisitos narrativos faltando</small></div>
        <div><strong>{readiness?.researchPackSourceErrors.length??0}</strong><small>referências quebradas no Research Pack</small></div>
        <div><strong>{readiness?.weakFactCheckEvidence.length??0}</strong><small>fact-checks sem evidência forte</small></div>
        <div><strong>{readiness?.unknownVisualRights.length??0}</strong><small>leads visuais com direitos desconhecidos</small></div>
      </section>

      <nav className="content-os-tabs">{([
        ['brief','Brief',Workflow],
        ['research','Pesquisa & Fontes',Search],
        ['pack','Research Pack',Users],
        ['factcheck','Fact-check',FileCheck2],
        ['approval','Aprovação',BookOpenCheck],
        ['history','Versões',History]
      ] as const).map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={15}/>{label}</button>)}</nav>

      {tab==='brief'&&<div className="content-os-content">
        <div className="content-os-grid two">
          <TextField label="TEMA" value={draft.brief.theme} onChange={v=>brief('theme',v)} rows={4}/>
          <TextField label="WORKING TITLE" value={draft.brief.workingTitle} onChange={v=>brief('workingTitle',v)} rows={4}/>
          <TextField label="TESE" value={draft.brief.thesis} onChange={v=>brief('thesis',v)} rows={6}/>
          <TextField label="ÂNGULO" value={draft.brief.angle} onChange={v=>brief('angle',v)} rows={6}/>
          <TextField label="PROMESSA" value={draft.brief.promise} onChange={v=>brief('promise',v)} rows={5}/>
          <TextField label="PÚBLICO DESTE EPISÓDIO" value={draft.brief.targetAudience} onChange={v=>brief('targetAudience',v)} rows={5}/>
          <TextField label="OBJETIVO" value={draft.brief.objective} onChange={v=>brief('objective',v)} rows={5}/>
          <TextField label="THUMBNAIL CONCEPT" value={draft.brief.thumbnailConcept} onChange={v=>brief('thumbnailConcept',v)} rows={5}/>
          <TextField label="CONEXÃO COM EPISÓDIO ANTERIOR" value={draft.brief.previousEpisodeConnection} onChange={v=>brief('previousEpisodeConnection',v)} rows={5}/>
          <TextField label="CONEXÃO COM O ARCO" value={draft.brief.arcConnection} onChange={v=>brief('arcConnection',v)} rows={5}/>
        </div>
        <section className="content-os-linkage"><span>NARRATIVE LINKAGE</span><div><strong>{selectedEpisode.title}</strong><small>episódio</small><strong>{bundle.arcs.find(item=>item.id===selectedEpisode.arcId)?.name??'Sem arco'}</strong><small>arco</small><strong>{draft.opportunityId||'Sem vínculo'}</strong><small>opportunity</small></div></section>
      </div>}

      {tab==='research'&&<div className="content-os-content">
        <TextField label="NOTAS DE PESQUISA" value={draft.research.notes} onChange={v=>setDraft({...draft,research:{...draft.research,notes:v}})} rows={10}/>
        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>FONTES</span><h3>Evidência rastreável.</h3></div><Link2 size={20}/></div>
          <div className="content-os-grid two">
            <Field label="Título"><input value={sourceTitle} onChange={e=>setSourceTitle(e.target.value)}/></Field>
            <Field label="URL"><input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://…"/></Field>
            <Field label="Tipo"><select value={sourceType} onChange={e=>setSourceType(e.target.value as ContentResearchSource['sourceType'])}><option value="primary">Primária</option><option value="secondary">Secundária</option><option value="reference">Referência</option></select></Field>
            <Field label="Origem"><select value={sourceOrigin} onChange={e=>setSourceOrigin(e.target.value as NonNullable<ContentResearchSource['origin']>)}><option value="institutional">Institucional</option><option value="academic">Acadêmica</option><option value="archive">Arquivo</option><option value="wikipedia">Wikipedia</option><option value="reddit">Reddit</option><option value="news">Notícia</option><option value="reference">Referência</option><option value="other">Outra</option></select></Field>
            <Field label="Papel"><select value={sourceRole} onChange={e=>setSourceRole(e.target.value as NonNullable<ContentResearchSource['role']>)}><option value="evidence">Evidência</option><option value="discovery">Descoberta</option><option value="context">Contexto</option><option value="anecdotal">Anedótica</option><option value="visual">Visual</option></select></Field>
            <Field label="Claim / uso"><input value={sourceClaim} onChange={e=>setSourceClaim(e.target.value)} placeholder="O que esta fonte sustenta?"/></Field>
          </div>
          <button className="button subtle" onClick={addSource}><Plus size={15}/>Adicionar fonte</button>
        </section>
        <div className="content-os-source-list">{draft.research.sources.map(source=><article key={source.id}><div><span>{source.sourceType} · {source.origin??'legacy'} · {source.role??'context'}</span><strong>{source.title}</strong><p>{source.claim||'Uso não descrito.'}</p><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div><button className="icon-button" onClick={()=>setDraft({...draft,research:{...draft.research,sources:draft.research.sources.filter(item=>item.id!==source.id)}})}><Trash2 size={15}/></button></article>)}</div>
      </div>}

      {tab==='pack'&&<div className="content-os-content">
        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>SOURCE INTELLIGENCE</span><h3>Research Pack do episódio.</h3><p>Wikipedia/arquivos ajudam a mapear fatos; Reddit e comunidade entram como sinais humanos, nunca como prova factual isolada.</p></div><Users size={20}/></div>
          <TextField label="PERGUNTA DE PESQUISA" value={researchPack.question} onChange={v=>setResearchPack({...researchPack,question:v})} rows={4}/>
          <TextField label="ÂNGULO NARRATIVO / STORY ANGLE" value={researchPack.storyAngle} onChange={v=>setResearchPack({...researchPack,storyAngle:v})} rows={4}/>
          <TextField label="ENTIDADES-CHAVE · UMA POR LINHA" value={researchPack.entities.join('\n')} onChange={v=>setResearchPack({...researchPack,entities:v.split('\n').map(item=>item.trim()).filter(Boolean)})} rows={6}/>
          {researchPack.provenance&&<p className="credential-note">Proveniência: {researchPack.provenance.generatedBy}{researchPack.provenance.model?' · '+researchPack.provenance.model:''}{researchPack.provenance.observedAt?' · '+when(researchPack.provenance.observedAt):''}</p>}
        </section>

        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>CRONOLOGIA</span><h3>O que mudou e quando.</h3></div><History size={20}/></div>
          <div className="content-os-grid two">
            <Field label="Data / período"><input value={timelineDate} onChange={e=>setTimelineDate(e.target.value)} placeholder="1947 · 1980s · 2026"/></Field>
            <Field label="Evento / transformação"><input value={timelineEvent} onChange={e=>setTimelineEvent(e.target.value)} placeholder="O que aconteceu neste ponto da história?"/></Field>
          </div>
          <div className="content-os-source-checks"><span>FONTES DA CRONOLOGIA</span>{draft.research.sources.map(source=><label key={source.id}><input type="checkbox" checked={timelineSourceIds.includes(source.id)} onChange={e=>setTimelineSourceIds(prev=>e.target.checked?[...prev,source.id]:prev.filter(id=>id!==source.id))}/>{source.title}</label>)}</div>
          <button className="button subtle" onClick={addTimelineItem}><Plus size={15}/>Adicionar marco</button>
        </section>
        <div className="content-os-source-list">{researchPack.timeline.map(item=><article key={item.id}><div><span>{item.dateLabel||'sem data'}</span><strong>{item.event}</strong><p>{item.sourceIds.length} fonte(s) vinculada(s)</p></div><button className="icon-button" onClick={()=>setResearchPack({...researchPack,timeline:researchPack.timeline.filter(x=>x.id!==item.id)})}><Trash2 size={15}/></button></article>)}</div>

        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>AUDIENCE SIGNALS</span><h3>Memórias, perguntas e linguagem real.</h3><p>Use principalmente Reddit/comunidades. Estes sinais são anedóticos até que um claim seja fact-checked.</p></div><Users size={20}/></div>
          <div className="content-os-grid two">
            <Field label="Fonte"><select value={audienceSourceId} onChange={e=>setAudienceSourceId(e.target.value)}><option value="">Selecione…</option>{draft.research.sources.map(source=><option key={source.id} value={source.id}>{source.title}</option>)}</select></Field>
            <Field label="Tipo de sinal"><select value={audienceKind} onChange={e=>setAudienceKind(e.target.value as ContentResearchPack['audienceSignals'][number]['kind'])}><option value="question">Pergunta</option><option value="memory">Memória</option><option value="language">Linguagem</option><option value="story">História</option><option value="sentiment">Sentimento</option></select></Field>
          </div>
          <TextField label="SINAL OBSERVADO" value={audienceSignal} onChange={setAudienceSignal} rows={3}/>
          <TextField label="NOTAS / COMO USAR" value={audienceNotes} onChange={setAudienceNotes} rows={3}/>
          <button className="button subtle" disabled={!audienceSourceId||!audienceSignal.trim()} onClick={addAudienceSignal}><Plus size={15}/>Adicionar sinal</button>
        </section>
        <div className="content-os-source-list">{researchPack.audienceSignals.map(item=>{const source=draft.research.sources.find(x=>x.id===item.sourceId);return <article key={item.id}><div><span>{item.kind} · ANEDÓTICO</span><strong>{item.signal}</strong><p>{item.notes||'Sem notas.'}</p><small>{source?.title??'Fonte ausente'}</small></div><button className="icon-button" onClick={()=>setResearchPack({...researchPack,audienceSignals:researchPack.audienceSignals.filter(x=>x.id!==item.id)})}><Trash2 size={15}/></button></article>;})}</div>

        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>VISUAL SOURCE INTELLIGENCE</span><h3>Leads visuais + direitos.</h3><p>Este é o inventário de candidatos. O Scene/Asset pipeline continuará responsável pelo asset final usado na produção.</p></div><ImageIcon size={20}/></div>
          <div className="content-os-grid two">
            <Field label="Título / asset"><input value={visualTitle} onChange={e=>setVisualTitle(e.target.value)}/></Field>
            <Field label="Página de origem"><input value={visualUrl} onChange={e=>setVisualUrl(e.target.value)} placeholder="https://…"/></Field>
            <Field label="Provider / arquivo"><input value={visualProvider} onChange={e=>setVisualProvider(e.target.value)} placeholder="NYPL · LOC · Wikimedia · Pexels"/></Field>
            <Field label="Mídia"><select value={visualMediaType} onChange={e=>setVisualMediaType(e.target.value as ContentResearchPack['visualLeads'][number]['mediaType'])}><option value="image">Imagem</option><option value="video">Vídeo</option></select></Field>
            <Field label="Período"><input value={visualPeriod} onChange={e=>setVisualPeriod(e.target.value)} placeholder="1950s · 2026"/></Field>
            <Field label="Local"><input value={visualLocation} onChange={e=>setVisualLocation(e.target.value)} placeholder="Times Square, New York"/></Field>
            <Field label="Direitos"><select value={visualRights} onChange={e=>setVisualRights(e.target.value as ContentResearchPack['visualLeads'][number]['rightsStatus'])}><option value="public-domain">Public domain</option><option value="creative-commons">Creative Commons</option><option value="licensed">Licenciado</option><option value="owned">Próprio</option><option value="hotlink-only">Hotlink only</option><option value="unknown">Desconhecido</option></select></Field>
            <Field label="Licença"><input value={visualLicense} onChange={e=>setVisualLicense(e.target.value)} placeholder="CC BY 4.0 · Public Domain · Pexels License"/></Field>
          </div>
          <TextField label="ATRIBUIÇÃO" value={visualAttribution} onChange={setVisualAttribution} rows={2}/>
          <TextField label="NOTAS VISUAIS" value={visualNotes} onChange={setVisualNotes} rows={3}/>
          <button className="button subtle" disabled={!visualTitle.trim()||!visualUrl.trim()} onClick={addVisualLead}><Plus size={15}/>Adicionar lead visual</button>
        </section>
        <div className="content-os-source-list">{researchPack.visualLeads.map(item=><article key={item.id}><div><span>{item.provider} · {item.mediaType} · {item.rightsStatus}</span><strong>{item.title}</strong><p>{[item.period,item.location,item.licenseLabel].filter(Boolean).join(' · ')||'Metadados ainda incompletos.'}</p><a href={item.pageUrl} target="_blank" rel="noreferrer">{item.pageUrl}</a></div><button className="icon-button" onClick={()=>setResearchPack({...researchPack,visualLeads:researchPack.visualLeads.filter(x=>x.id!==item.id)})}><Trash2 size={15}/></button></article>)}</div>
      </div>}

      {tab==='factcheck'&&<div className="content-os-content">
        <section className="content-os-source-form">
          <div className="content-os-section-head"><div><span>FACT CHECK</span><h3>Claim por claim.</h3></div><FileCheck2 size={20}/></div>
          <TextField label="CLAIM" value={factClaim} onChange={setFactClaim} rows={4}/>
          <div className="content-os-grid two">
            <Field label="Status"><select value={factStatus} onChange={e=>setFactStatus(e.target.value as ContentFactCheck['status'])}><option value="unverified">Não verificado</option><option value="supported">Sustentado</option><option value="needs-review">Precisa revisão</option><option value="contradicted">Contraditório</option></select></Field>
            <TextField label="NOTAS" value={factNotes} onChange={setFactNotes} rows={4}/>
          </div>
          <div className="content-os-source-checks"><span>FONTES QUE SUSTENTAM O CLAIM</span>{draft.research.sources.map(source=><label key={source.id}><input type="checkbox" checked={factSourceIds.includes(source.id)} onChange={e=>setFactSourceIds(prev=>e.target.checked?[...prev,source.id]:prev.filter(id=>id!==source.id))}/>{source.title}</label>)}</div>
          <button className="button subtle" onClick={addFactCheck}><Plus size={15}/>Adicionar fact-check</button>
        </section>
        <div className="content-os-fact-list">{draft.research.factChecks.map(item=><article key={item.id} className={item.status}><div><span>{item.status}</span><strong>{item.claim}</strong><p>{item.notes||'Sem notas.'}</p><small>{item.sourceIds.length} fonte(s) vinculada(s)</small></div><button className="icon-button" onClick={()=>setDraft({...draft,research:{...draft.research,factChecks:draft.research.factChecks.filter(x=>x.id!==item.id)}})}><Trash2 size={15}/></button></article>)}</div>
      </div>}

      {tab==='approval'&&<div className="content-os-content">
        <section className={readiness?.ready?'content-os-approval ready':'content-os-approval blocked'}>
          {readiness?.ready?<CheckCircle2 size={32}/>:<CircleAlert size={32}/>}
          <div><span>PRE-SCRIPT GATE</span><h3>{readiness?.ready?'Projeto pronto para aprovação.':'Ainda existem bloqueios.'}</h3><p>{readiness?.ready?'O brief, fact-check e continuidade narrativa estão consistentes para liberar o Script Engine.':'Corrija os itens abaixo antes de aprovar para roteiro.'}</p></div>
        </section>
        {!readiness?.ready&&<div className="content-os-blockers">{readiness?.blockers.map(item=><span key={item}>{item}</span>)}</div>}
        <TextField label="NOTAS DE APROVAÇÃO" value={draft.approval.notes} onChange={v=>setDraft({...draft,approval:{...draft.approval,notes:v}})} rows={6}/>
        <div className="content-os-approval-actions">
          <button className="button subtle" onClick={()=>setDraft({...draft,approval:{...draft.approval,status:'blocked',approvedAt:undefined,approvedBy:undefined}})}>Bloquear projeto</button>
          <button className="button primary" disabled={!readiness?.ready||busy==='save'} onClick={()=>void approve()}><BookOpenCheck size={16}/>Aprovar para roteiro</button>
        </div>
      </div>}

      {tab==='history'&&<div className="content-os-content">
        <div className="content-os-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.status} · {item.payload.brief.workingTitle||'Sem título'}</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('brief');setMessage(`Versão ${item.version} carregada no editor.`);}}>Carregar</button></article>)}</div>
      </div>}
    </div>;
  }

  return <div className="content-os">
    {message&&<div className="content-os-message"><CheckCircle2 size={15}/>{message}</div>}
    <section className="content-os-hero">
      <div><span>CONTENT OS</span><h2>Do próximo episódio ao brief aprovado.</h2><p>Planeje antes de escrever. O Script Engine só receberá projetos que passaram por contexto narrativo, pesquisa, fact-check e aprovação.</p></div>
      <button className="button primary" onClick={()=>setShowCreate(v=>!v)}><Plus size={16}/>{showCreate?'Fechar':'Novo Content Project'}</button>
    </section>

    {showCreate&&<section className="content-os-create">
      <div className="content-os-grid two">
        <Field label="Working title"><input value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></Field>
        <Field label="Arco"><select value={newArcId} onChange={e=>setNewArcId(e.target.value)}><option value="">Sem arco</option>{bundle.arcs.map(arc=><option key={arc.id} value={arc.id}>{arc.name}</option>)}</select></Field>
        <Field label="Opportunity ID"><input value={newOpportunityId} onChange={e=>setNewOpportunityId(e.target.value)} placeholder="Opcional"/></Field>
        <Field label="Tema"><input value={newTheme} onChange={e=>setNewTheme(e.target.value)}/></Field>
      </div>
      <TextField label="TESE" value={newThesis} onChange={setNewThesis} rows={4}/>
      <div className="content-os-grid two">
        <TextField label="ÂNGULO" value={newAngle} onChange={setNewAngle} rows={4}/>
        <TextField label="PROMESSA" value={newPromise} onChange={setNewPromise} rows={4}/>
        <TextField label="PÚBLICO" value={newAudience} onChange={setNewAudience} rows={4}/>
        <TextField label="OBJETIVO" value={newObjective} onChange={setNewObjective} rows={4}/>
      </div>
      <button className="button primary" disabled={busy==='create'||!newTitle.trim()} onClick={()=>void createManual()}>{busy==='create'?'Criando…':'Criar episódio + Content Project'}</button>
    </section>}

    {unplannedEpisodes.length>0&&<section className="content-os-unplanned">
      <div className="content-os-section-head"><div><span>EPISÓDIOS SEM BRIEF</span><h3>Continue de onde já começou.</h3></div><Workflow size={20}/></div>
      {unplannedEpisodes.map(episode=><article key={episode.id}><div><strong>{episode.title}</strong><small>{episode.status} · EP {episode.sequence}</small></div><button className="button subtle small" disabled={busy===`create:${episode.id}`} onClick={()=>void createForEpisode(episode)}>Criar Content Project</button></article>)}
    </section>}

    <section className="content-os-project-grid">{projects.map(project=>{
      const episode=bundle.episodes.find(item=>item.id===project.episodeId);
      return <article key={project.id}><div className="content-os-project-top"><span>{project.status}</span><em>v{project.version}</em></div><h3>{project.brief.workingTitle||episode?.title||'Sem título'}</h3><p>{project.brief.thesis||'Tese ainda não definida.'}</p><div><small>{project.research.sources.length} fontes</small><small>{project.research.factChecks.length} fact-checks</small><small>{project.opportunityId?'opportunity linked':'manual'}</small></div><button className="button subtle small" disabled={busy==='open'} onClick={()=>void openProject(project.id)}>Abrir projeto</button></article>;
    })}</section>

    {!projects.length&&!unplannedEpisodes.length&&<div className="content-os-empty"><BookOpenCheck size={28}/><h3>O Content OS está pronto.</h3><p>Crie o próximo episódio manualmente ou transforme uma oportunidade em um projeto editorial.</p></div>}
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="content-os-field"><span>{label}</span>{children}</label>;}
function TextField({label,value,onChange,rows=4}:{label:string;value:string;onChange:(value:string)=>void;rows?:number}){return <label className="content-os-text"><span>{label}</span><textarea rows={rows} value={value} onChange={e=>onChange(e.target.value)}/></label>;}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Image as ImageIcon,
  LoaderCircle, RefreshCw, Save, ShieldCheck, Sparkles, Upload
} from 'lucide-react';
import type {
  ManagedChannel, PublicationPackage, PublicationPackagePayload,
  ProductionQualityReport, RenderJob
} from '@/lib/types';
import {
  publicationPackageIssues, YOUTUBE_CATEGORIES
} from '@/lib/publication-package-policy';

function when(value:string){
  return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});
}
function packagePayload(pkg:PublicationPackage):PublicationPackagePayload{
  const {
    version:_version,status:_status,thumbnailSignedUrl:_thumbnailSignedUrl,
    renderOutputSignedUrl:_renderOutputSignedUrl,...payload
  }=pkg;
  return payload;
}
function tagsText(tags:string[]){return tags.join(', ');}
function parseTags(value:string){return value.split(',').map(item=>item.trim()).filter(Boolean);}

export default function PublicationPackageWorkspace({channel}:{channel:ManagedChannel}){
  const [packages,setPackages]=useState<PublicationPackage[]>([]);
  const [qualityReports,setQualityReports]=useState<ProductionQualityReport[]>([]);
  const [eligible,setEligible]=useState<ProductionQualityReport[]>([]);
  const [renders,setRenders]=useState<RenderJob[]>([]);
  const [drafts,setDrafts]=useState<Record<string,PublicationPackagePayload>>({});
  const [busy,setBusy]=useState('');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');

  const qualityById=useMemo(()=>new Map(
    qualityReports.map(item=>[item.id,item])
  ),[qualityReports]);
  const renderById=useMemo(()=>new Map(renders.map(render=>[render.id,render])),[renders]);

  async function load(silent=false){
    if(!silent)setLoading(true);
    try{
      const res=await fetch('/api/publication-package?channelId='+encodeURIComponent(channel.id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar Publication Packaging.');
      const nextPackages=(body.packages??[]) as PublicationPackage[];
      const nextQuality=(body.qualityReports??[]) as ProductionQualityReport[];
      const nextEligible=(body.eligibleQualityReports??[]) as ProductionQualityReport[];
      const nextRenders=(body.renders??[]) as RenderJob[];
      setPackages(nextPackages);
      setQualityReports(nextQuality);
      setEligible(nextEligible);
      setRenders(nextRenders);
      setDrafts(Object.fromEntries(nextPackages.map(pkg=>[pkg.id,packagePayload(pkg)])));
    }catch(error){
      if(!silent)setMessage(error instanceof Error?error.message:'Falha ao carregar Publication Packaging.');
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{void load();},[channel.id]);

  async function jsonAction(body:Record<string,unknown>,key:string){
    setBusy(key);setMessage('');
    try{
      const res=await fetch('/api/publication-package',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha no Publication Package.');
      setMessage(result.message??'Operação concluída.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no Publication Package.');
    }finally{setBusy('');}
  }

  async function uploadThumbnail(pkg:PublicationPackage,file:File|null){
    if(!file)return;
    setBusy('thumb:'+pkg.id);setMessage('');
    try{
      const form=new FormData();
      form.set('packageId',pkg.id);
      form.set('expectedVersion',String(pkg.version));
      form.set('file',file);
      const res=await fetch('/api/publication-package',{method:'POST',body:form});
      const result=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(result.message??'Falha no upload da thumbnail.');
      setMessage(result.message??'Thumbnail salva.');
      await load(true);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Falha no upload da thumbnail.');
    }finally{setBusy('');}
  }

  function update(pkgId:string,mutate:(payload:PublicationPackagePayload)=>PublicationPackagePayload){
    setDrafts(prev=>({...prev,[pkgId]:mutate(prev[pkgId])}));
  }

  if(loading)return <div className="publication-loading"><Sparkles className="spin" size={20}/>Carregando Publication Packaging…</div>;

  return <div className="publication-engine">
    {message&&<div className="publication-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="publication-hero">
      <div>
        <span>PUBLICATION PACKAGING</span>
        <h2>Do release aprovado ao pacote pronto para o YouTube.</h2>
        <p>Título, descrição, tags, categoria, audiência, disclosure e thumbnail ficam versionados e presos ao render aprovado pelo Production QA.</p>
      </div>
      <ShieldCheck size={35}/>
    </section>

    <section className="publication-eligible">
      <div className="publication-section-head">
        <div><span>APPROVED RELEASES</span><h3>Prontos para empacotar.</h3><p>Somente Production QA aprovado aparece aqui.</p></div>
        <button className="button subtle small" disabled={busy==='refresh'} onClick={()=>{setBusy('refresh');void load().finally(()=>setBusy(''));}}><RefreshCw size={14}/>Atualizar</button>
      </div>
      <div className="publication-release-list">
        {eligible.map(report=><article key={report.id}>
          <div><strong>QA v{report.version}</strong><span>render {report.renderJobId.slice(0,8)} · {when(report.checkedAt)}</span></div>
          <button className="button primary small" disabled={busy==='create:'+report.id} onClick={()=>void jsonAction({action:'create',qualityReportId:report.id},'create:'+report.id)}>
            {busy==='create:'+report.id?<LoaderCircle className="spin" size={13}/>:<Sparkles size={13}/>}
            Criar package
          </button>
        </article>)}
        {!eligible.length&&<div className="publication-empty-inline">Nenhum novo release aprovado aguardando package.</div>}
      </div>
    </section>

    <section className="publication-packages">
      <div className="publication-section-head"><div><span>PACKAGES</span><h3>Metadados e thumbnail.</h3></div></div>

      <div className="publication-package-list">{packages.map(pkg=>{
        const draft=drafts[pkg.id]??packagePayload(pkg);
        const quality=qualityById.get(pkg.qualityReportId)??null;
        const render=renderById.get(pkg.renderJobId)??null;
        const issues=publicationPackageIssues(draft,{qualityReport:quality,renderJob:render});
        const blockers=issues.filter(issue=>issue.level==='blocker');
        const warnings=issues.filter(issue=>issue.level==='warning');
        const approved=pkg.status==='approved';

        return <article key={pkg.id} className={'publication-package '+pkg.status}>
          <header>
            <div>
              <span>PACKAGE v{pkg.version}</span>
              <h3>{draft.metadata.title||'Sem título'}</h3>
              <p>QA v{draft.qualityReportVersion} · render {pkg.renderJobId.slice(0,8)}</p>
            </div>
            <div className={'publication-status '+pkg.status}>{pkg.status.toUpperCase()}</div>
          </header>

          <div className="publication-grid two">
            <label>Título <em>{draft.metadata.title.length}/100</em>
              <input disabled={approved} value={draft.metadata.title} maxLength={100} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,title:e.target.value}}))}/>
            </label>
            <label>Idioma
              <input disabled={approved} value={draft.metadata.language} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,language:e.target.value}}))}/>
            </label>
          </div>

          <label className="publication-full">Descrição <em>{draft.metadata.description.length}/5000</em>
            <textarea disabled={approved} rows={7} maxLength={5000} value={draft.metadata.description} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,description:e.target.value}}))}/>
          </label>

          <label className="publication-full">Tags <em>{tagsText(draft.metadata.tags).length}/500</em>
            <input disabled={approved} value={tagsText(draft.metadata.tags)} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,tags:parseTags(e.target.value)}}))}/>
          </label>

          <div className="publication-grid four">
            <label>Categoria
              <select disabled={approved} value={draft.metadata.categoryId} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,categoryId:e.target.value}}))}>
                <option value="">Selecione</option>
                {YOUTUBE_CATEGORIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>Visibilidade inicial
              <select disabled={approved} value={draft.metadata.visibility} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,visibility:e.target.value as PublicationPackagePayload['metadata']['visibility']}}))}>
                <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
              </select>
            </label>
            <label>Audiência / COPPA
              <select disabled={approved} value={draft.metadata.audience} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,audience:e.target.value as PublicationPackagePayload['metadata']['audience']}}))}>
                <option value="unset">Revisar</option><option value="not-made-for-kids">Não destinado a crianças</option><option value="made-for-kids">Destinado a crianças</option>
              </select>
            </label>
            <label>Mídia sintética
              <select disabled={approved} value={draft.metadata.syntheticMediaDisclosure} onChange={e=>update(pkg.id,p=>({...p,metadata:{...p.metadata,syntheticMediaDisclosure:e.target.value as PublicationPackagePayload['metadata']['syntheticMediaDisclosure']}}))}>
                <option value="review">Revisar</option><option value="yes">Disclosure necessário</option><option value="no">Disclosure não necessário</option>
              </select>
            </label>
          </div>

          <section className="publication-thumbnail">
            <div className="publication-thumbnail-preview">
              {pkg.thumbnailSignedUrl?<img src={pkg.thumbnailSignedUrl} alt={draft.thumbnail.altText||'Thumbnail'}/>:<div><ImageIcon size={30}/><span>Sem thumbnail</span></div>}
            </div>
            <div className="publication-thumbnail-controls">
              <div><span>THUMBNAIL</span><strong>{draft.thumbnail.width&&draft.thumbnail.height?draft.thumbnail.width+'×'+draft.thumbnail.height:'JPEG/PNG · até 2 MB · 16:9'}</strong></div>
              {!approved&&<label className="publication-upload"><Upload size={14}/>{busy==='thumb:'+pkg.id?'Enviando…':'Upload thumbnail'}<input type="file" accept="image/jpeg,image/png" disabled={busy==='thumb:'+pkg.id} onChange={e=>{void uploadThumbnail(pkg,e.target.files?.[0]??null);e.currentTarget.value='';}}/></label>}
              <label>Conceito<textarea disabled={approved} rows={3} value={draft.thumbnail.concept} onChange={e=>update(pkg.id,p=>({...p,thumbnail:{...p.thumbnail,concept:e.target.value}}))}/></label>
              <label>Texto visual<input disabled={approved} value={draft.thumbnail.overlayText} onChange={e=>update(pkg.id,p=>({...p,thumbnail:{...p.thumbnail,overlayText:e.target.value}}))}/></label>
              <label>Alt / descrição interna<input disabled={approved} value={draft.thumbnail.altText} onChange={e=>update(pkg.id,p=>({...p,thumbnail:{...p.thumbnail,altText:e.target.value}}))}/></label>
            </div>
          </section>

          <div className="publication-issues">
            {blockers.map(issue=><div key={issue.code} className="blocker"><AlertTriangle size={13}/>{issue.message}</div>)}
            {warnings.map(issue=><div key={issue.code} className="warning"><AlertTriangle size={13}/>{issue.message}</div>)}
            {!issues.length&&<div className="ready"><CheckCircle2 size={13}/>Package pronto para aprovação.</div>}
          </div>

          <label className="publication-full">Notas do operador
            <textarea disabled={approved} rows={3} value={draft.review.notes} onChange={e=>update(pkg.id,p=>({...p,review:{...p.review,notes:e.target.value}}))}/>
          </label>

          <footer>
            <div>
              {pkg.renderOutputSignedUrl&&<a className="button subtle small" href={pkg.renderOutputSignedUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>MP4</a>}
              {pkg.thumbnailSignedUrl&&<a className="button subtle small" href={pkg.thumbnailSignedUrl} target="_blank" rel="noreferrer"><ImageIcon size={13}/>Thumbnail</a>}
            </div>
            {!approved&&<div>
              <button className="button subtle" disabled={busy==='save:'+pkg.id} onClick={()=>void jsonAction({action:'save',packageId:pkg.id,expectedVersion:pkg.version,payload:draft},'save:'+pkg.id)}><Save size={14}/>{busy==='save:'+pkg.id?'Salvando…':'Salvar rascunho'}</button>
              <button className="button primary" disabled={blockers.length>0||busy==='approve:'+pkg.id} onClick={()=>void jsonAction({action:'approve',packageId:pkg.id,expectedVersion:pkg.version,payload:draft},'approve:'+pkg.id)}><ShieldCheck size={14}/>{busy==='approve:'+pkg.id?'Aprovando…':'Aprovar package'}</button>
            </div>}
            {approved&&<div className="publication-approved"><CheckCircle2 size={16}/>Pronto para publicação</div>}
          </footer>
        </article>;
      })}</div>

      {!packages.length&&<div className="publication-empty"><ShieldCheck size={28}/><h3>Nenhum package criado.</h3><p>Aprove um Production QA e crie o primeiro pacote de publicação.</p></div>}
    </section>
  </div>;
}

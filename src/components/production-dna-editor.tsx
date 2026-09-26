'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, CheckCircle2, Clapperboard, History, Image as ImageIcon,
  Mic2, Plus, Save, Sparkles, Trash2, UserRound, WandSparkles
} from 'lucide-react';
import type {
  ManagedChannel, ProductionDNA, ProductionDnaCharacter, ProductionDnaPayload,
  ProductionDnaVersion
} from '@/lib/types';
import { productionDnaFormatIssues } from '@/lib/production-dna-policy';

type Tab='visual'|'characters'|'voice'|'editing'|'providers'|'history';

function parseLines(value:string){return value.split('\n').map(item=>item.trim()).filter(Boolean);}
function lines(value:string[]){return value.join('\n');}
function num(value:string){if(!value.trim())return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function when(value:string){return new Date(value).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'});}
function payloadOnly(value:ProductionDNA):ProductionDnaPayload{const {version:_version,...payload}=value;return payload;}
function blank(channel:ManagedChannel):ProductionDnaPayload{
  const now=new Date().toISOString();
  return {
    kind:'production-dna',
    channelId:channel.id,
    format:{aspectRatio:'16:9',width:1920,height:1080,fps:30,targetDurationMinutes:{min:null,max:null},sceneDurationSeconds:{min:null,preferred:null,max:null}},
    visual:{styleName:'',styleDescription:'',palette:[],compositionRules:[],cameraRules:[],motionRules:[],basePrompt:'',scenePromptTemplate:'{{scene_direction}} + {{character_bible}} + {{visual_bible}} + {{negative_rules}} + {{aspect_ratio}}',negativePrompt:'',forbidden:[]},
    characters:[],
    voice:{language:'English',providerPreference:[],voiceId:'',voiceName:'',narrationStyle:[],paceWpm:null,pronunciationRules:[]},
    captions:{
      enabled:true,styleDescription:'',position:'bottom-center',maxWordsPerCaption:null,highlightKeywords:false,
      longFormMode:false,highlightMode:'none',emphasizeFacts:false,safeMarginPercent:6,maxLines:2
    },
    editing:{transitions:[],defaultTransition:'cut',kenBurns:false,musicStyle:[],sfxRules:[],pacingRules:[]},
    thumbnail:{styleRules:[],forbidden:[]},
    providers:{image:[],video:[],voice:[],stock:[]},
    createdAt:now,updatedAt:now
  };
}

export default function ProductionDnaEditor({channel}:{channel:ManagedChannel}){
  const [tab,setTab]=useState<Tab>('visual');
  const [current,setCurrent]=useState<ProductionDNA|null>(null);
  const [draft,setDraft]=useState<ProductionDnaPayload>(()=>blank(channel));
  const [history,setHistory]=useState<ProductionDnaVersion[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setMessage('');
    void fetch(`/api/production-dna?channelId=${encodeURIComponent(channel.id)}`,{cache:'no-store'})
      .then(async res=>{
        const body=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(body.message??'Falha ao carregar Production DNA.');
        if(cancelled)return;
        setCurrent(body.dna??null);
        setDraft(body.dna?payloadOnly(body.dna):blank(channel));
        setHistory(body.history??[]);
      })
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Falha ao carregar Production DNA.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[channel.id]);

  const formatIssues=useMemo(()=>productionDnaFormatIssues(draft),[draft]);
  const dirty=useMemo(()=>{
    const base=current?JSON.stringify({...current,version:undefined}):JSON.stringify(blank(channel));
    return JSON.stringify(draft)!==base;
  },[current,draft,channel]);

  async function save(){
    if(formatIssues.length){setMessage('Corrija os intervalos de duração antes de salvar o Production DNA.');return;}
    setBusy(true);setMessage('');
    try{
      const next={...draft,updatedAt:new Date().toISOString()};
      const res=await fetch('/api/production-dna',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:current?.version??0,dna:next})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao salvar Production DNA.');
      setCurrent(body.dna);setDraft(payloadOnly(body.dna));setHistory(body.history??[]);
      setMessage(body.message??'Production DNA salvo.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao salvar Production DNA.');}
    finally{setBusy(false);}
  }

  function format<K extends keyof ProductionDnaPayload['format']>(key:K,value:ProductionDnaPayload['format'][K]){setDraft(prev=>({...prev,format:{...prev.format,[key]:value}}));}
  function visual<K extends keyof ProductionDnaPayload['visual']>(key:K,value:ProductionDnaPayload['visual'][K]){setDraft(prev=>({...prev,visual:{...prev.visual,[key]:value}}));}
  function voice<K extends keyof ProductionDnaPayload['voice']>(key:K,value:ProductionDnaPayload['voice'][K]){setDraft(prev=>({...prev,voice:{...prev.voice,[key]:value}}));}
  function editing<K extends keyof ProductionDnaPayload['editing']>(key:K,value:ProductionDnaPayload['editing'][K]){setDraft(prev=>({...prev,editing:{...prev.editing,[key]:value}}));}
  function providers<K extends keyof ProductionDnaPayload['providers']>(key:K,value:ProductionDnaPayload['providers'][K]){setDraft(prev=>({...prev,providers:{...prev.providers,[key]:value}}));}
  function character(index:number,next:ProductionDnaCharacter){setDraft(prev=>({...prev,characters:prev.characters.map((item,i)=>i===index?next:item)}));}

  if(loading)return <div className="production-dna-loading"><Sparkles className="spin" size={20}/>Carregando Production DNA…</div>;

  const tabs:Array<{id:Tab;label:string;icon:React.ReactNode;count?:number}>=[
    {id:'visual',label:'Visual & Formato',icon:<ImageIcon size={15}/>},
    {id:'characters',label:'Character Bible',icon:<UserRound size={15}/>,count:draft.characters.length},
    {id:'voice',label:'Voz & Captions',icon:<Mic2 size={15}/>},
    {id:'editing',label:'Edição',icon:<Clapperboard size={15}/>},
    {id:'providers',label:'Providers',icon:<WandSparkles size={15}/>},
    {id:'history',label:'Versões',icon:<History size={15}/>,count:history.length}
  ];

  return <div className="production-dna">
    <section className="production-dna-hero">
      <div><span>PRODUCTION DNA</span><h2>Como um vídeo de {channel.name} deve ser fabricado.</h2><p>Esta receita é independente do provider. Ela pode orientar produção interna, Nano Banana, ElevenLabs, bancos de mídia ou qualquer ferramenta externa.</p></div>
      <div><em>v{current?.version??0}</em><span className={formatIssues.length?'pending':dirty?'pending':'saved'}>{formatIssues.length?`${formatIssues.length} conflito(s)`:dirty?'alterações não salvas':'salvo'}</span><button className="button primary" disabled={busy||!dirty||formatIssues.length>0} onClick={()=>void save()}><Save size={15}/>{busy?'Salvando…':'Salvar nova versão'}</button></div>
    </section>

    {message&&<div className="production-dna-message"><CheckCircle2 size={15}/>{message}</div>}

    <nav className="production-dna-tabs">{tabs.map(item=><button key={item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.icon}{item.label}{item.count!==undefined&&<b>{item.count}</b>}</button>)}</nav>

    {tab==='visual'&&<div className="production-dna-content">
      <section className="production-dna-format">
        <Field label="Aspect ratio"><input value={draft.format.aspectRatio} onChange={e=>format('aspectRatio',e.target.value)}/></Field>
        <Field label="Largura"><input type="number" value={draft.format.width} onChange={e=>format('width',Number(e.target.value))}/></Field>
        <Field label="Altura"><input type="number" value={draft.format.height} onChange={e=>format('height',Number(e.target.value))}/></Field>
        <Field label="FPS"><input type="number" value={draft.format.fps} onChange={e=>format('fps',Number(e.target.value))}/></Field>
        <Field label="Duração alvo mínima (min)"><input type="number" step="0.1" value={draft.format.targetDurationMinutes.min??''} onChange={e=>format('targetDurationMinutes',{...draft.format.targetDurationMinutes,min:num(e.target.value)})}/></Field>
        <Field label="Duração alvo máxima (min)"><input type="number" step="0.1" value={draft.format.targetDurationMinutes.max??''} onChange={e=>format('targetDurationMinutes',{...draft.format.targetDurationMinutes,max:num(e.target.value)})}/></Field>
        <Field label="Cena mínima (s)"><input type="number" step="0.1" value={draft.format.sceneDurationSeconds.min??''} onChange={e=>format('sceneDurationSeconds',{...draft.format.sceneDurationSeconds,min:num(e.target.value)})}/></Field>
        <Field label="Cena preferida (s)"><input type="number" step="0.1" value={draft.format.sceneDurationSeconds.preferred??''} onChange={e=>format('sceneDurationSeconds',{...draft.format.sceneDurationSeconds,preferred:num(e.target.value)})}/></Field>
        <Field label="Cena máxima (s)"><input type="number" step="0.1" value={draft.format.sceneDurationSeconds.max??''} onChange={e=>format('sceneDurationSeconds',{...draft.format.sceneDurationSeconds,max:num(e.target.value)})}/></Field>
      </section>

      <div className="production-dna-grid two">
        <TextField label="NOME DO ESTILO" value={draft.visual.styleName} onChange={v=>visual('styleName',v)} rows={3}/>
        <TextField label="DESCRIÇÃO VISUAL" value={draft.visual.styleDescription} onChange={v=>visual('styleDescription',v)} rows={6}/>
      </div>
      <div className="production-dna-grid two">
        <ListField label="PALETA" value={draft.visual.palette} onChange={v=>visual('palette',v)}/>
        <ListField label="REGRAS DE COMPOSIÇÃO" value={draft.visual.compositionRules} onChange={v=>visual('compositionRules',v)}/>
        <ListField label="REGRAS DE CÂMERA" value={draft.visual.cameraRules} onChange={v=>visual('cameraRules',v)}/>
        <ListField label="REGRAS DE MOVIMENTO" value={draft.visual.motionRules} onChange={v=>visual('motionRules',v)}/>
      </div>
      <TextField label="BASE PROMPT / VISUAL BIBLE" value={draft.visual.basePrompt} onChange={v=>visual('basePrompt',v)} rows={8}/>
      <TextField label="TEMPLATE DE COMPOSIÇÃO DA CENA" value={draft.visual.scenePromptTemplate} onChange={v=>visual('scenePromptTemplate',v)} rows={5}/>
      <TextField label="NEGATIVE PROMPT" value={draft.visual.negativePrompt} onChange={v=>visual('negativePrompt',v)} rows={7}/>
      <ListField label="PROIBIDO VISUALMENTE" value={draft.visual.forbidden} onChange={v=>visual('forbidden',v)}/>
    </div>}

    {tab==='characters'&&<div className="production-dna-content">
      <div className="production-dna-section-head"><div><span>CHARACTER BIBLE</span><h3>Consistência visual por personagem.</h3></div><button className="button subtle" onClick={()=>setDraft(prev=>({...prev,characters:[...prev.characters,{id:crypto.randomUUID(),name:'',description:'',visualRules:[],forbidden:[],referenceAssets:[]}]}))}><Plus size={15}/>Novo personagem</button></div>
      {!draft.characters.length&&<div className="production-dna-empty">Nenhum personagem cadastrado.</div>}
      {draft.characters.map((item,index)=><section className="production-character" key={item.id}>
        <header><UserRound size={20}/><input value={item.name} onChange={e=>character(index,{...item,name:e.target.value})} placeholder="Nome do personagem"/><button className="icon-button" onClick={()=>setDraft(prev=>({...prev,characters:prev.characters.filter((_,i)=>i!==index)}))}><Trash2 size={15}/></button></header>
        <TextField label="DESCRIÇÃO" value={item.description} onChange={v=>character(index,{...item,description:v})} rows={4}/>
        <div className="production-dna-grid three">
          <ListField label="REGRAS VISUAIS" value={item.visualRules} onChange={v=>character(index,{...item,visualRules:v})}/>
          <ListField label="PROIBIDO" value={item.forbidden} onChange={v=>character(index,{...item,forbidden:v})}/>
          <ListField label="ASSETS DE REFERÊNCIA" value={item.referenceAssets} onChange={v=>character(index,{...item,referenceAssets:v})}/>
        </div>
      </section>)}
    </div>}

    {tab==='voice'&&<div className="production-dna-content">
      <section className="production-dna-format voice">
        <Field label="Idioma"><input value={draft.voice.language} onChange={e=>voice('language',e.target.value)}/></Field>
        <Field label="Voice ID"><input value={draft.voice.voiceId} onChange={e=>voice('voiceId',e.target.value)} placeholder="Opcional"/></Field>
        <Field label="Nome da voz"><input value={draft.voice.voiceName} onChange={e=>voice('voiceName',e.target.value)} placeholder="Opcional"/></Field>
        <Field label="Pace WPM"><input type="number" value={draft.voice.paceWpm??''} onChange={e=>voice('paceWpm',num(e.target.value))}/></Field>
      </section>
      <div className="production-dna-grid two">
        <ListField label="PROVIDERS DE VOZ PREFERIDOS" value={draft.voice.providerPreference} onChange={v=>voice('providerPreference',v)}/>
        <ListField label="ESTILO DE NARRAÇÃO" value={draft.voice.narrationStyle} onChange={v=>voice('narrationStyle',v)}/>
        <ListField label="PRONÚNCIA / REGRAS" value={draft.voice.pronunciationRules} onChange={v=>voice('pronunciationRules',v)}/>
      </div>
      <section className="production-dna-captions">
        <label><input type="checkbox" checked={draft.captions.enabled} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,enabled:e.target.checked}}))}/>Legendas habilitadas</label>
        <label><input type="checkbox" checked={draft.captions.longFormMode??false} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,longFormMode:e.target.checked}}))}/>Modo Long-Form adaptativo</label>
        <label><input type="checkbox" checked={draft.captions.emphasizeFacts??false} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,emphasizeFacts:e.target.checked}}))}/>Destacar números, datas e nomes</label>
        <label><input type="checkbox" checked={draft.captions.highlightKeywords} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,highlightKeywords:e.target.checked}}))}/>Compatibilidade: destacar palavras-chave</label>
        <Field label="Realce">
          <select value={draft.captions.highlightMode??(draft.captions.highlightKeywords?'keywords':'none')} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,highlightMode:e.target.value as 'none'|'keywords'|'active-word'}}))}>
            <option value="none">Nenhum</option>
            <option value="keywords">Palavras-chave / fatos</option>
            <option value="active-word">Palavra falada</option>
          </select>
        </Field>
        <Field label="Posição"><input value={draft.captions.position} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,position:e.target.value}}))}/></Field>
        <Field label="Máx. palavras/bloco"><input type="number" min="2" max="30" value={draft.captions.maxWordsPerCaption??''} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,maxWordsPerCaption:num(e.target.value)}}))}/></Field>
        <Field label="Máx. linhas"><input type="number" min="1" max="6" value={draft.captions.maxLines??2} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,maxLines:Math.max(1,Math.min(6,Number(e.target.value)||2))}}))}/></Field>
        <Field label="Safe area (%)"><input type="number" min="0" max="25" step="0.5" value={draft.captions.safeMarginPercent??6} onChange={e=>setDraft(prev=>({...prev,captions:{...prev.captions,safeMarginPercent:Math.max(0,Math.min(25,Number(e.target.value)||0))}}))}/></Field>
      </section>
      <TextField label="ESTILO DAS LEGENDAS" value={draft.captions.styleDescription} onChange={v=>setDraft(prev=>({...prev,captions:{...prev.captions,styleDescription:v}}))} rows={5}/>
    </div>}

    {tab==='editing'&&<div className="production-dna-content">
      <section className="production-dna-editing-flags">
        <Field label="Transição padrão"><input value={draft.editing.defaultTransition} onChange={e=>editing('defaultTransition',e.target.value)}/></Field>
        <label><input type="checkbox" checked={draft.editing.kenBurns} onChange={e=>editing('kenBurns',e.target.checked)}/>Modo documental de imagens (Ken Burns)</label>
      </section>
      <div className="production-dna-grid two">
        <ListField label="TRANSIÇÕES PERMITIDAS" value={draft.editing.transitions} onChange={v=>editing('transitions',v)}/>
        <ListField label="PACING / RITMO" value={draft.editing.pacingRules} onChange={v=>editing('pacingRules',v)}/>
        <ListField label="MÚSICA" value={draft.editing.musicStyle} onChange={v=>editing('musicStyle',v)}/>
        <ListField label="SFX" value={draft.editing.sfxRules} onChange={v=>editing('sfxRules',v)}/>
      </div>
      <div className="production-dna-grid two">
        <ListField label="THUMBNAIL — REGRAS" value={draft.thumbnail.styleRules} onChange={v=>setDraft(prev=>({...prev,thumbnail:{...prev.thumbnail,styleRules:v}}))}/>
        <ListField label="THUMBNAIL — PROIBIDO" value={draft.thumbnail.forbidden} onChange={v=>setDraft(prev=>({...prev,thumbnail:{...prev.thumbnail,forbidden:v}}))}/>
      </div>
    </div>}

    {tab==='providers'&&<div className="production-dna-content">
      <section className="production-provider-note"><WandSparkles size={25}/><div><h3>Preferência, não dependência.</h3><p>Essas listas orientam o futuro Asset Resolver. Arquivos externos continuarão aceitos mesmo quando um provider interno estiver configurado.</p></div></section>
      <div className="production-dna-grid two">
        <ListField label="IMAGEM" value={draft.providers.image} onChange={v=>providers('image',v)}/>
        <ListField label="VÍDEO" value={draft.providers.video} onChange={v=>providers('video',v)}/>
        <ListField label="VOICE" value={draft.providers.voice} onChange={v=>providers('voice',v)}/>
        <ListField label="STOCK MEDIA" value={draft.providers.stock} onChange={v=>providers('stock',v)}/>
      </div>
    </div>}

    {tab==='history'&&<div className="production-dna-content">
      <section className="production-provider-note history"><History size={25}/><div><h3>Histórico imutável.</h3><p>Carregar uma versão antiga apenas a coloca no editor. Salvar gera uma nova versão; nada é sobrescrito silenciosamente.</p></div></section>
      <div className="production-version-list">{history.map(item=><article key={item.version}><div><strong>v{item.version}</strong><small>{when(item.createdAt)}</small></div><span>{item.payload.visual.styleName||'Estilo sem nome'} · {item.payload.format.width}×{item.payload.format.height} · {item.payload.format.fps}fps</span><button className="button subtle small" onClick={()=>{setDraft({...item.payload,updatedAt:new Date().toISOString()});setTab('visual');setMessage(`Production DNA v${item.version} carregado no editor.`);}}>Carregar <ArrowUpRight size={14}/></button></article>)}</div>
    </div>}
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="production-dna-field"><span>{label}</span>{children}</label>;}
function TextField({label,value,onChange,rows=4}:{label:string;value:string;onChange:(value:string)=>void;rows?:number}){return <label className="production-dna-text"><span>{label}</span><textarea rows={rows} value={value} onChange={e=>onChange(e.target.value)}/></label>;}
function ListField({label,value,onChange}:{label:string;value:string[];onChange:(value:string[])=>void}){return <label className="production-dna-text"><span>{label}</span><small>Um item por linha.</small><textarea rows={Math.max(5,Math.min(11,value.length+2))} value={lines(value)} onChange={e=>onChange(parseLines(e.target.value))}/></label>;}

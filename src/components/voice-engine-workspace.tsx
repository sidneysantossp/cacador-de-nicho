'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, CircleAlert, FileAudio, Mic2, Play, RefreshCw,
  Sparkles, Trash2, Upload, Volume2, WandSparkles
} from 'lucide-react';
import type { EpisodeScript, ManagedChannel, VoiceAsset } from '@/lib/types';

type VoiceAssetView=VoiceAsset&{signedUrl:string|null;stale:boolean};
type ElevenVoice={voiceId:string;name:string;category:string;description:string;previewUrl:string;labels:Record<string,string>};

function bytes(value:number){
  if(value<1024)return value+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}
function duration(value:number|null){
  if(value===null)return '—';
  const minutes=Math.floor(value/60);
  const seconds=Math.round(value%60).toString().padStart(2,'0');
  return minutes+':'+seconds;
}

export default function VoiceEngineWorkspace({channel}:{channel:ManagedChannel}){
  const [scripts,setScripts]=useState<EpisodeScript[]>([]);
  const [scriptId,setScriptId]=useState('');
  const [assets,setAssets]=useState<VoiceAssetView[]>([]);
  const [voices,setVoices]=useState<ElevenVoice[]>([]);
  const [voiceId,setVoiceId]=useState('');
  const [voiceName,setVoiceName]=useState('');
  const [modelId,setModelId]=useState<'eleven_flash_v2_5'|'eleven_multilingual_v2'>('eleven_flash_v2_5');
  const [file,setFile]=useState<File|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [voicesError,setVoicesError]=useState('');

  const selectedScript=useMemo(()=>scripts.find(item=>item.id===scriptId)??null,[scripts,scriptId]);
  const selectedAsset=useMemo(()=>assets.find(item=>item.selected)??null,[assets]);

  async function loadAssets(id:string){
    if(!id){setAssets([]);return;}
    setBusy('assets');
    try{
      const res=await fetch('/api/voice-engine?scriptId='+encodeURIComponent(id),{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao carregar takes.');
      setAssets(body.assets??[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar takes.');}
    finally{setBusy('');}
  }

  async function loadInitial(){
    setLoading(true);setMessage('');
    try{
      const [scriptsRes,dnaRes]=await Promise.all([
        fetch('/api/script-engine?channelId='+encodeURIComponent(channel.id),{cache:'no-store'}),
        fetch('/api/production-dna?channelId='+encodeURIComponent(channel.id),{cache:'no-store'})
      ]);
      const scriptsBody=await scriptsRes.json().catch(()=>({}));
      const dnaBody=await dnaRes.json().catch(()=>({}));
      if(!scriptsRes.ok)throw new Error(scriptsBody.message??'Falha ao carregar roteiros.');
      const approved=(scriptsBody.scripts??[]).filter((item:EpisodeScript)=>item.status==='approved');
      setScripts(approved);
      const first=approved[0]?.id??'';
      setScriptId(first);
      if(dnaRes.ok&&dnaBody.dna){
        setVoiceId(String(dnaBody.dna.voice?.voiceId??''));
        setVoiceName(String(dnaBody.dna.voice?.voiceName??''));
      }
      if(first)await loadAssets(first);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar Voice Engine.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void loadInitial();},[channel.id]);

  async function loadVoices(){
    setBusy('voices');setVoicesError('');
    try{
      const res=await fetch('/api/voice-engine?voices=elevenlabs',{cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha ao listar vozes ElevenLabs.');
      setVoices(body.voices??[]);
      if(!voiceId&&body.voices?.length){
        setVoiceId(body.voices[0].voiceId);
        setVoiceName(body.voices[0].name);
      }
    }catch(error){setVoicesError(error instanceof Error?error.message:'Falha ao listar vozes ElevenLabs.');}
    finally{setBusy('');}
  }

  async function generate(){
    if(!scriptId||!voiceId.trim())return;
    setBusy('generate');setMessage('');
    try{
      const res=await fetch('/api/voice-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'generate',scriptId,voiceId:voiceId.trim(),voiceName:voiceName.trim()||undefined,modelId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao gerar narração.');
      setAssets(body.assets??[]);
      setMessage(body.message??'Narração gerada.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao gerar narração.');}
    finally{setBusy('');}
  }

  async function upload(){
    if(!scriptId||!file)return;
    setBusy('upload');setMessage('');
    try{
      const form=new FormData();
      form.set('scriptId',scriptId);
      form.set('file',file);
      const res=await fetch('/api/voice-engine',{method:'POST',body:form});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??body.error??'Falha ao enviar áudio.');
      setAssets(body.assets??[]);
      setFile(null);
      const input=document.getElementById('voice-upload-input') as HTMLInputElement|null;
      if(input)input.value='';
      setMessage(body.message??'Áudio enviado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao enviar áudio.');}
    finally{setBusy('');}
  }

  async function act(action:'select'|'delete',assetId:string){
    if(!scriptId)return;
    setBusy(action+':'+assetId);setMessage('');
    try{
      const res=await fetch('/api/voice-engine',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,scriptId,assetId})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.message??'Falha no Voice Engine.');
      setAssets(body.assets??[]);
      setMessage(body.message??'Voice Engine atualizado.');
    }catch(error){setMessage(error instanceof Error?error.message:'Falha no Voice Engine.');}
    finally{setBusy('');}
  }

  if(loading)return <div className="voice-engine-loading"><Sparkles className="spin" size={20}/>Carregando Voice Engine…</div>;

  return <div className="voice-engine">
    {message&&<div className="voice-engine-message"><CheckCircle2 size={15}/>{message}</div>}

    <section className="voice-engine-hero">
      <div><span>VOICE ENGINE</span><h2>A voz pode nascer aqui ou chegar pronta.</h2><p>Cada narração vira um take persistente ligado à versão exata do roteiro. Você escolhe qual take segue para transcrição e produção.</p></div>
      <div>{selectedAsset?<><strong>TAKE {String(selectedAsset.take).padStart(2,'0')}</strong><small>ativo</small></>:<><strong>—</strong><small>nenhum take ativo</small></>}</div>
    </section>

    {!scripts.length?<div className="voice-engine-empty"><Mic2 size={28}/><h3>Nenhum roteiro aprovado.</h3><p>Aprove um roteiro no Script Engine antes de gerar ou enviar a narração.</p></div>:<>
      <section className="voice-engine-script">
        <label><span>ROTEIRO APROVADO</span><select value={scriptId} onChange={e=>{setScriptId(e.target.value);void loadAssets(e.target.value);}}>{scripts.map(script=><option key={script.id} value={script.id}>{script.title} · v{script.version}</option>)}</select></label>
        {selectedScript&&<div><strong>{selectedScript.wordCount}</strong><small>palavras</small><strong>{selectedScript.estimatedMinutes??'—'}</strong><small>min estimados</small><strong>v{selectedScript.version}</strong><small>versão do roteiro</small></div>}
      </section>

      <div className="voice-engine-two">
        <section className="voice-generator">
          <div className="voice-section-head"><div><span>ELEVENLABS</span><h3>Gerar narração.</h3></div><WandSparkles size={21}/></div>
          <div className="voice-provider-row">
            <label>Modelo<select value={modelId} onChange={e=>setModelId(e.target.value as typeof modelId)}><option value="eleven_flash_v2_5">Flash v2.5 · até 40k caracteres</option><option value="eleven_multilingual_v2">Multilingual v2 · até 10k caracteres</option></select></label>
            <button className="button subtle small" disabled={busy==='voices'} onClick={()=>void loadVoices()}><RefreshCw size={14}/>{busy==='voices'?'Carregando…':'Carregar minhas vozes'}</button>
          </div>
          {voicesError&&<div className="voice-inline-warning"><CircleAlert size={15}/>{voicesError}</div>}
          {voices.length>0?<label>Voz<select value={voiceId} onChange={e=>{const v=voices.find(item=>item.voiceId===e.target.value);setVoiceId(e.target.value);setVoiceName(v?.name??'');}}><option value="">Selecione</option>{voices.map(voice=><option key={voice.voiceId} value={voice.voiceId}>{voice.name}{voice.category?' · '+voice.category:''}</option>)}</select></label>:<label>Voice ID<input value={voiceId} onChange={e=>setVoiceId(e.target.value)} placeholder="Cole o Voice ID ou carregue suas vozes"/></label>}
          {voiceName&&<div className="voice-selected-name"><Volume2 size={14}/>{voiceName}</div>}
          <button className="button primary" disabled={!voiceId.trim()||!!busy} onClick={()=>void generate()}><Sparkles size={15}/>{busy==='generate'?'Gerando narração…':'Gerar novo take'}</button>
        </section>

        <section className="voice-upload">
          <div className="voice-section-head"><div><span>EXTERNAL AUDIO</span><h3>Usar ElevenLabs ou outra ferramenta fora daqui.</h3></div><Upload size={21}/></div>
          <p>Envie a narração pronta em MP3, WAV, M4A, OGG ou WebM. O arquivo fica privado e entra no mesmo fluxo dos áudios gerados internamente.</p>
          <label className="voice-file-picker"><FileAudio size={24}/><span>{file?file.name:'Selecionar áudio'}<small>{file?bytes(file.size):'até 100 MB'}</small></span><input id="voice-upload-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
          <button className="button primary" disabled={!file||!!busy} onClick={()=>void upload()}><Upload size={15}/>{busy==='upload'?'Enviando…':'Salvar como novo take'}</button>
        </section>
      </div>

      <section className="voice-takes">
        <div className="voice-section-head"><div><span>TAKES</span><h3>Narrações deste roteiro.</h3></div><span className="voice-take-count">{assets.length}</span></div>
        {!assets.length&&<div className="voice-no-takes">Nenhum áudio ainda.</div>}
        {assets.map(asset=><article key={asset.id} className={asset.selected?'selected':''}>
          <div className="voice-take-id"><strong>TAKE {String(asset.take).padStart(2,'0')}</strong><span>{asset.sourceType==='generated'?'Gerado':'Upload'}</span>{asset.selected&&<em>ATIVO</em>}</div>
          <div className="voice-take-main">
            <div className="voice-take-meta">
              <span>{asset.provider??'external'}</span>
              {asset.modelId&&<span>{asset.modelId}</span>}
              {asset.voiceName&&<span>{asset.voiceName}</span>}
              <span>{duration(asset.durationSeconds)}</span>
              <span>{bytes(asset.bytes)}</span>
              <span>script v{asset.scriptVersion}</span>
            </div>
            {asset.stale&&<div className="voice-stale"><CircleAlert size={14}/>Este áudio foi criado para uma versão anterior do roteiro.</div>}
            {asset.alignment?<div className="voice-alignment"><CheckCircle2 size={14}/>Alignment temporal disponível para a próxima etapa.</div>:<div className="voice-alignment pending"><CircleAlert size={14}/>Sem alignment. Transcrição será necessária.</div>}
            {asset.signedUrl&&<audio controls preload="metadata" src={asset.signedUrl}/>}
          </div>
          <div className="voice-take-actions">{!asset.selected&&<button className="button subtle small" disabled={!!busy||asset.status!=='ready'} onClick={()=>void act('select',asset.id)}><CheckCircle2 size={14}/>Usar este take</button>}<button className="icon-button danger" disabled={!!busy} aria-label="Excluir take" onClick={()=>void act('delete',asset.id)}><Trash2 size={15}/></button></div>
        </article>)}
      </section>
    </>}
  </div>;
}

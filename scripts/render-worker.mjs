import { spawn } from 'node:child_process';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BUCKET='cacadores-media';
const POLL_MS=Math.max(2000,Number(process.env.RENDER_WORKER_POLL_MS||5000));
const MIN_FREE_DISK_BYTES=Math.max(4,Number(process.env.RENDER_MIN_FREE_DISK_GB||10))*1024*1024*1024;
const LEASE_SECONDS=900;

function renderDiskReady(){
  try{
    const fs=statfsSync(os.tmpdir());
    const freeBytes=Number(fs.bavail)*Number(fs.bsize);
    return {ready:freeBytes>=MIN_FREE_DISK_BYTES,freeBytes};
  }catch(error){
    return {ready:false,freeBytes:0,error:safeError(error)};
  }
}
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';

if(!SUPABASE_URL||!SERVICE_KEY){
  console.error('Render worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const authHeaders={
  apikey:SERVICE_KEY,
  Authorization:'Bearer '+SERVICE_KEY
};
let r2StorageCache=null;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function rounded(value){return Math.round(Number(value)*1000)/1000;}
function pathUrl(value){return value.split('/').map(encodeURIComponent).join('/');}
function safeError(error){
  return String(error instanceof Error?error.message:error).slice(0,4000);
}

async function rest(pathname,options={}){
  const response=await fetch(SUPABASE_URL+pathname,{
    ...options,
    headers:{...authHeaders,...(options.headers||{})}
  });
  if(!response.ok){
    const text=await response.text().catch(()=>'');
    throw new Error('Supabase '+response.status+' '+pathname+' '+text.slice(0,800));
  }
  if(response.status===204)return null;
  const text=await response.text();
  return text?JSON.parse(text):null;
}

async function rpc(name,args){
  return rest('/rest/v1/rpc/'+encodeURIComponent(name),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(args)
  });
}

async function queryJob(jobId){
  const rows=await rest('/rest/v1/radar_render_jobs?id=eq.'+encodeURIComponent(jobId)+'&select=id,status,worker_token,payload,channel_id,episode_id,video_edit_id,video_edit_version');
  return Array.isArray(rows)?rows[0]??null:null;
}

async function heartbeat(jobId,token,progress,stage){
  const ok=await rpc('heartbeat_render_job',{
    p_job_id:jobId,
    p_worker_token:token,
    p_progress:Math.max(1,Math.min(99,Math.round(progress))),
    p_stage:String(stage).slice(0,120),
    p_lease_seconds:LEASE_SECONDS
  });
  if(ok!==true)throw new Error('Render lease lost for '+jobId);
}

async function assertActive(jobId,token){
  const job=await queryJob(jobId);
  if(!job)throw new Error('Render job disappeared.');
  if(job.status==='cancelled'){
    const error=new Error('Render cancelled.');
    error.code='RENDER_CANCELLED';
    throw error;
  }
  if(job.status!=='processing'||job.worker_token!==token){
    throw new Error('Render job is no longer owned by this worker.');
  }
  return job;
}

async function updateOwned(jobId,token,fields){
  const query='/rest/v1/radar_render_jobs?id=eq.'+encodeURIComponent(jobId)+
    '&status=eq.processing&worker_token=eq.'+encodeURIComponent(token);
  await rest(query,{
    method:'PATCH',
    headers:{'Content-Type':'application/json','Prefer':'return=minimal'},
    body:JSON.stringify({...fields,updated_at:new Date().toISOString()})
  });
}

async function r2Storage(){
  if(r2StorageCache)return r2StorageCache;
  const secret=await rpc('radar_get_secret',{p_secret_name:'cloudflare_r2_config'});
  if(typeof secret!=='string'||!secret)return null;
  let config;
  try{config=JSON.parse(secret);}catch{throw new Error('Cloudflare R2 vault config is invalid.');}
  if(!config.accountId||!config.accessKeyId||!config.secretAccessKey||!config.bucket){
    throw new Error('Cloudflare R2 vault config is incomplete.');
  }
  const client=new S3Client({
    region:'auto',
    endpoint:'https://'+config.accountId+'.r2.cloudflarestorage.com',
    credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey}
  });
  r2StorageCache={client,bucket:config.bucket};
  return r2StorageCache;
}

async function downloadStorage(storagePath,destination){
  if(String(storagePath).startsWith('r2:')){
    const target=await r2Storage();
    if(!target)throw new Error('Cloudflare R2 is not configured for '+storagePath);
    const result=await target.client.send(new GetObjectCommand({
      Bucket:target.bucket,
      Key:String(storagePath).slice(3)
    }));
    if(!result.Body)throw new Error('R2 object has no response body: '+storagePath);
    const bytes=Buffer.from(await result.Body.transformToByteArray());
    if(!bytes.length)throw new Error('R2 object is empty: '+storagePath);
    await writeFile(destination,bytes);
    return;
  }

  const response=await fetch(
    SUPABASE_URL+'/storage/v1/object/'+BUCKET+'/'+pathUrl(storagePath),
    {headers:authHeaders}
  );
  if(!response.ok)throw new Error('Storage download failed '+response.status+' '+storagePath);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length)throw new Error('Storage object is empty: '+storagePath);
  await writeFile(destination,bytes);
}

async function uploadStorage(storagePath,filePath){
  const bytes=await readFile(filePath);
  const target=await r2Storage();
  if(target){
    await target.client.send(new PutObjectCommand({
      Bucket:target.bucket,
      Key:storagePath,
      Body:bytes,
      ContentType:'video/mp4',
      CacheControl:'3600'
    }));
    return {bytes:bytes.length,path:'r2:'+storagePath};
  }

  const response=await fetch(
    SUPABASE_URL+'/storage/v1/object/'+BUCKET+'/'+pathUrl(storagePath),
    {
      method:'POST',
      headers:{...authHeaders,'Content-Type':'video/mp4','x-upsert':'false'},
      body:bytes
    }
  );
  if(!response.ok){
    const text=await response.text().catch(()=>'');
    throw new Error('Storage upload failed '+response.status+' '+text.slice(0,500));
  }
  return {bytes:bytes.length,path:storagePath};
}

async function run(command,args,{cwd}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr.on('data',chunk=>{
      stderr=(stderr+chunk.toString()).slice(-12000);
    });
    child.on('error',reject);
    child.on('close',code=>{
      if(code===0)resolve();
      else reject(new Error(command+' exited '+code+'\n'+stderr));
    });
  });
}

function codecArgs(codec,crf,preset='medium'){
  if(codec==='libx264'){
    return ['-c:v','libx264','-preset',preset,'-crf',String(crf)];
  }
  if(codec==='mpeg4'){
    const q=Math.max(2,Math.min(12,Math.round((Number(crf)-16)/2+2)));
    return ['-c:v','mpeg4','-q:v',String(q)];
  }
  throw new Error('Unsupported video encoder: '+codec);
}

function encoderCandidates(payload){
  const primary=payload?.videoCodec||'libx264';
  const fallback=payload?.compilerVersion==='render-v3'?(payload.fallbackVideoCodecs??[]):[];
  return [...new Set([primary,...fallback])];
}

async function runVideoEncode(baseArgs,outputPath,payload,{crf,preset='medium'}={}){
  const failures=[];
  for(const codec of encoderCandidates(payload)){
    try{
      await run(FFMPEG,[
        ...baseArgs,
        ...codecArgs(codec,crf??payload?.crf??20,preset),
        '-pix_fmt','yuv420p',
        outputPath
      ]);
      if(failures.length){
        console.log(JSON.stringify({
          event:'render-encoder-fallback',
          codec,
          failedCodecs:failures.map(item=>item.codec)
        }));
      }
      return codec;
    }catch(error){
      failures.push({codec,error:safeError(error)});
    }
  }
  throw new Error('All video encoders failed: '+failures.map(item=>item.codec+': '+item.error).join(' | '));
}

function renderOutputFormat(payload,manifest){
  const raw=payload?.compilerVersion==='render-v3'&&payload.outputFormat
    ?payload.outputFormat
    :manifest.format;
  const width=Math.max(2,Math.round(Number(raw.width)/2)*2);
  const height=Math.max(2,Math.round(Number(raw.height)/2)*2);
  const fps=Math.max(1,Math.min(120,Math.round(Number(raw.fps))));
  return {width,height,fps};
}

function fitFilter(kind,width,height){
  if(kind==='contain'){
    return 'scale='+width+':'+height+':force_original_aspect_ratio=decrease,'+
      'pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:black';
  }
  if(kind==='stretch')return 'scale='+width+':'+height;
  return 'scale='+width+':'+height+':force_original_aspect_ratio=increase,crop='+width+':'+height;
}

function motionFilter(style,width,height,fps,duration){
  const frames=Math.max(1,Math.round(duration*fps));
  const denom=Math.max(1,frames-1);
  const z0=Number(style.scaleStart).toFixed(6);
  const z1=Number(style.scaleEnd).toFixed(6);
  const x0=Number(style.xStart).toFixed(6);
  const x1=Number(style.xEnd).toFixed(6);
  const y0=Number(style.yStart).toFixed(6);
  const y1=Number(style.yEnd).toFixed(6);
  const progress='on/'+denom;
  const zoom='max(1,min(5,'+z0+'+('+z1+'-'+z0+')*'+progress+'))';
  const xnorm='('+x0+'+('+x1+'-'+x0+')*'+progress+')';
  const ynorm='('+y0+'+('+y1+'-'+y0+')*'+progress+')';
  const xpos='max(0,min(iw-iw/zoom,(iw-iw/zoom)/2+'+xnorm+'*(iw-iw/zoom)/2))';
  const ypos='max(0,min(ih-ih/zoom,(ih-ih/zoom)/2+'+ynorm+'*(ih-ih/zoom)/2))';
  return 'zoompan=z=\''+zoom+'\':x=\''+xpos+'\':y=\''+ypos+
    '\':d=1:s='+width+'x'+height+':fps='+fps;
}

function transitionAt(left,right){
  const cross=left.style.transitionOut==='cross-dissolve'||right.style.transitionIn==='cross-dissolve';
  if(!cross)return 0;
  return Math.max(0,Math.min(
    Number(left.style.transitionSeconds||0),
    Number(right.style.transitionSeconds||0),
    left.durationSeconds/2,
    right.durationSeconds/2
  ));
}

function effectiveCrossDuration(left,right){
  const wants=left.style.transitionOut==='cross-dissolve'||right.style.transitionIn==='cross-dissolve';
  if(!wants)return 0;
  const requested=Math.max(Number(left.style.transitionSeconds||0),Number(right.style.transitionSeconds||0));
  return Math.max(0,Math.min(requested,left.durationSeconds/2,right.durationSeconds/2));
}

async function prepareSegment(clip,inputPath,outputPath,manifest,index,payload){
  const width=manifest.format.width;
  const height=manifest.format.height;
  const fps=manifest.format.fps;
  const next=manifest.visualClips[index+1];
  const previous=manifest.visualClips[index-1];
  const outCross=next?effectiveCrossDuration(clip,next):0;
  const inCross=previous?effectiveCrossDuration(previous,clip):0;
  const nominal=Number(clip.durationSeconds);
  const outputDuration=nominal+outCross;

  const args=['-hide_banner','-loglevel','error','-y'];
  if(clip.kind==='image'){
    args.push('-loop','1','-framerate',String(fps),'-i',inputPath);
  }else{
    if(clip.playback==='loop')args.push('-stream_loop','-1');
    if(clip.sourceStartSeconds!==null&&clip.sourceStartSeconds>0){
      args.push('-ss',String(rounded(clip.sourceStartSeconds)));
    }
    args.push('-i',inputPath);
  }

  const filters=[
    fitFilter(clip.fit,width,height),
    'fps='+fps,
    motionFilter(clip.style,width,height,fps,outputDuration)
  ];

  if(clip.kind==='video'&&clip.playback==='trim'&&outCross>0){
    filters.push('tpad=stop_mode=clone:stop_duration='+rounded(outCross));
  }
  if(clip.style.transitionIn==='fade'&&inCross<=0&&clip.style.transitionSeconds>0){
    filters.push('fade=t=in:st=0:d='+rounded(Math.min(clip.style.transitionSeconds,nominal/2)));
  }
  if(clip.style.transitionOut==='fade'&&outCross<=0&&clip.style.transitionSeconds>0){
    const d=Math.min(clip.style.transitionSeconds,nominal/2);
    filters.push('fade=t=out:st='+rounded(Math.max(0,nominal-d))+':d='+rounded(d));
  }
  filters.push('format=yuv420p','setpts=PTS-STARTPTS');

  args.push(
    '-vf',filters.join(','),
    '-an',
    '-t',String(rounded(outputDuration)),
    '-r',String(fps)
  );
  await runVideoEncode(args,outputPath,payload,{crf:18,preset:'veryfast'});
}

async function assembleSegments(manifest,segmentPaths,outputPath,crf,payload){
  const args=['-hide_banner','-loglevel','error','-y'];
  for(const file of segmentPaths)args.push('-i',file);

  if(segmentPaths.length===1){
    args.push('-map','0:v:0','-an');
    await runVideoEncode(args,outputPath,payload,{crf,preset:'medium'});
    return;
  }

  const filters=[];
  let current='0:v';
  let cumulative=manifest.visualClips[0].durationSeconds;

  for(let i=1;i<manifest.visualClips.length;i++){
    const left=manifest.visualClips[i-1];
    const right=manifest.visualClips[i];
    const cross=effectiveCrossDuration(left,right);
    const out='v'+i;
    if(cross>0){
      filters.push('['+current+']['+i+':v]xfade=transition=fade:duration='+rounded(cross)+
        ':offset='+rounded(cumulative)+'['+out+']');
    }else{
      filters.push('['+current+']['+i+':v]concat=n=2:v=1:a=0['+out+']');
    }
    current=out;
    cumulative+=right.durationSeconds;
  }

  args.push(
    '-filter_complex',filters.join(';'),
    '-map','['+current+']',
    '-an',
    '-t',String(rounded(manifest.durationSeconds)),
    '-r',String(manifest.format.fps)
  );
  await runVideoEncode(args,outputPath,payload,{crf,preset:'medium'});
}

function assEscape(value){
  return String(value)
    .replace(/\\/g,'\\\\')
    .replace(/{/g,'\\{')
    .replace(/}/g,'\\}')
    .replace(/\r?\n/g,'\\N');
}

function assTime(seconds){
  const value=Math.max(0,Number(seconds));
  const h=Math.floor(value/3600);
  const m=Math.floor((value%3600)/60);
  const s=Math.floor(value%60);
  const cs=Math.floor((value-Math.floor(value))*100);
  return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0');
}

function assAlpha(opacity){
  const alpha=Math.max(0,Math.min(255,Math.round((1-Number(opacity))*255)));
  return alpha.toString(16).padStart(2,'0').toUpperCase();
}

function assColor(hex,alpha='00'){
  const match=String(hex||'').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if(!match)return '&H'+alpha+'FFFFFF';
  return '&H'+alpha+match[3].toUpperCase()+match[2].toUpperCase()+match[1].toUpperCase();
}

function captionText(cue,style){
  const source=(cue.words?.length?cue.words:null);
  const baseWords=source??String(cue.text||'').split(/\s+/).filter(Boolean).map((text,index)=>({
    id:String(index),text,startSeconds:cue.startSeconds,endSeconds:cue.endSeconds,highlighted:false
  }));
  const words=baseWords.map(word=>({...word,text:style.uppercase?String(word.text).toUpperCase():String(word.text)}));
  const primary=assColor(style.primaryColor||'#FFFFFF');
  const highlight=assColor(style.highlightColor||'#F4C95D');
  const maxWords=Math.max(2,Number(style.maxWordsPerLine||6));
  const tokens=[];
  let lineCount=0;

  words.forEach((word,index)=>{
    let token=assEscape(word.text);
    if(style.highlightMode==='keywords'&&word.highlighted){
      token='{\\c'+highlight+'}'+token+'{\\c'+primary+'}';
    }else if(style.highlightMode==='active-word'&&source){
      const cs=Math.max(1,Math.round((Number(word.endSeconds)-Number(word.startSeconds))*100));
      token='{\\k'+cs+'}'+token;
    }
    tokens.push(token);
    lineCount++;
    const punctuation=/[.!?,;:]$/.test(word.text);
    const remaining=words.length-index-1;
    if(remaining>0&&style.smartBreaks&&(lineCount>=maxWords||(lineCount>=Math.ceil(maxWords*.6)&&punctuation))){
      tokens.push('\\N');
      lineCount=0;
    }
  });
  return tokens.join(' ').replace(/ \\N /g,'\\N');
}

function buildAss(manifest){
  const w=manifest.format.width,h=manifest.format.height;
  const captions=manifest.captions||{};
  const style=captions.style||{
    fontFamily:'DejaVu Sans',fontWeight:800,primaryColor:'#FFFFFF',
    highlightColor:'#F4C95D',outlineColor:'#000000',outlineWidth:2,
    uppercase:false,maxWordsPerLine:6,smartBreaks:true,highlightMode:'none',safeMarginPercent:6
  };
  const position=captions.position||'bottom';
  const align=position==='top'?8:position==='center'?5:2;
  const marginV=Math.round(h*(Number(style.safeMarginPercent||6)/100));
  const bg='&H'+assAlpha(captions.backgroundOpacity??.35)+'000000';
  const primary=assColor(style.highlightMode==='active-word'?style.highlightColor:style.primaryColor);
  const secondary=assColor(style.primaryColor);
  const outline=assColor(style.outlineColor);
  const font=String(style.fontFamily||'DejaVu Sans').replace(/,/g,' ');
  const bold=Number(style.fontWeight||800)>=700?-1:0;
  const lines=[
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: '+w,
    'PlayResY: '+h,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Caption,'+font+','+(captions.fontSize||52)+','+primary+','+secondary+','+outline+','+bg+','+bold+',0,0,0,100,100,0,0,3,'+Number(style.outlineWidth||0)+',0,'+align+',80,80,'+marginV+',1',
    'Style: Overlay,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'
  ];

  if(captions.enabled){
    for(const cue of captions.cues??[]){
      lines.push('Dialogue: 0,'+assTime(cue.startSeconds)+','+assTime(cue.endSeconds)+',Caption,,0,0,0,,'+captionText(cue,style));
    }
  }
  for(const overlay of manifest.overlays??[]){
    const x=Math.round((overlay.x+overlay.width/2)*w);
    const y=Math.round((overlay.y+overlay.height/2)*h);
    const alpha=assAlpha(overlay.opacity);
    const text='{\\pos('+x+','+y+')\\fs'+Math.round(overlay.fontSize)+'\\alpha&H'+alpha+'&}'+assEscape(overlay.text);
    lines.push('Dialogue: 1,'+assTime(overlay.startSeconds)+','+assTime(overlay.endSeconds)+',Overlay,,0,0,0,,'+text);
  }
  return lines.join('\n')+'\n';
}

async function burnText(manifest,inputPath,assPath,outputPath,crf,payload){
  const hasText=(manifest.captions?.enabled&&(manifest.captions.cues??[]).length>0)||(manifest.overlays??[]).length>0;
  if(!hasText)return inputPath;
  await writeFile(assPath,buildAss(manifest),'utf8');
  await runVideoEncode([
    '-hide_banner','-loglevel','error','-y','-i',inputPath,
    '-vf','ass='+assPath,
    '-an'
  ],outputPath,payload,{crf,preset:'medium'});
  return outputPath;
}

async function muxAudio(manifest,videoPath,paths,outputPath,payload){
  const voicePath=paths.get(manifest.voice.assetId);
  if(!voicePath)throw new Error('Narration source missing.');

  const args=['-hide_banner','-loglevel','error','-y','-i',videoPath,'-i',voicePath];
  let inputIndex=2;
  let musicIndex=null;
  const music=manifest.music??null;
  if(music){
    const musicPath=paths.get(music.assetId);
    if(!musicPath)throw new Error('Music source missing.');
    if(music.placement.loop)args.push('-stream_loop','-1');
    if(Number(music.placement.sourceStartSeconds||0)>0)args.push('-ss',String(rounded(music.placement.sourceStartSeconds)));
    args.push('-i',musicPath);
    musicIndex=inputIndex++;
  }

  const sfxInputs=[];
  for(const item of manifest.sfxEvents??[]){
    const sfxPath=paths.get(item.assetId);
    if(!sfxPath)throw new Error('SFX source missing: '+item.assetId);
    if(Number(item.event.sourceStartSeconds||0)>0)args.push('-ss',String(rounded(item.event.sourceStartSeconds)));
    args.push('-i',sfxPath);
    sfxInputs.push({index:inputIndex++,item});
  }

  const filters=[];
  const voiceFilters=[];
  if(manifest.audioMix.normalizeVoice)voiceFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  voiceFilters.push('volume='+Number(manifest.audioMix.voiceVolume).toFixed(4));
  voiceFilters.push('apad=whole_dur='+rounded(manifest.durationSeconds));
  voiceFilters.push('atrim=duration='+rounded(manifest.durationSeconds));
  voiceFilters.push('asetpts=PTS-STARTPTS');

  const mixLabels=[];
  const shouldDuck=Boolean(music&&music.placement.duckUnderVoice&&manifest.audioMix.duckMusicUnderVoice);
  if(shouldDuck){
    filters.push('[1:a]'+voiceFilters.join(',')+',asplit=2[voice_mix][voice_side]');
    mixLabels.push('[voice_mix]');
  }else{
    filters.push('[1:a]'+voiceFilters.join(',')+'[voice_mix]');
    mixLabels.push('[voice_mix]');
  }

  if(music&&musicIndex!==null){
    const p=music.placement;
    const span=Math.max(.01,Number(p.endSeconds)-Number(p.startSeconds));
    const musicFilters=[
      'atrim=duration='+rounded(span),
      'asetpts=PTS-STARTPTS',
      'volume='+(Number(p.volume)*Number(manifest.audioMix.musicVolume)).toFixed(4)
    ];
    if(Number(p.fadeInSeconds)>0)musicFilters.push('afade=t=in:st=0:d='+rounded(p.fadeInSeconds));
    if(Number(p.fadeOutSeconds)>0){
      musicFilters.push('afade=t=out:st='+rounded(Math.max(0,span-p.fadeOutSeconds))+':d='+rounded(p.fadeOutSeconds));
    }
    if(Number(p.startSeconds)>0)musicFilters.push('adelay='+Math.round(Number(p.startSeconds)*1000)+':all=1');
    filters.push('['+musicIndex+':a]'+musicFilters.join(',')+'[music_raw]');
    if(shouldDuck){
      const ratio=(1+Number(p.duckingStrength)*15).toFixed(2);
      filters.push('[music_raw][voice_side]sidechaincompress=threshold=0.025:ratio='+ratio+':attack=20:release=350[music_mix]');
      mixLabels.push('[music_mix]');
    }else{
      mixLabels.push('[music_raw]');
    }
  }

  sfxInputs.forEach(({index,item},n)=>{
    const e=item.event;
    const sfxFilters=[
      'atrim=duration='+rounded(e.durationSeconds),
      'asetpts=PTS-STARTPTS',
      'volume='+(Number(e.volume)*Number(manifest.audioMix.sfxVolume)).toFixed(4)
    ];
    if(Number(e.startSeconds)>0)sfxFilters.push('adelay='+Math.round(Number(e.startSeconds)*1000)+':all=1');
    const label='sfx_'+n;
    filters.push('['+index+':a]'+sfxFilters.join(',')+'['+label+']');
    mixLabels.push('['+label+']');
  });

  if(mixLabels.length===1){
    filters.push(mixLabels[0]+'anull[aout]');
  }else{
    filters.push(mixLabels.join('')+'amix=inputs='+mixLabels.length+':normalize=0:duration=longest,atrim=duration='+rounded(manifest.durationSeconds)+',alimiter=limit=.95[aout]');
  }

  args.push(
    '-filter_complex',filters.join(';'),
    '-map','0:v:0','-map','[aout]'
  );

  if(payload.compilerVersion==='render-v3'){
    const format=renderOutputFormat(payload,manifest);
    args.push(
      '-vf','scale='+format.width+':'+format.height+':force_original_aspect_ratio=decrease,'+
        'pad='+format.width+':'+format.height+':(ow-iw)/2:(oh-ih)/2:black,fps='+format.fps,
      '-c:a','aac','-b:a',String(payload.audioBitrateKbps)+'k',
      '-t',String(rounded(manifest.durationSeconds)),
      '-movflags','+faststart'
    );
    await runVideoEncode(args,outputPath,payload,{crf:payload.crf,preset:'medium'});
    return;
  }

  args.push(
    '-c:v','copy',
    '-c:a','aac','-b:a',String(payload.audioBitrateKbps)+'k',
    '-t',String(rounded(manifest.durationSeconds)),
    '-movflags','+faststart',
    outputPath
  );
  await run(FFMPEG,args);
}

async function processJob(jobId,token){
  const root=await mkdtemp(path.join(os.tmpdir(),'cacadores-render-'));
  try{
    const job=await assertActive(jobId,token);
    const payload=job.payload;
    const manifest=payload?.manifest;
    if(!manifest||!['render-v1','render-v2','render-v3'].includes(payload.compilerVersion))throw new Error('Unsupported render manifest.');

    await heartbeat(jobId,token,3,'downloading-sources');
    const inputDir=path.join(root,'inputs');
    const segDir=path.join(root,'segments');
    await mkdir(inputDir,{recursive:true});
    await mkdir(segDir,{recursive:true});

    const paths=new Map();
    const unique=[
      ...manifest.visualClips.map(clip=>({id:clip.assetId,storagePath:clip.storagePath})),
      {id:manifest.voice.assetId,storagePath:manifest.voice.storagePath},
      ...(manifest.music?[{id:manifest.music.assetId,storagePath:manifest.music.storagePath}]:[]),
      ...(manifest.sfxEvents??[]).map(item=>({id:item.assetId,storagePath:item.storagePath}))
    ];
    const dedup=[...new Map(unique.map(item=>[item.id,item])).values()];

    for(let i=0;i<dedup.length;i++){
      await assertActive(jobId,token);
      const item=dedup[i];
      const ext=path.extname(item.storagePath)||'.bin';
      const dest=path.join(inputDir,item.id+ext);
      await downloadStorage(item.storagePath,dest);
      paths.set(item.id,dest);
      await heartbeat(jobId,token,3+Math.round((i+1)/dedup.length*17),'downloading-sources');
    }

    const segmentPaths=[];
    for(let i=0;i<manifest.visualClips.length;i++){
      await assertActive(jobId,token);
      const clip=manifest.visualClips[i];
      const input=paths.get(clip.assetId);
      if(!input)throw new Error('Missing local source for '+clip.assetId);
      const output=path.join(segDir,String(i).padStart(4,'0')+'.mp4');
      await prepareSegment(clip,input,output,manifest,i,payload);
      segmentPaths.push(output);
      await heartbeat(jobId,token,20+Math.round((i+1)/manifest.visualClips.length*45),'rendering-clips');
    }

    await assertActive(jobId,token);
    await heartbeat(jobId,token,70,'assembling-timeline');
    const assembled=path.join(root,'assembled.mp4');
    await assembleSegments(manifest,segmentPaths,assembled,payload.crf,payload);

    await assertActive(jobId,token);
    await heartbeat(jobId,token,82,'burning-text');
    const textVideo=await burnText(
      manifest,assembled,path.join(root,'overlays.ass'),path.join(root,'text.mp4'),payload.crf,payload
    );

    await assertActive(jobId,token);
    await heartbeat(jobId,token,90,'mixing-audio');
    const finalPath=path.join(root,'render.mp4');
    await muxAudio(manifest,textVideo,paths,finalPath,payload);

    await assertActive(jobId,token);
    await heartbeat(jobId,token,96,'uploading-output');
    const outputPath=[
      'channels',job.channel_id,'episodes',job.episode_id,'renders',
      job.video_edit_id,'v'+String(job.video_edit_version).padStart(4,'0'),
      job.id+'.mp4'
    ].join('/');
    const uploadedOutput=await uploadStorage(outputPath,finalPath);

    await assertActive(jobId,token);
    await updateOwned(jobId,token,{
      status:'completed',
      progress:100,
      stage:'completed',
      output_path:uploadedOutput.path,
      output_bytes:uploadedOutput.bytes,
      worker_token:null,
      lease_until:null,
      completed_at:new Date().toISOString(),
      error:null
    });
    console.log(JSON.stringify({event:'render-completed',jobId,outputPath:uploadedOutput.path,outputBytes:uploadedOutput.bytes}));
  }catch(error){
    if(error?.code==='RENDER_CANCELLED'){
      console.log(JSON.stringify({event:'render-cancelled',jobId}));
      return;
    }
    const message=safeError(error);
    try{
      const job=await queryJob(jobId);
      if(job?.status==='processing'&&job.worker_token===token){
        await updateOwned(jobId,token,{
          status:'failed',
          stage:'failed',
          worker_token:null,
          lease_until:null,
          completed_at:new Date().toISOString(),
          error:message
        });
      }
    }catch(updateError){
      console.error('Failed to record render error',safeError(updateError));
    }
    console.error(JSON.stringify({event:'render-failed',jobId,error:message}));
  }finally{
    await rm(root,{recursive:true,force:true}).catch(()=>{});
  }
}

async function loop(){
  console.log(JSON.stringify({event:'render-worker-started',pollMs:POLL_MS}));
  while(true){
    try{
      const disk=renderDiskReady();
      if(!disk.ready){
        console.error(JSON.stringify({
          event:'render-worker-low-disk',
          freeGb:Math.round(disk.freeBytes/1024/1024/1024*100)/100,
          requiredGb:Math.round(MIN_FREE_DISK_BYTES/1024/1024/1024*100)/100
        }));
        await sleep(Math.max(POLL_MS,30000));
        continue;
      }
      const token=randomUUID();
      const jobId=await rpc('claim_render_job',{
        p_worker_token:token,
        p_lease_seconds:LEASE_SECONDS
      });
      if(jobId){
        await processJob(String(jobId),token);
      }else{
        await sleep(POLL_MS);
      }
    }catch(error){
      console.error(JSON.stringify({event:'worker-loop-error',error:safeError(error)}));
      await sleep(Math.max(POLL_MS,5000));
    }
  }
}

process.on('SIGTERM',()=>process.exit(0));
process.on('SIGINT',()=>process.exit(0));
await loop();

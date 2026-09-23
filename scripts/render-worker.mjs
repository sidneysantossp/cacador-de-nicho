import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BUCKET='cacadores-media';
const POLL_MS=Math.max(2000,Number(process.env.RENDER_WORKER_POLL_MS||5000));
const LEASE_SECONDS=900;
const FFMPEG=process.env.FFMPEG_PATH||'ffmpeg';

if(!SUPABASE_URL||!SERVICE_KEY){
  console.error('Render worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const authHeaders={
  apikey:SERVICE_KEY,
  Authorization:'Bearer '+SERVICE_KEY
};

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

async function downloadStorage(storagePath,destination){
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
  return bytes.length;
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

async function prepareSegment(clip,inputPath,outputPath,manifest,index){
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
    '-c:v','libx264','-preset','veryfast','-crf','18',
    '-pix_fmt','yuv420p',
    '-r',String(fps),
    outputPath
  );
  await run(FFMPEG,args);
}

async function assembleSegments(manifest,segmentPaths,outputPath,crf){
  const args=['-hide_banner','-loglevel','error','-y'];
  for(const file of segmentPaths)args.push('-i',file);

  if(segmentPaths.length===1){
    args.push('-map','0:v:0','-an','-c:v','libx264','-preset','medium','-crf',String(crf),'-pix_fmt','yuv420p',outputPath);
    await run(FFMPEG,args);
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
    '-c:v','libx264','-preset','medium','-crf',String(crf),
    '-pix_fmt','yuv420p',
    '-r',String(manifest.format.fps),
    outputPath
  );
  await run(FFMPEG,args);
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

function buildAss(manifest){
  const w=manifest.format.width,h=manifest.format.height;
  const position=manifest.captions.position;
  const align=position==='top'?8:position==='center'?5:2;
  const marginV=Math.round(h*.06);
  const bg='&H'+assAlpha(manifest.captions.backgroundOpacity)+'000000';
  const lines=[
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: '+w,
    'PlayResY: '+h,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Caption,DejaVu Sans,'+manifest.captions.fontSize+',&H00FFFFFF,&H00FFFFFF,&H00000000,'+bg+',-1,0,0,0,100,100,0,0,3,1,0,'+align+',80,80,'+marginV+',1',
    'Style: Overlay,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'
  ];

  if(manifest.captions.enabled){
    for(const cue of manifest.captions.cues){
      lines.push('Dialogue: 0,'+assTime(cue.startSeconds)+','+assTime(cue.endSeconds)+',Caption,,0,0,0,,'+assEscape(cue.text));
    }
  }
  for(const overlay of manifest.overlays){
    const x=Math.round((overlay.x+overlay.width/2)*w);
    const y=Math.round((overlay.y+overlay.height/2)*h);
    const alpha=assAlpha(overlay.opacity);
    const text='{\\pos('+x+','+y+')\\fs'+Math.round(overlay.fontSize)+'\\alpha&H'+alpha+'&}'+assEscape(overlay.text);
    lines.push('Dialogue: 1,'+assTime(overlay.startSeconds)+','+assTime(overlay.endSeconds)+',Overlay,,0,0,0,,'+text);
  }
  return lines.join('\n')+'\n';
}

async function burnText(manifest,inputPath,assPath,outputPath,crf){
  const hasText=(manifest.captions.enabled&&manifest.captions.cues.length>0)||manifest.overlays.length>0;
  if(!hasText)return inputPath;
  await writeFile(assPath,buildAss(manifest),'utf8');
  await run(FFMPEG,[
    '-hide_banner','-loglevel','error','-y','-i',inputPath,
    '-vf','ass='+assPath,
    '-an',
    '-c:v','libx264','-preset','medium','-crf',String(crf),
    '-pix_fmt','yuv420p',
    outputPath
  ]);
  return outputPath;
}

async function muxVoice(manifest,videoPath,voicePath,outputPath,payload){
  const filters=[];
  if(manifest.audioMix.normalizeVoice)filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  filters.push('volume='+Number(manifest.audioMix.voiceVolume).toFixed(4));
  await run(FFMPEG,[
    '-hide_banner','-loglevel','error','-y',
    '-i',videoPath,
    '-i',voicePath,
    '-map','0:v:0','-map','1:a:0',
    '-c:v','copy',
    '-af',filters.join(','),
    '-c:a','aac','-b:a',String(payload.audioBitrateKbps)+'k',
    '-t',String(rounded(manifest.durationSeconds)),
    '-movflags','+faststart',
    '-shortest',
    outputPath
  ]);
}

async function processJob(jobId,token){
  const root=await mkdtemp(path.join(os.tmpdir(),'cacadores-render-'));
  try{
    const job=await assertActive(jobId,token);
    const payload=job.payload;
    const manifest=payload?.manifest;
    if(!manifest||payload.compilerVersion!=='render-v1')throw new Error('Unsupported render manifest.');

    await heartbeat(jobId,token,3,'downloading-sources');
    const inputDir=path.join(root,'inputs');
    const segDir=path.join(root,'segments');
    await mkdir(inputDir,{recursive:true});
    await mkdir(segDir,{recursive:true});

    const paths=new Map();
    const unique=[
      ...manifest.visualClips.map(clip=>({id:clip.assetId,storagePath:clip.storagePath})),
      {id:manifest.voice.assetId,storagePath:manifest.voice.storagePath}
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
      await prepareSegment(clip,input,output,manifest,i);
      segmentPaths.push(output);
      await heartbeat(jobId,token,20+Math.round((i+1)/manifest.visualClips.length*45),'rendering-clips');
    }

    await assertActive(jobId,token);
    await heartbeat(jobId,token,70,'assembling-timeline');
    const assembled=path.join(root,'assembled.mp4');
    await assembleSegments(manifest,segmentPaths,assembled,payload.crf);

    await assertActive(jobId,token);
    await heartbeat(jobId,token,82,'burning-text');
    const textVideo=await burnText(
      manifest,assembled,path.join(root,'overlays.ass'),path.join(root,'text.mp4'),payload.crf
    );

    await assertActive(jobId,token);
    await heartbeat(jobId,token,90,'mixing-audio');
    const voicePath=paths.get(manifest.voice.assetId);
    if(!voicePath)throw new Error('Narration source missing.');
    const finalPath=path.join(root,'render.mp4');
    await muxVoice(manifest,textVideo,voicePath,finalPath,payload);

    await assertActive(jobId,token);
    await heartbeat(jobId,token,96,'uploading-output');
    const outputPath=[
      'channels',job.channel_id,'episodes',job.episode_id,'renders',
      job.video_edit_id,'v'+String(job.video_edit_version).padStart(4,'0'),
      job.id+'.mp4'
    ].join('/');
    const outputBytes=await uploadStorage(outputPath,finalPath);

    await assertActive(jobId,token);
    await updateOwned(jobId,token,{
      status:'completed',
      progress:100,
      stage:'completed',
      output_path:outputPath,
      output_bytes:outputBytes,
      worker_token:null,
      lease_until:null,
      completed_at:new Date().toISOString(),
      error:null
    });
    console.log(JSON.stringify({event:'render-completed',jobId,outputPath,outputBytes}));
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

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const CLIENT_ID=process.env.YOUTUBE_OAUTH_CLIENT_ID||'';
const CLIENT_SECRET=process.env.YOUTUBE_OAUTH_CLIENT_SECRET||'';
const ENCRYPTION_SECRET=process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY||'';
const TOKEN_ENDPOINT=process.env.YOUTUBE_TOKEN_ENDPOINT||'https://oauth2.googleapis.com/token';
const API_BASE=(process.env.YOUTUBE_API_BASE||'https://www.googleapis.com/youtube/v3').replace(/\/$/,'');
const UPLOAD_BASE=(process.env.YOUTUBE_UPLOAD_BASE||'https://www.googleapis.com/upload/youtube/v3').replace(/\/$/,'');
const BUCKET='cacadores-media';
const POLL_MS=Math.max(2000,Number(process.env.YOUTUBE_PUBLISH_WORKER_POLL_MS||5000));
const LEASE_SECONDS=1800;
const CHUNK_BYTES=8*1024*1024;
const MAX_RETRIES=5;

if(!SUPABASE_URL||!SERVICE_KEY){
  console.error('YouTube publish worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if(!CLIENT_ID||!CLIENT_SECRET||ENCRYPTION_SECRET.length<32){
  console.error('YouTube publish worker requires OAuth client credentials and YOUTUBE_TOKEN_ENCRYPTION_KEY.');
  process.exit(1);
}

const authHeaders={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY};
const cryptoKey=createHash('sha256').update(ENCRYPTION_SECRET,'utf8').digest();

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function safeError(error){return String(error instanceof Error?error.message:error).slice(0,4000);}
function pathUrl(value){return value.split('/').map(encodeURIComponent).join('/');}
function b64(value){return value.toString('base64url');}
function unb64(value){return Buffer.from(value,'base64url');}

function encryptSecret(value,aad){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',cryptoKey,iv);
  cipher.setAAD(Buffer.from(aad,'utf8'));
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return ['v1',b64(iv),b64(cipher.getAuthTag()),b64(encrypted)].join('.');
}

function decryptSecret(ciphertext,aad){
  const [version,ivRaw,tagRaw,dataRaw]=String(ciphertext||'').split('.');
  if(version!=='v1'||!ivRaw||!tagRaw||!dataRaw)throw new Error('Encrypted secret has invalid format.');
  const decipher=createDecipheriv('aes-256-gcm',cryptoKey,unb64(ivRaw));
  decipher.setAAD(Buffer.from(aad,'utf8'));
  decipher.setAuthTag(unb64(tagRaw));
  return Buffer.concat([decipher.update(unb64(dataRaw)),decipher.final()]).toString('utf8');
}

async function rest(pathname,options={}){
  const response=await fetch(SUPABASE_URL+pathname,{
    ...options,
    headers:{...authHeaders,...(options.headers||{})}
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error('Supabase '+response.status+' '+pathname+' '+body.slice(0,800));
  }
  if(response.status===204)return null;
  const body=await response.text();
  return body?JSON.parse(body):null;
}

async function rpc(name,args){
  return rest('/rest/v1/rpc/'+encodeURIComponent(name),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(args)
  });
}

async function queryJob(jobId){
  const select=[
    'id','status','worker_token','payload','channel_id','connection_id','attempts',
    'youtube_video_id','resumable_uri_ciphertext','upload_bytes','upload_total_bytes'
  ].join(',');
  const rows=await rest('/rest/v1/radar_youtube_publish_jobs?id=eq.'+encodeURIComponent(jobId)+'&select='+encodeURIComponent(select));
  return Array.isArray(rows)?rows[0]??null:null;
}

async function queryConnection(connectionId){
  const select='id,channel_id,youtube_channel_id,status,refresh_token_ciphertext';
  const rows=await rest('/rest/v1/radar_youtube_connections?id=eq.'+encodeURIComponent(connectionId)+'&select='+encodeURIComponent(select));
  return Array.isArray(rows)?rows[0]??null:null;
}

async function heartbeat(jobId,token,progress,stage){
  const ok=await rpc('heartbeat_youtube_publish_job',{
    p_job_id:jobId,
    p_worker_token:token,
    p_progress:Math.max(1,Math.min(99,Math.round(progress))),
    p_stage:String(stage).slice(0,120),
    p_lease_seconds:LEASE_SECONDS
  });
  if(ok!==true)throw new Error('YouTube publish lease lost for '+jobId);
}

async function assertActive(jobId,token){
  const job=await queryJob(jobId);
  if(!job)throw new Error('YouTube publish job disappeared.');
  if(job.status==='cancelled'){
    const error=new Error('YouTube publication cancelled.');
    error.code='PUBLISH_CANCELLED';
    throw error;
  }
  if(job.status!=='processing'||job.worker_token!==token){
    throw new Error('YouTube publish job is no longer owned by this worker.');
  }
  return job;
}

async function updateOwned(jobId,token,fields){
  const query='/rest/v1/radar_youtube_publish_jobs?id=eq.'+encodeURIComponent(jobId)+
    '&status=eq.processing&worker_token=eq.'+encodeURIComponent(token)+
    '&select=id';
  const rows=await rest(query,{
    method:'PATCH',
    headers:{'Content-Type':'application/json','Prefer':'return=representation'},
    body:JSON.stringify({...fields,updated_at:new Date().toISOString()})
  });
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('YouTube publish lease lost for '+jobId);
}

async function updateConnection(connectionId,fields){
  await rest('/rest/v1/radar_youtube_connections?id=eq.'+encodeURIComponent(connectionId),{
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
  if(!response.body)throw new Error('Storage object has no response body: '+storagePath);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(destination));
  const info=await stat(destination);
  if(!info.size)throw new Error('Storage object is empty: '+storagePath);
  return {
    bytes:info.size,
    mimeType:response.headers.get('content-type')||'application/octet-stream'
  };
}

async function refreshAccessToken(connection){
  let refreshToken;
  try{
    refreshToken=decryptSecret(connection.refresh_token_ciphertext,connection.channel_id);
  }catch(error){
    error.code='AUTH_REQUIRED';
    throw error;
  }
  const response=await fetch(TOKEN_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:CLIENT_ID,
      client_secret:CLIENT_SECRET,
      refresh_token:refreshToken,
      grant_type:'refresh_token'
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.access_token){
    const error=new Error('YouTube token refresh failed '+response.status+' '+String(body.error_description||body.error||response.statusText));
    if(response.status===400||response.status===401)error.code='AUTH_REQUIRED';
    throw error;
  }
  return String(body.access_token);
}

function videoMetadata(payload){
  return {
    snippet:{
      title:payload.video.title,
      description:payload.video.description,
      tags:payload.video.tags,
      categoryId:payload.video.categoryId,
      defaultLanguage:payload.video.defaultLanguage
    },
    status:{
      privacyStatus:payload.video.privacyStatus,
      license:payload.video.license,
      selfDeclaredMadeForKids:Boolean(payload.video.selfDeclaredMadeForKids),
      containsSyntheticMedia:Boolean(payload.video.containsSyntheticMedia)
    }
  };
}

async function startResumableSession(job,token,accessToken,totalBytes){
  const url=new URL(UPLOAD_BASE+'/videos');
  url.searchParams.set('uploadType','resumable');
  url.searchParams.set('part','snippet,status');
  url.searchParams.set('notifySubscribers','false');
  const response=await fetch(url,{
    method:'POST',
    headers:{
      Authorization:'Bearer '+accessToken,
      'Content-Type':'application/json; charset=UTF-8',
      'X-Upload-Content-Length':String(totalBytes),
      'X-Upload-Content-Type':'video/mp4'
    },
    body:JSON.stringify(videoMetadata(job.payload))
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    const error=new Error('YouTube resumable session failed '+response.status+' '+body.slice(0,1200));
    if(response.status===401)error.code='AUTH_REQUIRED';
    throw error;
  }
  const location=response.headers.get('location');
  if(!location)throw new Error('YouTube resumable session did not return Location.');
  await updateOwned(job.id,token,{
    resumable_uri_ciphertext:encryptSecret(location,job.id),
    upload_bytes:0,
    upload_total_bytes:totalBytes,
    progress:5,
    stage:'upload-session-created'
  });
  return location;
}

function uploadedOffset(response){
  const range=response.headers.get('range')||'';
  const match=range.match(/bytes=0-(\d+)/i);
  return match?Number(match[1])+1:0;
}

async function queryUploadStatus(sessionUri,accessToken,totalBytes){
  const response=await fetch(sessionUri,{
    method:'PUT',
    headers:{
      Authorization:'Bearer '+accessToken,
      'Content-Length':'0',
      'Content-Range':'bytes */'+totalBytes
    }
  });
  if(response.status===308)return {kind:'partial',offset:uploadedOffset(response)};
  if(response.status===200||response.status===201){
    const body=await response.json().catch(()=>({}));
    if(body.id)return {kind:'completed',videoId:String(body.id)};
    throw new Error('Completed YouTube upload response has no video id.');
  }
  if(response.status===404||response.status===410)return {kind:'expired'};
  const body=await response.text().catch(()=>'');
  const error=new Error('YouTube upload status failed '+response.status+' '+body.slice(0,1000));
  if(response.status===401)error.code='AUTH_REQUIRED';
  throw error;
}

function retriableStatus(status){
  return status===408||status===429||status===500||status===502||status===503||status===504;
}

async function uploadChunk(sessionUri,accessToken,buffer,start,totalBytes){
  const end=start+buffer.length-1;
  return fetch(sessionUri,{
    method:'PUT',
    headers:{
      Authorization:'Bearer '+accessToken,
      'Content-Type':'video/mp4',
      'Content-Length':String(buffer.length),
      'Content-Range':'bytes '+start+'-'+end+'/'+totalBytes
    },
    body:buffer
  });
}

async function uploadVideo(job,token,accessToken,videoPath,totalBytes){
  let sessionUri=null;
  if(job.resumable_uri_ciphertext){
    try{sessionUri=decryptSecret(job.resumable_uri_ciphertext,job.id);}
    catch{sessionUri=null;}
  }
  let offset=Math.max(0,Number(job.upload_bytes||0));

  if(sessionUri){
    const state=await queryUploadStatus(sessionUri,accessToken,totalBytes);
    if(state.kind==='completed')return state.videoId;
    if(state.kind==='expired'){
      sessionUri=null;
      offset=0;
      await updateOwned(job.id,token,{
        resumable_uri_ciphertext:null,upload_bytes:0,upload_total_bytes:totalBytes,
        progress:3,stage:'upload-session-expired'
      });
    }else{
      offset=state.offset;
      await updateOwned(job.id,token,{upload_bytes:offset,upload_total_bytes:totalBytes});
    }
  }
  if(!sessionUri)sessionUri=await startResumableSession(job,token,accessToken,totalBytes);

  const file=await open(videoPath,'r');
  try{
    while(offset<totalBytes){
      await assertActive(job.id,token);
      const size=Math.min(CHUNK_BYTES,totalBytes-offset);
      const buffer=Buffer.allocUnsafe(size);
      const {bytesRead}=await file.read(buffer,0,size,offset);
      if(bytesRead<=0)throw new Error('Unexpected EOF while reading render output.');
      const chunk=bytesRead===buffer.length?buffer:buffer.subarray(0,bytesRead);

      const chunkStart=offset;
      let response=null;
      let lastError=null;
      let restartChunk=false;
      for(let attempt=0;attempt<MAX_RETRIES;attempt++){
        try{
          response=await uploadChunk(sessionUri,accessToken,chunk,chunkStart,totalBytes);
          if(response.status===308||response.status===200||response.status===201)break;
          if(response.status===404||response.status===410){
            const error=new Error('UPLOAD_SESSION_EXPIRED');
            error.code='UPLOAD_SESSION_EXPIRED';
            throw error;
          }
          const body=await response.text().catch(()=>'');
          if(!retriableStatus(response.status)){
            const error=new Error('YouTube upload failed '+response.status+' '+body.slice(0,1200));
            if(response.status===401)error.code='AUTH_REQUIRED';
            throw error;
          }
          lastError=new Error('YouTube retriable upload error '+response.status+' '+body.slice(0,600));
        }catch(error){
          if(error?.code==='AUTH_REQUIRED'||error?.code==='UPLOAD_SESSION_EXPIRED')throw error;
          lastError=error;
        }
        await sleep(Math.min(16000,1000*Math.pow(2,attempt)));
        const state=await queryUploadStatus(sessionUri,accessToken,totalBytes);
        if(state.kind==='completed')return state.videoId;
        if(state.kind==='expired'){
          const error=new Error('UPLOAD_SESSION_EXPIRED');
          error.code='UPLOAD_SESSION_EXPIRED';
          throw error;
        }
        offset=state.offset;
        await updateOwned(job.id,token,{upload_bytes:offset});
        if(offset!==chunkStart){
          restartChunk=true;
          break;
        }
      }
      if(restartChunk)continue;
      if(!response||!(response.status===308||response.status===200||response.status===201)){
        throw lastError||new Error('YouTube upload exhausted retries.');
      }

      if(response.status===200||response.status===201){
        const body=await response.json().catch(()=>({}));
        if(!body.id)throw new Error('YouTube upload completed without video id.');
        return String(body.id);
      }

      offset=uploadedOffset(response);
      const progress=5+Math.round((offset/totalBytes)*80);
      await heartbeat(job.id,token,progress,'uploading-video');
      await updateOwned(job.id,token,{
        upload_bytes:offset,
        upload_total_bytes:totalBytes
      });
    }
  }finally{
    await file.close();
  }
  const state=await queryUploadStatus(sessionUri,accessToken,totalBytes);
  if(state.kind==='completed')return state.videoId;
  throw new Error('YouTube upload ended without completion response.');
}

async function uploadThumbnail(videoId,accessToken,thumbnailPath,mimeType){
  const bytes=await readFile(thumbnailPath);
  const url=new URL(UPLOAD_BASE+'/thumbnails/set');
  url.searchParams.set('videoId',videoId);
  url.searchParams.set('uploadType','media');
  const response=await fetch(url,{
    method:'POST',
    headers:{
      Authorization:'Bearer '+accessToken,
      'Content-Type':mimeType
    },
    body:bytes
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    const error=new Error('YouTube thumbnail upload failed '+response.status+' '+body.slice(0,1200));
    if(response.status===401)error.code='AUTH_REQUIRED';
    throw error;
  }
}

async function verifyVideo(videoId,accessToken){
  const url=new URL(API_BASE+'/videos');
  url.searchParams.set('part','status');
  url.searchParams.set('id',videoId);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+accessToken}});
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    const error=new Error('YouTube video verification failed '+response.status+' '+body.slice(0,1000));
    if(response.status===401)error.code='AUTH_REQUIRED';
    throw error;
  }
  const body=await response.json().catch(()=>({}));
  const item=body.items?.[0];
  if(!item?.id)throw new Error('Uploaded YouTube video could not be verified.');
  return String(item.status?.privacyStatus||'');
}

async function markVideoUploaded(jobId,token,videoId){
  await updateOwned(jobId,token,{
    youtube_video_id:videoId,
    youtube_url:'https://www.youtube.com/watch?v='+encodeURIComponent(videoId),
    resumable_uri_ciphertext:null,
    upload_bytes:0,
    progress:90,
    stage:'video-uploaded'
  });
}

async function processJob(jobId,token){
  let job=await assertActive(jobId,token);
  const connection=await queryConnection(job.connection_id);
  if(!connection)throw new Error('YouTube connection disappeared.');
  if(connection.status!=='connected'){
    const error=new Error('YouTube connection requires reauthorization.');
    error.code='AUTH_REQUIRED';
    throw error;
  }
  if(connection.channel_id!==job.channel_id||
     connection.youtube_channel_id!==job.payload.youtubeChannelId){
    throw new Error('YouTube connection channel no longer matches publication snapshot.');
  }

  await heartbeat(job.id,token,2,'refreshing-oauth');
  const accessToken=await refreshAccessToken(connection);
  const tempDir=await mkdtemp(path.join(os.tmpdir(),'cacadores-youtube-'));
  try{
    let videoId=job.youtube_video_id?String(job.youtube_video_id):'';
    if(!videoId){
      const videoPath=path.join(tempDir,'video.mp4');
      await heartbeat(job.id,token,3,'downloading-video');
      const video=await downloadStorage(job.payload.renderOutputPath,videoPath);
      if(video.bytes<=0)throw new Error('Render output is empty.');
      job=await assertActive(job.id,token);
      try{
        videoId=await uploadVideo(job,token,accessToken,videoPath,video.bytes);
      }catch(error){
        if(error?.code==='UPLOAD_SESSION_EXPIRED'){
          await updateOwned(job.id,token,{
            resumable_uri_ciphertext:null,upload_bytes:0,upload_total_bytes:video.bytes,
            progress:3,stage:'upload-session-reset'
          });
          const fresh=await assertActive(job.id,token);
          videoId=await uploadVideo({...fresh,resumable_uri_ciphertext:null,upload_bytes:0},token,accessToken,videoPath,video.bytes);
        }else throw error;
      }
      await markVideoUploaded(job.id,token,videoId);
    }

    await assertActive(job.id,token);
    await heartbeat(job.id,token,92,'downloading-thumbnail');
    const thumbnailPath=path.join(tempDir,'thumbnail');
    const thumbnail=await downloadStorage(job.payload.thumbnailStoragePath,thumbnailPath);
    const mime=['image/jpeg','image/png'].includes(thumbnail.mimeType)
      ?thumbnail.mimeType
      :job.payload.thumbnailStoragePath.toLowerCase().endsWith('.png')?'image/png':'image/jpeg';
    await heartbeat(job.id,token,94,'uploading-thumbnail');
    await uploadThumbnail(videoId,accessToken,thumbnailPath,mime);

    await heartbeat(job.id,token,98,'verifying-video');
    const actualPrivacyStatus=await verifyVideo(videoId,accessToken);
    await updateOwned(job.id,token,{
      status:'completed',
      progress:100,
      stage:'completed',
      actual_privacy_status:actualPrivacyStatus||null,
      worker_token:null,
      lease_until:null,
      error:null,
      completed_at:new Date().toISOString()
    });
    console.log(JSON.stringify({event:'youtube-publish-completed',jobId:job.id,videoId,actualPrivacyStatus}));
  }finally{
    await rm(tempDir,{recursive:true,force:true}).catch(()=>{});
  }
}

async function failOwned(jobId,token,error){
  if(error?.code==='PUBLISH_CANCELLED')return;
  const message=safeError(error);
  if(error?.code==='AUTH_REQUIRED'){
    const job=await queryJob(jobId).catch(()=>null);
    if(job?.connection_id){
      await updateConnection(job.connection_id,{
        status:'needs-reauth',
        error:message
      }).catch(()=>{});
    }
  }
  await rest(
    '/rest/v1/radar_youtube_publish_jobs?id=eq.'+encodeURIComponent(jobId)+
    '&status=eq.processing&worker_token=eq.'+encodeURIComponent(token),
    {
      method:'PATCH',
      headers:{'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({
        status:'failed',
        stage:error?.code==='AUTH_REQUIRED'?'auth-required':'failed',
        worker_token:null,
        lease_until:null,
        error:message,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      })
    }
  ).catch(()=>{});
  console.error(JSON.stringify({event:'youtube-publish-failed',jobId,error:message}));
}

async function runOnce(){
  const token=randomUUID();
  const jobId=await rpc('claim_youtube_publish_job',{
    p_worker_token:token,
    p_lease_seconds:LEASE_SECONDS
  });
  if(!jobId)return false;
  try{
    await processJob(String(jobId),token);
  }catch(error){
    await failOwned(String(jobId),token,error);
  }
  return true;
}

console.log(JSON.stringify({
  event:'youtube-publish-worker-started',
  pollMs:POLL_MS,
  chunkBytes:CHUNK_BYTES,
  tokenEndpoint:new URL(TOKEN_ENDPOINT).origin,
  apiEndpoint:new URL(API_BASE).origin,
  uploadEndpoint:new URL(UPLOAD_BASE).origin
}));

while(true){
  try{
    const worked=await runOnce();
    if(!worked)await sleep(POLL_MS);
  }catch(error){
    console.error(JSON.stringify({event:'youtube-publish-worker-loop-error',error:safeError(error)}));
    await sleep(Math.max(POLL_MS,5000));
  }
}

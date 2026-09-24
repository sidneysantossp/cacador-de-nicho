import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';

function listen(server:ReturnType<typeof createServer>){
  return new Promise<number>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      if(!address||typeof address==='string')return reject(new Error('missing server port'));
      resolve(address.port);
    });
  });
}
function close(server:ReturnType<typeof createServer>){
  return new Promise<void>(resolve=>server.close(()=>resolve()));
}
async function body(req:IncomingMessage){
  const chunks:Buffer[]=[];
  for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function json(res:ServerResponse,status:number,value:unknown,headers:Record<string,string>={}){
  const bytes=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'Content-Type':'application/json','Content-Length':String(bytes.length),...headers});
  res.end(bytes);
}
function encrypt(value:string,aad:string,secret:string){
  const key=createHash('sha256').update(secret,'utf8').digest();
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(aad,'utf8'));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const b64=(v:Buffer)=>v.toString('base64url');
  return ['v1',b64(iv),b64(cipher.getAuthTag()),b64(encrypted)].join('.');
}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('YouTube worker resumes after an accepted chunk loses its response',async()=>{
  const channelId='21210000-0000-4000-8000-000000000001';
  const connectionId='21210000-0000-4000-8000-000000000104';
  const jobId='21210000-0000-4000-8000-000000000105';
  const secret='stage21-integration-key-'+randomBytes(24).toString('hex');
  const video=Buffer.alloc(9*1024*1024,7);
  const thumbnail=Buffer.from('stage21-thumbnail');
  const events:Array<Record<string,unknown>>=[];
  let uploadPort=0;

  const connection={
    id:connectionId,
    channel_id:channelId,
    youtube_channel_id:'UC_STAGE21_MOCK',
    status:'connected',
    refresh_token_ciphertext:encrypt('stage21-refresh-token',channelId,secret)
  };
  const packageId='21210000-0000-4000-8000-000000000103';
  const episodeId='21210000-0000-4000-8000-000000000002';
  const job:any={
    id:jobId,
    channel_id:channelId,
    connection_id:connectionId,
    package_id:packageId,
    status:'queued',
    progress:0,
    stage:'queued',
    attempts:0,
    worker_token:null,
    youtube_video_id:null,
    resumable_uri_ciphertext:null,
    upload_bytes:0,
    upload_total_bytes:null,
    payload:{
      kind:'youtube-publish-job',
      channelId,
      packageId,
      packageVersion:4,
      connectionId,
      youtubeChannelId:'UC_STAGE21_MOCK',
      renderOutputPath:'e2e/stage21/video.mp4',
      thumbnailStoragePath:'e2e/stage21/thumb.jpg',
      video:{
        title:'Stage 21 Resumable Upload Test',
        description:'Synthetic worker integration test.',
        tags:['stage21','resumable'],
        categoryId:'28',
        defaultLanguage:'en',
        privacyStatus:'private',
        license:'youtube',
        selfDeclaredMadeForKids:false,
        containsSyntheticMedia:true
      },
      requestedBy:'operator',
      createdAt:new Date().toISOString()
    }
  };

  const episode:any={
    id:episodeId,
    status:'production',
    payload:{
      id:episodeId,channelId,sequence:1,status:'production',title:'Stage 21 episode',
      thesis:'Synthetic',narrativeSummary:'Synthetic',
      prerequisiteConcepts:[],introducesConcepts:[],reinforcesConcepts:[],
      opensThreads:[],resolvesThreads:[],repetitionKeys:[],
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    }
  };
  const packageRow={id:packageId,episode_id:episodeId};
  const youtubeState={total:0,received:0,failed:false,thumbnail:false,verified:false,metadata:null as any};
  const youtubeServer=createServer(async(req,res)=>{
    const url=new URL(req.url??'/',`http://127.0.0.1:${uploadPort||1}`);
    if(req.method==='POST'&&url.pathname==='/token'){
      await body(req);events.push({event:'token'});return json(res,200,{access_token:'integration-access-token'});
    }
    if(req.method==='POST'&&url.pathname==='/upload/youtube/v3/videos'){
      youtubeState.metadata=JSON.parse((await body(req)).toString()||'{}');
      youtubeState.total=Number(req.headers['x-upload-content-length']??0);
      youtubeState.received=0;
      events.push({event:'session',total:youtubeState.total});
      res.writeHead(200,{Location:`http://127.0.0.1:${uploadPort}/resumable/session1`,'Content-Length':'0'});return res.end();
    }
    if(req.method==='PUT'&&url.pathname==='/resumable/session1'){
      const range=String(req.headers['content-range']??'');
      if(range.startsWith('bytes */')){
        await body(req);events.push({event:'status',received:youtubeState.received});
        res.writeHead(308,{
          ...(youtubeState.received>0?{Range:`bytes=0-${youtubeState.received-1}`}:{}),
          'Content-Length':'0'
        });return res.end();
      }
      const bytes=await body(req);
      const match=range.match(/bytes (\d+)-(\d+)\/(\d+)/);
      assert.ok(match,'worker must send Content-Range');
      const start=Number(match[1]),end=Number(match[2]);
      assert.equal(start,youtubeState.received,'worker must resume from confirmed offset');
      youtubeState.received=end+1;
      events.push({event:'chunk',start,end,bytes:bytes.length});
      if(!youtubeState.failed){
        youtubeState.failed=true;
        events.push({event:'synthetic-503',accepted:youtubeState.received});
        return json(res,503,{error:'synthetic'});
      }
      if(youtubeState.received>=youtubeState.total)return json(res,201,{id:'stage21Video123'});
      res.writeHead(308,{Range:`bytes=0-${youtubeState.received-1}`,'Content-Length':'0'});return res.end();
    }
    if(req.method==='POST'&&url.pathname==='/upload/youtube/v3/thumbnails/set'){
      const bytes=await body(req);
      youtubeState.thumbnail=true;events.push({event:'thumbnail',bytes:bytes.length});
      return json(res,200,{ok:true});
    }
    if(req.method==='GET'&&url.pathname==='/youtube/v3/videos'){
      youtubeState.verified=true;events.push({event:'verify'});
      return json(res,200,{items:[{id:'stage21Video123',status:{privacyStatus:'private'}}]});
    }
    json(res,404,{error:'not-found'});
  });
  uploadPort=await listen(youtubeServer);

  const supabaseServer=createServer(async(req,res)=>{
    const url=new URL(req.url??'/','http://127.0.0.1');
    if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/claim_youtube_publish_job'){
      const args=JSON.parse((await body(req)).toString()||'{}');
      if(job.status!=='queued')return json(res,200,null);
      job.status='processing';job.stage='claimed';job.progress=1;job.attempts+=1;job.worker_token=args.p_worker_token;
      return json(res,200,job.id);
    }
    if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/heartbeat_youtube_publish_job'){
      const args=JSON.parse((await body(req)).toString()||'{}');
      const ok=job.status==='processing'&&job.worker_token===args.p_worker_token;
      if(ok){job.progress=Math.max(job.progress,Number(args.p_progress));job.stage=String(args.p_stage);}
      return json(res,200,ok);
    }
    if(req.method==='GET'&&url.pathname==='/rest/v1/radar_youtube_publish_jobs')return json(res,200,[job]);
    if(req.method==='GET'&&url.pathname==='/rest/v1/radar_youtube_connections')return json(res,200,[connection]);
    if(req.method==='GET'&&url.pathname==='/rest/v1/radar_publication_packages')return json(res,200,[packageRow]);
    if(req.method==='GET'&&url.pathname==='/rest/v1/radar_episodes')return json(res,200,[episode]);
    if(req.method==='PATCH'&&url.pathname==='/rest/v1/radar_episodes'){
      Object.assign(episode,JSON.parse((await body(req)).toString()||'{}'));
      events.push({event:'episode-published',status:episode.status,youtubeVideoId:episode.payload?.youtubeVideoId});
      if(String(req.headers.prefer??'').includes('return=representation'))return json(res,200,[{id:episode.id}]);
      res.writeHead(204);return res.end();
    }
    if(req.method==='PATCH'&&url.pathname==='/rest/v1/radar_youtube_publish_jobs'){
      Object.assign(job,JSON.parse((await body(req)).toString()||'{}'));
      if(String(req.headers.prefer??'').includes('return=representation'))return json(res,200,[{id:job.id}]);
      res.writeHead(204);return res.end();
    }
    if(req.method==='PATCH'&&url.pathname==='/rest/v1/radar_youtube_connections'){
      Object.assign(connection,JSON.parse((await body(req)).toString()||'{}'));
      res.writeHead(204);return res.end();
    }
    if(req.method==='GET'&&url.pathname.includes('/storage/v1/object/cacadores-media/e2e/stage21/video.mp4')){
      res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':String(video.length)});return res.end(video);
    }
    if(req.method==='GET'&&url.pathname.includes('/storage/v1/object/cacadores-media/e2e/stage21/thumb.jpg')){
      res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':String(thumbnail.length)});return res.end(thumbnail);
    }
    json(res,404,{error:'not-found',path:url.pathname});
  });
  const supabasePort=await listen(supabaseServer);

  let stderr='',stdout='';
  const child=spawn(process.execPath,['scripts/youtube-publish-worker.mjs'],{
    env:{
      ...process.env,
      SUPABASE_URL:`http://127.0.0.1:${supabasePort}`,
      SUPABASE_SERVICE_ROLE_KEY:'integration-service-key',
      YOUTUBE_OAUTH_CLIENT_ID:'integration-client',
      YOUTUBE_OAUTH_CLIENT_SECRET:'integration-client-secret',
      YOUTUBE_TOKEN_ENCRYPTION_KEY:secret,
      YOUTUBE_TOKEN_ENDPOINT:`http://127.0.0.1:${uploadPort}/token`,
      YOUTUBE_API_BASE:`http://127.0.0.1:${uploadPort}/youtube/v3`,
      YOUTUBE_UPLOAD_BASE:`http://127.0.0.1:${uploadPort}/upload/youtube/v3`,
      YOUTUBE_PUBLISH_WORKER_POLL_MS:'2000'
    },
    stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',chunk=>stdout+=chunk.toString());
  child.stderr.on('data',chunk=>stderr+=chunk.toString());

  try{
    const deadline=Date.now()+15000;
    while(job.status!=='completed'&&Date.now()<deadline)await wait(100);
    assert.equal(job.status,'completed',stderr||stdout);
    assert.equal(job.youtube_video_id,'stage21Video123');
    assert.equal(job.actual_privacy_status,'private');
    assert.equal(job.progress,100);
    assert.equal(episode.status,'published');
    assert.equal(episode.payload.youtubeVideoId,'stage21Video123');
    assert.ok(episode.payload.publishedAt);
    assert.equal(youtubeState.thumbnail,true);
    assert.equal(youtubeState.verified,true);
    assert.equal(youtubeState.metadata.status.selfDeclaredMadeForKids,false);
    assert.equal(youtubeState.metadata.status.containsSyntheticMedia,true);
    assert.equal(youtubeState.metadata.status.privacyStatus,'private');

    const chunks=events.filter(event=>event.event==='chunk');
    assert.equal(chunks.length,2);
    assert.equal(chunks[0].start,0);
    assert.equal(chunks[0].end,8*1024*1024-1);
    assert.equal(chunks[1].start,8*1024*1024);
    assert.ok(events.some(event=>event.event==='synthetic-503'));
    assert.ok(events.some(event=>event.event==='status'));
    assert.ok(events.some(event=>event.event==='thumbnail'));
    assert.ok(events.some(event=>event.event==='verify'));
    assert.ok(events.some(event=>event.event==='episode-published'));
  }finally{
    child.kill('SIGTERM');
    await Promise.all([close(supabaseServer),close(youtubeServer)]);
  }
});

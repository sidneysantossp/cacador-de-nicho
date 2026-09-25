import { randomUUID } from 'node:crypto';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE_WORKER_URL=(process.env.OWNED_VISUAL_WORKER_URL||process.env.AUTOMATION_WORKER_URL||'').trim();
const WORKER_SECRET=(process.env.OWNED_VISUAL_WORKER_SECRET||process.env.AUTOMATION_WORKER_SECRET||'').trim();
const POLL_MS=Math.max(3000,Number(process.env.OWNED_VISUAL_WORKER_POLL_MS||5000));
const LEASE_SECONDS=Math.max(300,Math.min(7200,Number(process.env.OWNED_VISUAL_WORKER_LEASE_SECONDS||3600)));

if(!SUPABASE_URL||!SERVICE_KEY){
  console.error('Owned Visual worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if(!BASE_WORKER_URL||WORKER_SECRET.length<32){
  console.error('Owned Visual worker requires a worker URL and 32+ character secret.');
  process.exit(1);
}

const WORKER_URL=new URL('/api/workers/owned-media-intelligence',BASE_WORKER_URL).toString();
const authHeaders={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY};

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function safeError(error){return String(error instanceof Error?error.message:error).slice(0,4000);}

async function rpc(name,args){
  const response=await fetch(
    SUPABASE_URL+'/rest/v1/rpc/'+encodeURIComponent(name),
    {
      method:'POST',
      headers:{...authHeaders,'Content-Type':'application/json'},
      body:JSON.stringify(args)
    }
  );
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error('Supabase RPC '+name+' failed '+response.status+' '+body.slice(0,1000));
  }
  const text=await response.text();
  return text?JSON.parse(text):null;
}

async function claim(){
  const workerToken=randomUUID();
  const jobId=await rpc('claim_owned_media_analysis_job',{
    p_worker_token:workerToken,
    p_lease_seconds:LEASE_SECONDS
  });
  if(!jobId)return null;
  return {jobId:String(jobId),workerToken};
}

async function execute(claimed){
  const response=await fetch(WORKER_URL,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-owned-visual-worker-secret':WORKER_SECRET
    },
    body:JSON.stringify(claimed),
    signal:AbortSignal.timeout(Math.min((LEASE_SECONDS-30)*1000,6900000))
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    throw new Error(
      'Owned Visual worker step failed '+response.status+' '+
      String(body.message||body.error||response.statusText)
    );
  }
  return body;
}

console.log(JSON.stringify({
  event:'owned-visual-worker-started',
  pollMs:POLL_MS,
  leaseSeconds:LEASE_SECONDS,
  workerOrigin:new URL(WORKER_URL).origin
}));

while(true){
  try{
    const claimed=await claim();
    if(!claimed){
      await sleep(POLL_MS);
      continue;
    }
    console.log(JSON.stringify({event:'owned-visual-job-claimed',jobId:claimed.jobId}));
    try{
      const result=await execute(claimed);
      console.log(JSON.stringify({
        event:'owned-visual-job-finished',
        jobId:claimed.jobId,
        assetId:result.assetId,
        segmentCount:result.segmentCount,
        status:result.status
      }));
    }catch(error){
      console.error(JSON.stringify({
        event:'owned-visual-job-error',
        jobId:claimed.jobId,
        error:safeError(error)
      }));
    }
    await sleep(POLL_MS);
  }catch(error){
    console.error(JSON.stringify({
      event:'owned-visual-worker-loop-error',
      error:safeError(error)
    }));
    await sleep(Math.max(POLL_MS,5000));
  }
}

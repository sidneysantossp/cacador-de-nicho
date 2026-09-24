import { randomUUID } from 'node:crypto';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const WORKER_URL=(process.env.AUTOMATION_WORKER_URL||'').trim();
const WORKER_SECRET=(process.env.AUTOMATION_WORKER_SECRET||'').trim();
const POLL_MS=Math.max(2000,Number(process.env.AUTOMATION_WORKER_POLL_MS||5000));
const LEASE_SECONDS=Math.max(60,Math.min(3600,Number(process.env.AUTOMATION_WORKER_LEASE_SECONDS||900)));

if(!SUPABASE_URL||!SERVICE_KEY){
  console.error('Episode Automation worker requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if(!WORKER_URL||WORKER_SECRET.length<32){
  console.error('Episode Automation worker requires AUTOMATION_WORKER_URL and a 32+ character AUTOMATION_WORKER_SECRET.');
  process.exit(1);
}

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
  const runId=await rpc('claim_episode_automation_run',{
    p_worker_token:workerToken,
    p_lease_seconds:LEASE_SECONDS
  });
  if(!runId)return null;
  return {runId:String(runId),workerToken};
}

async function execute(claimed){
  const response=await fetch(WORKER_URL,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-automation-worker-secret':WORKER_SECRET
    },
    body:JSON.stringify(claimed),
    signal:AbortSignal.timeout(300000)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    throw new Error(
      'Automation worker step failed '+response.status+' '+
      String(body.message||body.error||response.statusText)
    );
  }
  return body;
}

console.log(JSON.stringify({
  event:'episode-automation-worker-started',
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
    console.log(JSON.stringify({
      event:'episode-automation-run-claimed',
      runId:claimed.runId
    }));
    try{
      const result=await execute(claimed);
      console.log(JSON.stringify({
        event:'episode-automation-step-finished',
        runId:claimed.runId,
        status:result.status,
        currentStep:result.currentStep,
        holdStep:result.holdStep??null
      }));
    }catch(error){
      console.error(JSON.stringify({
        event:'episode-automation-step-error',
        runId:claimed.runId,
        error:safeError(error)
      }));
    }
    await sleep(POLL_MS);
  }catch(error){
    console.error(JSON.stringify({
      event:'episode-automation-worker-loop-error',
      error:safeError(error)
    }));
    await sleep(Math.max(POLL_MS,5000));
  }
}

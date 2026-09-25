import { randomUUID } from 'node:crypto';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE_WORKER_URL=(process.env.VERIFIED_STOCK_WORKER_URL||process.env.AUTOMATION_WORKER_URL||'').trim();
const WORKER_SECRET=(process.env.VERIFIED_STOCK_WORKER_SECRET||process.env.AUTOMATION_WORKER_SECRET||'').trim();
const POLL_MS=Math.max(3000,Number(process.env.VERIFIED_STOCK_WORKER_POLL_MS||5000));
const LEASE_SECONDS=Math.max(300,Math.min(7200,Number(process.env.VERIFIED_STOCK_WORKER_LEASE_SECONDS||1800)));

if(!SUPABASE_URL||!SERVICE_KEY){console.error('Verified Stock worker requires Supabase service credentials.');process.exit(1);}
if(!BASE_WORKER_URL||WORKER_SECRET.length<32){console.error('Verified Stock worker requires URL and 32+ character secret.');process.exit(1);}

const WORKER_URL=new URL('/api/workers/verified-stock',BASE_WORKER_URL).toString();
const authHeaders={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeError=error=>String(error instanceof Error?error.message:error).slice(0,4000);

async function rpc(name,args){
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+encodeURIComponent(name),{
    method:'POST',
    headers:{...authHeaders,'Content-Type':'application/json'},
    body:JSON.stringify(args)
  });
  if(!response.ok)throw new Error('Supabase RPC '+name+' failed '+response.status+' '+await response.text());
  const body=await response.text();
  return body?JSON.parse(body):null;
}

async function claim(){
  const workerToken=randomUUID();
  const jobId=await rpc('claim_verified_stock_job',{
    p_worker_token:workerToken,
    p_lease_seconds:LEASE_SECONDS
  });
  return jobId?{jobId:String(jobId),workerToken}:null;
}

async function execute(claimed){
  const response=await fetch(WORKER_URL,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-verified-stock-worker-secret':WORKER_SECRET
    },
    body:JSON.stringify(claimed),
    signal:AbortSignal.timeout(Math.min((LEASE_SECONDS-30)*1000,6900000))
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Verified Stock worker failed '+response.status+' '+String(body.message||body.error||response.statusText));
  return body;
}

console.log(JSON.stringify({event:'verified-stock-worker-started',pollMs:POLL_MS,leaseSeconds:LEASE_SECONDS}));
while(true){
  try{
    const claimed=await claim();
    if(!claimed){await sleep(POLL_MS);continue;}
    console.log(JSON.stringify({event:'verified-stock-job-claimed',jobId:claimed.jobId}));
    try{
      const result=await execute(claimed);
      console.log(JSON.stringify({event:'verified-stock-job-finished',jobId:claimed.jobId,status:result.status}));
    }catch(error){
      console.error(JSON.stringify({event:'verified-stock-job-error',jobId:claimed.jobId,error:safeError(error)}));
    }
    await sleep(POLL_MS);
  }catch(error){
    console.error(JSON.stringify({event:'verified-stock-worker-loop-error',error:safeError(error)}));
    await sleep(Math.max(POLL_MS,5000));
  }
}

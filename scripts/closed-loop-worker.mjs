import { randomUUID } from 'node:crypto';

const URL=(process.env.LEARNING_LOOP_WORKER_URL||'').trim();
const SECRET=(process.env.LEARNING_LOOP_WORKER_SECRET||'').trim();
const POLL_MS=Math.max(5000,Number(process.env.LEARNING_LOOP_WORKER_POLL_MS||30000));

if(!URL||SECRET.length<32){
  console.error('Closed Loop worker requires LEARNING_LOOP_WORKER_URL and LEARNING_LOOP_WORKER_SECRET.');
  process.exit(1);
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function safeError(error){return String(error instanceof Error?error.message:error).slice(0,3000);}

async function tick(){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),290000);
  try{
    const response=await fetch(URL,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-learning-loop-worker-secret':SECRET
      },
      body:JSON.stringify({workerToken:randomUUID()}),
      signal:controller.signal
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      throw new Error('Closed Loop worker HTTP '+response.status+' '+String(body.message||response.statusText));
    }
    if(body.job){
      console.log(JSON.stringify({
        event:'closed-loop-job-finished',
        jobId:body.job.id,
        status:body.job.status,
        stage:body.job.stage,
        attempts:body.job.attempts
      }));
      return true;
    }
    return false;
  }finally{
    clearTimeout(timeout);
  }
}

console.log(JSON.stringify({
  event:'closed-loop-worker-started',
  pollMs:POLL_MS,
  workerOrigin:new URL(URL).origin
}));

while(true){
  try{
    const worked=await tick();
    if(!worked)await sleep(POLL_MS);
  }catch(error){
    console.error(JSON.stringify({
      event:'closed-loop-worker-error',
      error:safeError(error)
    }));
    await sleep(Math.max(POLL_MS,15000));
  }
}

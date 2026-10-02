const endpoint=(process.env.PRODUCTION_AUTONOMY_WORKER_URL||'').trim();
const secret=(process.env.PRODUCTION_AUTONOMY_WORKER_SECRET||'').trim();
const pollMs=Math.max(2000,Number(process.env.PRODUCTION_AUTONOMY_WORKER_POLL_MS||5000));
if(!endpoint||secret.length<32){console.error('Production Autonomy Worker requires PRODUCTION_AUTONOMY_WORKER_URL and a 32+ character PRODUCTION_AUTONOMY_WORKER_SECRET.');process.exit(1);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stopping=false;
let activeController=null;
const requestStop=()=>{stopping=true;activeController?.abort();};
process.once('SIGTERM',requestStop);
process.once('SIGINT',requestStop);
console.log(JSON.stringify({event:'production-autonomy-worker-started',pollMs,workerOrigin:new URL(endpoint).origin}));
while(!stopping){
  const controller=new AbortController(); activeController=controller;
  let timeout;
  try{
    timeout=setTimeout(()=>controller.abort(),300000);
    const response=await fetch(endpoint,{method:'POST',headers:{'x-production-autonomy-worker-secret':secret},signal:controller.signal});
    if(!response.ok)console.error(JSON.stringify({event:'production-autonomy-worker-error',status:response.status,detail:(await response.text()).slice(0,500)}));
    else{const body=await response.json();if(body.status!=='idle')console.log(JSON.stringify({event:'production-autonomy-worker-job',status:body.status,assessmentId:body.assessmentId||null}));}
  }catch(error){if(!stopping)console.error(JSON.stringify({event:'production-autonomy-worker-error',detail:String(error).slice(0,500)}));}
  finally{if(timeout)clearTimeout(timeout);activeController=null;}
  if(!stopping)await sleep(pollMs);
}
console.log(JSON.stringify({event:'production-autonomy-worker-stopped'}));

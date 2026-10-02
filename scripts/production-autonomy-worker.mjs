const endpoint=(process.env.PRODUCTION_AUTONOMY_WORKER_URL||'').trim();
const secret=(process.env.PRODUCTION_AUTONOMY_WORKER_SECRET||'').trim();
const pollMs=Math.max(2000,Number(process.env.PRODUCTION_AUTONOMY_WORKER_POLL_MS||5000));
if(!endpoint||secret.length<32){console.error('Production Autonomy Worker requires PRODUCTION_AUTONOMY_WORKER_URL and a 32+ character PRODUCTION_AUTONOMY_WORKER_SECRET.');process.exit(1);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
console.log(JSON.stringify({event:'production-autonomy-worker-started',pollMs,workerOrigin:new URL(endpoint).origin}));
while(true){
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'x-production-autonomy-worker-secret':secret},signal:AbortSignal.timeout(300000)});
    if(!response.ok)console.error(JSON.stringify({event:'production-autonomy-worker-error',status:response.status,detail:(await response.text()).slice(0,500)}));
    else{const body=await response.json();if(body.status!=='idle')console.log(JSON.stringify({event:'production-autonomy-worker-job',status:body.status,assessmentId:body.assessmentId||null}));}
  }catch(error){console.error(JSON.stringify({event:'production-autonomy-worker-error',detail:String(error).slice(0,500)}));}
  await sleep(pollMs);
}

import { spawn } from 'node:child_process';

const SERVER_URL='http://127.0.0.1:3000/api/health';

function child(command,args){
  return spawn(command,args,{stdio:'inherit',env:process.env});
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

const server=child('node',['server.js']);
let worker=null;
let stopping=false;

async function stop(code=0){
  if(stopping)return;
  stopping=true;
  if(worker&&!worker.killed)worker.kill('SIGTERM');
  if(!server.killed)server.kill('SIGTERM');
  setTimeout(()=>process.exit(code),1500).unref();
}

process.on('SIGTERM',()=>void stop(0));
process.on('SIGINT',()=>void stop(0));

server.on('exit',code=>{
  if(!stopping){
    console.error(JSON.stringify({event:'owned-visual-local-server-exit',code}));
    void stop(code||1);
  }
});

let ready=false;
for(let attempt=1;attempt<=60;attempt++){
  if(server.exitCode!==null)break;
  try{
    const response=await fetch(SERVER_URL,{signal:AbortSignal.timeout(1500)});
    if(response.ok){
      const body=await response.json().catch(()=>({}));
      if(body?.ok===true){ready=true;break;}
    }
  }catch{}
  await sleep(1000);
}

if(!ready){
  console.error(JSON.stringify({event:'owned-visual-local-server-not-ready'}));
  await stop(1);
}else{
  console.log(JSON.stringify({event:'owned-visual-local-server-ready'}));
  worker=child('node',['scripts/owned-media-intelligence-worker.mjs']);
  worker.on('exit',code=>{
    if(!stopping){
      console.error(JSON.stringify({event:'owned-visual-poller-exit',code}));
      void stop(code||1);
    }
  });
}

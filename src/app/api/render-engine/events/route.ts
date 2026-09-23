import { z } from 'zod';
import { authenticated, errorResponse, HttpError } from '@/lib/server/auth';
import { dbConfigured } from '@/lib/server/db';
import { listRenderJobs } from '@/lib/server/render-engine';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function GET(request:Request){
  try{
    if(!authenticated(request))throw new HttpError('Entre com a senha da operação para continuar.',401);
    if(!dbConfigured())throw new HttpError('Configure o Supabase para usar Render Engine.',503);
    const url=new URL(request.url);
    const channelId=url.searchParams.get('channelId')?.trim();
    if(!channelId||!z.string().uuid().safeParse(channelId).success)throw new HttpError('Canal inválido.',400);

    const encoder=new TextEncoder();
    let stopped=false;
    let close:()=>void=()=>{};
    const stream=new ReadableStream<Uint8Array>({
      start(controller){
        close=()=>{
          if(stopped)return;
          stopped=true;
          try{controller.close();}catch{}
        };
        request.signal.addEventListener('abort',close,{once:true});

        void (async()=>{
          let previous='';
          let keepaliveAt=Date.now();
          controller.enqueue(encoder.encode('retry: 2500\n\n'));
          while(!stopped){
            const jobs=await listRenderJobs(channelId);
            const signature=JSON.stringify(jobs.map(job=>[
              job.id,job.status,job.progress,job.stage,job.attempts,
              job.outputPath??'',job.outputBytes??0,job.error??'',job.updatedAt
            ]));
            if(signature!==previous){
              previous=signature;
              controller.enqueue(encoder.encode('event: jobs\ndata: '+JSON.stringify({jobs})+'\n\n'));
              keepaliveAt=Date.now();
            }else if(Date.now()-keepaliveAt>=15000){
              controller.enqueue(encoder.encode(': keepalive\n\n'));
              keepaliveAt=Date.now();
            }
            await sleep(1000);
          }
        })().catch(()=>{
          close();
        });
      },
      cancel(){
        stopped=true;
      }
    });

    return new Response(stream,{
      headers:{
        'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-cache, no-transform',
        'Connection':'keep-alive',
        'X-Accel-Buffering':'no'
      }
    });
  }catch(e){return errorResponse(e);}
}

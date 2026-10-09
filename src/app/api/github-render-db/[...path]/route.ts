import { HttpError, errorResponse } from '@/lib/server/auth';
import { requireGithubRenderWorker } from '@/lib/server/github-render-auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const FORWARDED_HEADERS=['content-type','prefer','accept','range','range-unit','if-match','if-none-match'];

async function proxy(request:Request,context:{params:Promise<{path:string[]}>}){
  try{
    await requireGithubRenderWorker(request);
    const {path}=await context.params;
    if(path[0]!=='rest'||path[1]!=='v1')throw new HttpError('GitHub render DB path não permitido.',403);

    const base=(process.env.DATABASE_API_URL||process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.DATABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!base||!key)throw new HttpError('Database proxy indisponível.',503);

    const incoming=new URL(request.url);
    const target=new URL(base+'/'+path.map(encodeURIComponent).join('/'));
    target.search=incoming.search;

    const headers=new Headers();
    headers.set('apikey',key);
    headers.set('authorization','Bearer '+key);
    for(const name of FORWARDED_HEADERS){
      const value=request.headers.get(name);
      if(value)headers.set(name,value);
    }

    const method=request.method.toUpperCase();
    const response=await fetch(target,{
      method,
      headers,
      body:['GET','HEAD'].includes(method)?undefined:await request.arrayBuffer(),
      cache:'no-store'
    });

    const outHeaders=new Headers();
    for(const name of ['content-type','content-range','preference-applied','etag']){
      const value=response.headers.get(name);
      if(value)outHeaders.set(name,value);
    }
    return new Response(response.body,{status:response.status,headers:outHeaders});
  }catch(error){
    return errorResponse(error);
  }
}

export const GET=proxy;
export const POST=proxy;
export const PATCH=proxy;
export const PUT=proxy;
export const DELETE=proxy;

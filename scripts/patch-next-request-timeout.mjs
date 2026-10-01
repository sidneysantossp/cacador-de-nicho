import { readFile, writeFile } from 'node:fs/promises';

const target=new URL('../node_modules/next/dist/server/lib/start-server.js',import.meta.url);
const source=await readFile(target,'utf8');
const marker=`    if (keepAliveTimeout) {
        server.keepAliveTimeout = keepAliveTimeout;
    }`;
const injected=`    const requestTimeout = Number(process.env.CACADORES_HTTP_REQUEST_TIMEOUT_MS || 1800000);
    if (Number.isFinite(requestTimeout) && requestTimeout >= 300000) {
        server.requestTimeout = requestTimeout;
    }
    if (keepAliveTimeout) {
        server.keepAliveTimeout = keepAliveTimeout;
    }`;

if(source.includes('CACADORES_HTTP_REQUEST_TIMEOUT_MS')){
  console.log('Next request timeout patch already applied.');
}else{
  if(!source.includes(marker))throw new Error('Next start-server marker not found; review patch for this Next.js version.');
  await writeFile(target,source.replace(marker,injected),'utf8');
  console.log('Patched Next request timeout for long authenticated media uploads.');
}

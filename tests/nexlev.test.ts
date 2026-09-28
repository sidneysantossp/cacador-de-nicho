import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('NexLev schema stores one encrypted operator OAuth connection',()=>{
  const schema=readFileSync(resolve(process.cwd(),'docs/schema.sql'),'utf8');
  assert.match(schema,/create table if not exists public\.radar_nexlev_connections\(/);
  assert.match(schema,/access_token_ciphertext text not null/);
  assert.match(schema,/refresh_token_ciphertext text/);
  assert.match(schema,/status text not null default 'connected'/);
  assert.match(schema,/radar_nexlev_connections/);
});

test('NexLev OAuth uses PKCE and the official dynamic registration flow',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/nexlev.ts'),'utf8');
  assert.match(source,/\/api\/mcp\/oauth\/authorize/);
  assert.match(source,/\/api\/mcp\/oauth\/token/);
  assert.match(source,/\/api\/mcp\/oauth\/register/);
  assert.match(source,/code_challenge_method','S256'/);
  assert.match(source,/grant_type:'authorization_code'/);
  assert.match(source,/grant_type:'refresh_token'/);
});

test('NexLev callback stores tokens server-side and never returns them to browser',()=>{
  const callback=readFileSync(resolve(process.cwd(),'src/app/api/nexlev-oauth/callback/route.ts'),'utf8');
  const secrets=readFileSync(resolve(process.cwd(),'src/lib/server/nexlev-secrets.ts'),'utf8');
  assert.match(callback,/saveNexLevConnection/);
  assert.match(callback,/nexlev_pkce/);
  assert.match(secrets,/aes-256-gcm/);
  assert.doesNotMatch(callback,/Response\.json\([^)]*access_token/);
});

test('NexLev MCP proxy discovers available tools before invoking a tool',()=>{
  const route=readFileSync(resolve(process.cwd(),'src/app/api/nexlev-mcp/route.ts'),'utf8');
  const server=readFileSync(resolve(process.cwd(),'src/lib/server/nexlev.ts'),'utf8');
  assert.match(route,/listNexLevTools/);
  assert.match(route,/callNexLevTool/);
  assert.match(route,/Ferramenta NexLev não disponível nesta conta/);
  assert.match(server,/tools\/list/);
  assert.match(server,/tools\/call/);
});

test('NexLev operator APIs are agent-accessible but OAuth remains interactive',()=>{
  const auth=readFileSync(resolve(process.cwd(),'src/lib/server/auth.ts'),'utf8');
  assert.match(auth,/\/api\/nexlev-connection/);
  assert.match(auth,/\/api\/nexlev-mcp/);
  assert.doesNotMatch(auth,/\/api\/nexlev-oauth/);
});

test('Settings exposes OAuth connect without asking for a NexLev API key',()=>{
  const ui=readFileSync(resolve(process.cwd(),'src/components/provider-settings.tsx'),'utf8');
  assert.match(ui,/NexLev Intelligence/);
  assert.match(ui,/\/api\/nexlev-oauth\/start/);
  assert.match(ui,/Conectar NexLev/);
  assert.match(ui,/Não é necessário copiar API key/);
});

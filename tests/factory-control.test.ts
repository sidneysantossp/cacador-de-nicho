import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8');

test('Factory Control is exposed in the main operator navigation',()=>{
 const dashboard=read('src/components/dashboard.tsx');
 const workspace=read('src/components/factory-control-workspace.tsx');
 assert.match(dashboard,/id:'factory',label:'Factory Control'/);
 assert.match(dashboard,/FactoryControlWorkspace/);
 assert.match(dashboard,/factory-control:live/);
 assert.match(workspace,/Quem está produzindo o quê/);
 assert.match(workspace,/Status de cada vídeo/);
 assert.match(workspace,/medianViews/);
 assert.match(workspace,/medianCtrPercent/);
 assert.match(workspace,/medianAveragePercentageViewed/);
 assert.match(workspace,/medianRpm/);
});

test('Every AI bootstrap includes agent identity and attribution rules',()=>{
 const start=read('AI_START_HERE.md');
 const os=read('docs/PRODUCTION_OPERATING_SYSTEM.md');
 const agents=read('docs/AGENT_OPERATIONS.md');
 assert.match(start,/docs\/AGENT_OPERATIONS\.md/);
 assert.match(os,/Agent identity and Factory Control/);
 assert.match(agents,/Stable agent identity/);
 assert.match(agents,/radar_episode_agent_attributions/);
 assert.match(agents,/factory-control:live/);
});

test('Agent runtime uses a stable default identity and explicit ownership',()=>{
 const runtime=read('src/lib/server/agent-operations.ts');
 assert.match(runtime,/CACADORES_AGENT_ID/);
 assert.match(runtime,/\|\|'atlas'/);
 assert.match(runtime,/role:'owner'/);
 assert.match(runtime,/reportAgentOperation/);
});

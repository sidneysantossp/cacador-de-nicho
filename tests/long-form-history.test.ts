import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cases=[
  {
    server:'src/lib/server/transcription-engine.ts',
    list:'loadTranscriptHistory',
    version:'loadTranscriptHistoryVersion',
    route:'src/app/api/transcription-engine/route.ts',
    ui:'src/components/transcription-engine-workspace.tsx'
  },
  {
    server:'src/lib/server/scene-timecode.ts',
    list:'loadScenePlanHistory',
    version:'loadScenePlanHistoryVersion',
    route:'src/app/api/scene-timecode/route.ts',
    ui:'src/components/scene-timecode-workspace.tsx'
  },
  {
    server:'src/lib/server/visual-prompt-engine.ts',
    list:'loadVisualPromptSetHistory',
    version:'loadVisualPromptSetHistoryVersion',
    route:'src/app/api/visual-prompt-engine/route.ts',
    ui:'src/components/visual-prompt-engine-workspace.tsx'
  },
  {
    server:'src/lib/server/timeline-engine.ts',
    list:'loadTimelineHistory',
    version:'loadTimelineHistoryVersion',
    route:'src/app/api/timeline-engine/route.ts',
    ui:'src/components/timeline-engine-workspace.tsx'
  }
];

test('long-form history lists stay payload-free and snapshots load lazily',()=>{
  for(const item of cases){
    const server=readFileSync(resolve(process.cwd(),item.server),'utf8');
    const listStart=server.indexOf('export async function '+item.list+'(');
    const versionStart=server.indexOf('export async function '+item.version+'(',listStart);
    const afterVersion=server.indexOf('\nasync function ',versionStart);
    assert.ok(listStart>=0&&versionStart>listStart&&afterVersion>versionStart,item.server);

    const listBlock=server.slice(listStart,versionStart);
    assert.match(listBlock,/select\('version,status,created_at'\)/,item.server);
    assert.doesNotMatch(listBlock,/payload/,item.server);

    const versionBlock=server.slice(versionStart,afterVersion);
    assert.match(versionBlock,/select\('version,status,payload,created_at'\)/,item.server);

    const route=readFileSync(resolve(process.cwd(),item.route),'utf8');
    assert.match(route,/historyVersion/,item.route);
    assert.match(route,new RegExp(item.version),item.route);

    const ui=readFileSync(resolve(process.cwd(),item.ui),'utf8');
    assert.match(ui,/loadHistoryVersion/,item.ui);
    assert.match(ui,/payload carregado somente sob demanda/,item.ui);
  }
});

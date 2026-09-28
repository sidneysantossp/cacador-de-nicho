import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('NexLev evidence packs are durable and channel-scoped',()=>{
  const schema=readFileSync(resolve(process.cwd(),'docs/schema.sql'),'utf8');
  assert.match(schema,/create table if not exists public\.radar_nexlev_evidence_packs\(/);
  assert.match(schema,/channel_id text not null references public\.radar_managed_channels/);
  assert.match(schema,/radar_nexlev_evidence_packs_channel_generated/);
  assert.match(schema,/radar_nexlev_evidence_packs'.*radar_youtube_connections/s);
});

test('NexLev evidence uses bounded discovery calls and persists snapshots',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/nexlev-evidence.ts'),'utf8');
  assert.match(source,/faceless_outliers_videos/);
  assert.match(source,/search_niche_finder_channels/);
  assert.match(source,/limit:8/);
  assert.match(source,/radar_nexlev_evidence_packs/);
  assert.match(source,/NexLev é fonte de descoberta e sinal de mercado/);
});

test('Next Episode Strategist accepts market evidence without weakening auto-accept learning gate',()=>{
  const policy=readFileSync(resolve(process.cwd(),'src/lib/next-episode-policy.ts'),'utf8');
  const autopilot=readFileSync(resolve(process.cwd(),'src/lib/channel-autopilot-policy.ts'),'utf8');
  const strategist=readFileSync(resolve(process.cwd(),'src/lib/server/next-episode.ts'),'utf8');
  assert.match(policy,/type:'market'/);
  assert.match(policy,/marketSignal:marketEvidence\.length\?'nexlev-evidence'/);
  assert.match(strategist,/latestNexLevEvidenceSources/);
  assert.match(autopilot,/no-strong-learning-evidence/);
  assert.match(autopilot,/item\?\.type==='learning'/);
});

test('NexLev evidence distinguishes provider quota from an empty market result',()=>{
  const source=readFileSync(resolve(process.cwd(),'src/lib/server/nexlev-evidence.ts'),'utf8');
  assert.match(source,/value\?\.isError/);
  assert.match(source,/rate limit exceeded/);
  assert.match(source,/não interpretar como ausência de vencedores/);
  assert.match(source,/Falha parcial em/);
});

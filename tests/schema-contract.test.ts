import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Media Intelligence vector schema uses valid dollar quoting and no duplicate similarity function',()=>{
  const sql=readFileSync(resolve(process.cwd(),'docs/schema.sql'),'utf8');
  const start=sql.indexOf('create table if not exists public.radar_owned_media_embeddings(');
  const end=sql.indexOf('create table if not exists public.radar_owned_media_analysis_jobs(',start);
  assert.ok(start>=0&&end>start,'vector schema block missing');
  const block=sql.slice(start,end);

  assert.equal((block.match(/\nas \$\n/g)??[]).length,0);
  assert.equal((block.match(/\nas \$\$\n/g)??[]).length,3);
  assert.equal(
    (block.match(/create or replace function public\.owned_media_embedding_similarity\(/g)??[]).length,
    1
  );
  assert.equal(
    (block.match(/create or replace function public\.owned_media_diversity_metrics\(/g)??[]).length,
    1
  );
});


test('Render-v4 schema persists chapter cache state with bounded status',()=>{
  const sql=readFileSync(resolve(process.cwd(),'docs/schema.sql'),'utf8');
  const start=sql.indexOf('create table if not exists public.radar_render_chapters(');
  const end=sql.indexOf('create table if not exists public.radar_production_quality_reports(',start);
  assert.ok(start>=0&&end>start,'render chapters table missing');
  const block=sql.slice(start,end);
  assert.match(block,/render_job_id uuid not null references public\.radar_render_jobs\(id\) on delete cascade/);
  assert.match(block,/scene_ids uuid\[\] not null default '\{\}'/);
  assert.match(block,/content_hash text not null/);
  assert.match(block,/cache_hit boolean not null default false/);
  assert.match(block,/render_seconds numeric/);
  assert.match(block,/radar_render_chapters_cache/);
});


test('Production QA chapter cache schema is isolated and reusable by content hash',()=>{
  const sql=readFileSync(resolve(process.cwd(),'docs/schema.sql'),'utf8');
  const start=sql.indexOf('create table if not exists public.radar_production_quality_chapters(');
  const end=sql.indexOf('create table if not exists public.radar_production_quality_reports(',start);
  assert.ok(start>=0&&end>start,'production quality chapter cache missing');
  const block=sql.slice(start,end);
  assert.match(block,/id uuid primary key default gen_random_uuid\(\)/);
  assert.match(block,/render_job_id uuid not null references public\.radar_render_jobs\(id\) on delete cascade/);
  assert.match(block,/content_hash text not null/);
  assert.match(block,/technical jsonb not null/);
  assert.match(block,/cache_hit boolean not null default false/);
  assert.match(block,/radar_production_quality_chapters_cache/);
});

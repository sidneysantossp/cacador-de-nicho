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

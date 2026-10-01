import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('Self-hosted runtime extends Node request timeout for large authenticated R2 uploads',()=>{
  const dockerfile=read('Dockerfile');
  const patch=read('scripts/patch-next-request-timeout.mjs');
  assert.match(dockerfile,/node scripts\/patch-next-request-timeout\.mjs/);
  assert.match(dockerfile,/CACADORES_HTTP_REQUEST_TIMEOUT_MS=1800000/);
  assert.match(patch,/server\.requestTimeout = requestTimeout/);
  assert.match(patch,/1800000/);
  assert.match(patch,/Next start-server marker not found/);
});

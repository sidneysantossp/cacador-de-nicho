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


test('external master grants short-lived signed R2 URLs only for operator-prepared jobs',()=>{
  const service=read('src/lib/server/render-engine.ts');
  const route=read('src/app/api/render-engine/route.ts');
  assert.match(service,/signedMediaPutUrl\(videoPath,videoMime,3600\)/);
  assert.match(service,/export async function signExternalMasterUpload\(jobId:string\)/);
  assert.match(service,/row\.status!=='processing'\|\|row\.stage!=='external-upload'/);
  assert.match(route,/requireOperator\(request\)/);
  assert.match(route,/action:z\.literal\('external-sign'\)/);
  assert.match(route,/signExternalMasterUpload\(body\.jobId\)/);
});

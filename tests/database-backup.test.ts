import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('database backup endpoint is agent-scoped and stores only under the dedicated R2 prefix',()=>{
  const auth=read('src/lib/server/auth.ts');
  const helper=read('ops/self-hosted/bin/cacadores-agent-api');
  const route=read('src/app/api/database-backup/route.ts');
  assert.match(auth,/\/api\/database-backup/);
  assert.match(helper,/\/api\/database-backup/);
  assert.match(route,/requireOperator\(request\)/);
  assert.match(route,/backups\/postgres\//);
  assert.match(route,/signedMediaPutUrl/);
  assert.match(route,/mediaIntegrity/);
  assert.match(route,/sha256/);
  assert.match(route,/Backup no R2 não passou na verificação de integridade/);
});

test('database backup host script validates archive, uploads via presigned URL and verifies the R2 object',()=>{
  const file=resolve(process.cwd(),'ops/self-hosted/bin/cacadores-db-backup');
  execFileSync('bash',['-n',file],{stdio:'pipe'});
  const source=read('ops/self-hosted/bin/cacadores-db-backup');
  assert.match(source,/pg_dump/);
  assert.match(source,/pg_restore --list/);
  assert.match(source,/sha256sum/);
  assert.match(source,/\/api\/database-backup/);
  assert.doesNotMatch(source,/x-amz-meta-sha256/);
  assert.match(source,/DB_BACKUP_OK storage=r2/);
  assert.doesNotMatch(source,/SUPABASE_/);
});

test('database backup timer is daily and remains eligible during maintenance holds',()=>{
  const timer=read('ops/self-hosted/systemd/cacadores-db-backup.timer');
  const service=read('ops/self-hosted/systemd/cacadores-db-backup.service');
  const health=read('ops/self-hosted/bin/cacadores-health-watch');
  const promote=read('ops/self-hosted/bin/cacadores-promote');
  assert.match(timer,/OnCalendar=.*05:30:00 UTC/);
  assert.match(timer,/Persistent=true/);
  assert.match(service,/CPUQuota=50%/);
  assert.match(service,/MemoryMax=256M/);
  assert.match(health,/cacadores-db-backup\.timer/);
  assert.match(promote,/cacadores-db-backup\.timer/);
});

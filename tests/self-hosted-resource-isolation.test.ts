import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('background workers prefer the self-hosted database while retaining Supabase fallback compatibility',()=>{
  const owned=read('scripts/owned-media-intelligence-worker.mjs');
  const youtube=read('scripts/youtube-publish-worker.mjs');
  assert.match(owned,/DATABASE_API_URL\|\|process\.env\.SUPABASE_URL/);
  assert.match(owned,/DATABASE_SERVICE_ROLE_KEY\|\|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(owned,/DATABASE_URL\+'\/rest\/v1\/rpc\/'/);
  assert.match(youtube,/DATABASE_API_URL\|\|process\.env\.SUPABASE_URL/);
  assert.match(youtube,/DATABASE_SERVICE_ROLE_KEY\|\|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(youtube,/fetch\(DATABASE_URL\+pathname/);
  assert.match(youtube,/SUPABASE_URL\+'\/storage\/v1\/object\/'/);
});

test('self-hosted worker fleet has both per-container and aggregate cgroup ceilings',()=>{
  const slice=read('ops/self-hosted/systemd/cacadores-workers.slice');
  assert.match(slice,/MemoryMax=1536M/);
  assert.match(slice,/CPUQuota=125%/);
  for(const file of [
    'cacadores-episode-automation-worker-sync',
    'cacadores-owned-visual-worker-sync',
    'cacadores-verified-stock-worker-sync',
    'cacadores-youtube-publish-worker-sync'
  ]){
    const source=read('ops/self-hosted/bin/'+file);
    assert.match(source,/--cgroup-parent=cacadores-workers\.slice/);
    assert.match(source,/--memory /);
    assert.match(source,/--cpus /);
    assert.match(source,/--pids-limit /);
  }
});

test('health watch fails closed under host memory or disk pressure',()=>{
  const health=read('ops/self-hosted/bin/cacadores-health-watch');
  assert.match(health,/cacador-de-nicho-resource-hold\.json/);
  assert.match(health,/MemAvailable/);
  assert.match(health,/MAX_ROOT_DISK_USED_PCT/);
  assert.match(health,/systemctl disable --now "\$UNIT"/);
  assert.match(health,/docker stop -t 20 "\$CONTAINER"/);
  assert.match(health,/requiresReview/);
  assert.match(health,/BACKGROUND_HOLD/);
});

test('promotion preserves background hold and reasserts local data-plane ceilings',()=>{
  const promote=read('ops/self-hosted/bin/cacadores-promote');
  assert.match(promote,/cacador-de-nicho-maintenance-hold/);
  assert.match(promote,/cacador-de-nicho-resource-hold\.json/);
  assert.match(promote,/docker update --memory 768m.*cacadores-postgres/);
  assert.match(promote,/docker update --memory 256m.*cacadores-postgrest/);
  assert.match(promote,/--memory 768m --memory-swap 1g --cpus 0\.75 --pids-limit 256/);
});

test('authenticated dashboard background refresh is visibility-gated and no faster than five minutes',()=>{
  const dashboard=read('src/components/dashboard.tsx');
  assert.match(dashboard,/document\.visibilityState==='visible'/);
  assert.match(dashboard,/300000/);
  assert.doesNotMatch(dashboard,/setInterval\(\(\)=>void refresh\(\),30000\)/);
});


test('production deploy consumes an immutable GitHub-built image instead of building on the VPS',()=>{
  const promote=read('ops/self-hosted/bin/cacadores-promote');
  const workflow=read('.github/workflows/deploy-image.yml');
  assert.doesNotMatch(promote,/docker build/);
  assert.match(promote,/releases\/download\/\$DEPLOY_TAG/);
  assert.match(promote,/sha256sum -c/);
  assert.match(promote,/docker load/);
  assert.match(promote,/MIN_FREE_KB/);
  assert.match(workflow,/docker build --pull=false/);
  assert.match(workflow,/docker save/);
  assert.match(workflow,/gh release create/);
  assert.match(workflow,/sha256sum/);
});

test('auto deploy waits for the GitHub image artifact before recording an attempt',()=>{
  const auto=read('ops/self-hosted/bin/cacadores-auto-deploy');
  const artifactCheck=auto.indexOf('deploy artifact not ready');
  const attemptWrite=auto.indexOf("lastAttemptedSha':sha");
  assert.ok(artifactCheck>=0);
  assert.ok(attemptWrite>artifactCheck);
  assert.match(auto,/curl -fsSIL/);
  assert.match(auto,/releases\/download\/\$DEPLOY_TAG/);
});

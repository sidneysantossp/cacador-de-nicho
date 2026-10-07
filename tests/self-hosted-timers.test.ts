import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const TIMER_FILES=[
  'cacadores-episode-automation-worker-sync.timer',
  'cacadores-owned-visual-worker-sync.timer',
  'cacadores-render-worker-sync.timer',
  'cacadores-verified-stock-worker-sync.timer',
  'cacadores-youtube-publish-worker-sync.timer',
  'cacadores-auto-deploy.timer',
  'cacadores-health-watch.timer'
];

test('recurring self-hosted timers re-arm relative to activation',()=>{
  for(const name of TIMER_FILES){
    const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/systemd',name),'utf8');
    assert.match(source,/^OnActiveSec=/m,name+' must schedule after activation');
    assert.match(source,/^OnUnitActiveSec=/m,name+' must keep recurring after service runs');
    assert.doesNotMatch(source,/^OnBootSec=/m,name+' must not depend on original host boot time');
  }
});

test('promotion rearms enabled timers without restarting its own auto-deploy trigger',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-promote'),'utf8');
  assert.match(source,/systemctl daemon-reload/);
  assert.match(source,/systemctl enable "\$TIMER"/);
  assert.match(source,/if \[\[ "\$TIMER" == "cacadores-auto-deploy\.timer" \]\]; then/);
  assert.match(source,/Never restart the timer that triggered this promotion/);
  assert.match(source,/systemctl restart "\$TIMER"/);
  assert.match(source,/cacadores-youtube-publish-worker-sync\.timer/);
  assert.match(source,/systemctl disable --now "\$TIMER"/);
});


test('health watch rearms timers that are active but elapsed',()=>{
  const source=readFileSync(resolve(process.cwd(),'ops/self-hosted/bin/cacadores-health-watch'),'utf8');
  assert.match(source,/systemctl show "\$UNIT" -p SubState --value/);
  assert.match(source,/== "elapsed"/);
  assert.match(source,/systemctl restart "\$UNIT"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Stock image provider failures are isolated so the fallback chain continues',()=>{
  const router=readFileSync('src/lib/server/source-router.ts','utf8');
  const stock=readFileSync('src/lib/server/stock-media.ts','utf8');

  assert.match(stock,/export function stockProviderSearchShouldTrip/);
  assert.match(router,/stockProviderSearchShouldTrip\(error\)/);
  assert.match(router,/reason:'transient-provider-failure'/);

  const start=router.indexOf("if(action==='stock-image')");
  const end=router.indexOf("if(action==='stock-video')",start);
  assert.ok(start>=0&&end>start,'stock-image route block missing');
  const block=router.slice(start,end);

  assert.match(block,/for\(const provider of STOCK_IMAGE_PROVIDERS\)/);
  assert.match(block,/if\(stockProviderSearchShouldTrip\(error\)\)/);
  assert.match(block,/continue;/);
  assert.match(block,/throw error;/);
});

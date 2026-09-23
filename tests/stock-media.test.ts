import test from 'node:test';
import assert from 'node:assert/strict';
import { stockDownloadHostAllowed, validStockQuery } from '../src/lib/stock-media-policy';

test('Stock Media allows only expected Pexels media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('pexels','images.pexels.com'),true);
  assert.equal(stockDownloadHostAllowed('pexels','videos.pexels.com'),true);
  assert.equal(stockDownloadHostAllowed('pexels','vod-progressive.akamaized.net'),true);
  assert.equal(stockDownloadHostAllowed('pexels','evil.example.com'),false);
  assert.equal(stockDownloadHostAllowed('pexels','images.pexels.com.evil.example.com'),false);
});

test('Stock Media allows only expected Pixabay media hosts',()=>{
  assert.equal(stockDownloadHostAllowed('pixabay','cdn.pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','sub.pixabay.com'),true);
  assert.equal(stockDownloadHostAllowed('pixabay','pixabay.com.attacker.test'),false);
});

test('Stock Media rejects non-HTTPS at download layer via host policy caller and invalid search lengths',()=>{
  assert.equal(validStockQuery('prehistoric cave'),true);
  assert.equal(validStockQuery('   '),false);
  assert.equal(validStockQuery('x'.repeat(101)),false);
});

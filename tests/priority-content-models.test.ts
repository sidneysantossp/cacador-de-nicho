import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIORITY_CONTENT_MODELS, PRIORITY_CONTENT_MODEL_VERSION } from '../src/lib/priority-content-models';

test('priority content model catalog only contains approved 9/10 and 10/10 models',()=>{
  assert.equal(PRIORITY_CONTENT_MODEL_VERSION,'priority-content-models@1.0.0');
  assert.equal(PRIORITY_CONTENT_MODELS.length,6);
  assert.equal(new Set(PRIORITY_CONTENT_MODELS.map(model=>model.id)).size,6);
  assert.equal(PRIORITY_CONTENT_MODELS.filter(model=>model.fitScore===10).length,3);
  assert.equal(PRIORITY_CONTENT_MODELS.filter(model=>model.fitScore===9).length,3);
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.fitScore>=9));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.status==='approved'));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.searchSeeds.length>=3));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.exampleAngles.length>=3));
});

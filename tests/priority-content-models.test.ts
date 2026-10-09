import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIORITY_CONTENT_MODELS, PRIORITY_CONTENT_MODEL_VERSION, inferPriorityContentModel, priorityTextMatchesTerm } from '../src/lib/priority-content-models';

test('priority content model catalog only contains approved 9/10 and 10/10 models',()=>{
  assert.equal(PRIORITY_CONTENT_MODEL_VERSION,'priority-content-models@1.1.0');
  assert.equal(PRIORITY_CONTENT_MODELS.length,6);
  assert.equal(new Set(PRIORITY_CONTENT_MODELS.map(model=>model.id)).size,6);
  assert.equal(PRIORITY_CONTENT_MODELS.filter(model=>model.fitScore===10).length,3);
  assert.equal(PRIORITY_CONTENT_MODELS.filter(model=>model.fitScore===9).length,3);
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.fitScore>=9));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.status==='approved'));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.searchSeeds.length>=3));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.matchTerms.length>=5));
  assert.ok(PRIORITY_CONTENT_MODELS.every(model=>model.exampleAngles.length>=3));
});


test('priority model inference keeps known documentary domains inside the approved catalog',()=>{
  assert.equal(inferPriorityContentModel('urban history and city evolution documentary')?.id,'city-history-evolution');
  assert.equal(inferPriorityContentModel('black hole astronomy cosmology documentary')?.id,'universe-space-astronomy');
  assert.equal(inferPriorityContentModel('roman empire ancient civilization archaeology')?.id,'history-civilizations-empires');
  assert.equal(inferPriorityContentModel('gardening pruning roses summer flowers'),null);
});


test('priority term matching uses word boundaries and simple plural variants',()=>{
  assert.equal(priorityTextMatchesTerm('National Geographic','nation'),false);
  assert.equal(priorityTextMatchesTerm('Why SpaceX Needs Thousands of Satellites','satellite'),true);
  assert.equal(priorityTextMatchesTerm('How Burj Khalifa Pumped Concrete Into the Sky','concrete'),true);
  assert.equal(priorityTextMatchesTerm('Fixed-Camera Timelapse of Paris','fixed camera timelapse'),true);
});


test('priority model inference rejects generic adjacent-channel wording',()=>{
  assert.equal(inferPriorityContentModel('100 Iconic Hollywood Stars Then and Now'),null);
  assert.equal(inferPriorityContentModel('Which Country Food Would You Choose?'),null);
  assert.equal(inferPriorityContentModel('Funny building videos and random river clips'),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedMediaKind, parseOwnedMediaFilename } from '../src/lib/owned-media-policy';

test('Owned Media recognizes supported video and image MIME types',()=>{
  assert.equal(ownedMediaKind('video/mp4'),'video');
  assert.equal(ownedMediaKind('video/quicktime'),'video');
  assert.equal(ownedMediaKind('image/jpeg'),'image');
  assert.equal(ownedMediaKind('application/octet-stream'),null);
});

test('Owned Media derives searchable metadata from the operator filename',()=>{
  const parsed=parseOwnedMediaFilename(
    'las-vegas-strip-at-las-vegas-in-nevada-united-states-2026-09-18-07-40-55-utc (1).mp4'
  );
  assert.equal(parsed.title,'Las Vegas Strip At Las Vegas In Nevada United States');
  assert.ok(parsed.tags.includes('las vegas'));
  assert.ok(parsed.tags.includes('vegas strip'));
  assert.ok(parsed.semantic.locations.includes('las vegas'));
  assert.ok(parsed.semantic.locations.includes('nevada united states'));
});

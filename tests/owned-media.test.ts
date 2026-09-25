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


test('Media Taxonomy classifies geography scene time and viewpoint from filename',()=>{
  const parsed=parseOwnedMediaFilename(
    'las-vegas-traffic-night-street-level-static-nevada.mp4'
  );
  assert.ok(parsed.semantic.countries.includes('united states'));
  assert.ok(parsed.semantic.regions.includes('nevada'));
  assert.ok(parsed.semantic.cities.includes('las vegas'));
  assert.ok(parsed.semantic.scenes.includes('traffic'));
  assert.ok(parsed.semantic.timeOfDay.includes('night'));
  assert.ok(parsed.semantic.shotTypes.includes('street-level'));
  assert.ok(parsed.semantic.cameraMotion.includes('static'));
});

test('Media Taxonomy recognizes international city and lifestyle facets',()=>{
  const parsed=parseOwnedMediaFilename(
    'paris-france-cafe-pedestrians-morning-rain-wide-shot.mp4'
  );
  assert.ok(parsed.semantic.countries.includes('france'));
  assert.ok(parsed.semantic.cities.includes('paris'));
  assert.ok(parsed.semantic.scenes.includes('cafes'));
  assert.ok(parsed.semantic.scenes.includes('pedestrians'));
  assert.ok(parsed.semantic.people.includes('pedestrians'));
  assert.ok(parsed.semantic.timeOfDay.includes('morning'));
  assert.ok(parsed.semantic.weather.includes('rain'));
  assert.ok(parsed.semantic.shotTypes.includes('wide'));
});

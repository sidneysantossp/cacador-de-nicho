import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnedMediaDuplicateName, ownedMediaDuplicateNameKey, ownedMediaKind, ownedMediaSearchText, parseOwnedMediaFilename } from '../src/lib/owned-media-policy';
import { scoreVisualIntent, visualSemanticSearchText } from '../src/lib/media-library-policy';

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


test('Owned Media duplicate normalization ignores browser copy suffixes',()=>{
  assert.equal(
    normalizeOwnedMediaDuplicateName('realistic-new-york-city-flag-waving.mov'),
    normalizeOwnedMediaDuplicateName('realistic-new-york-city-flag-waving (1).mov')
  );
  assert.equal(
    ownedMediaDuplicateNameKey('clip-copy-2.mp4',533303357),
    ownedMediaDuplicateNameKey('clip.mp4',533303357)
  );
});

test('Owned Media duplicate key keeps genuinely different filenames distinct',()=>{
  assert.notEqual(
    ownedMediaDuplicateNameKey('new-york-skyline-day.mp4',1000),
    ownedMediaDuplicateNameKey('new-york-skyline-night.mp4',1000)
  );
  assert.notEqual(
    ownedMediaDuplicateNameKey('same-name.mp4',1000),
    ownedMediaDuplicateNameKey('same-name.mp4',1001)
  );
});


test('Owned Media semantic index can exclude the literal filename after visual analysis',()=>{
  const parsed=parseOwnedMediaFilename('bryant-park-new-york.mp4');
  const text=ownedMediaSearchText({
    title:'New York Public Library — Library — Daytime',
    originalName:'bryant-park-new-york.mp4',
    tags:['new york public library','library','daytime'],
    semantic:{
      ...parsed.semantic,
      landmarks:['new york public library'],
      scenes:['library'],
      locations:['new york city','new york public library']
    },
    includeOriginalName:false
  });
  assert.ok(text.includes('new york public library'));
  assert.ok(!text.includes('bryant-park-new-york.mp4'));
});


test('Library First requires visual intent beyond geographic context',()=>{
  const flagSemantic={
    subjects:['flag'],locations:[],landmarks:[],activities:['waving'],objects:['flag'],
    environments:[],timeOfDay:[],weather:[],shotTypes:['close-up','vertical framing'],
    cameraMotion:['static'],moods:['patriotic'],visualStyle:['cinematic lighting'],periods:[]
  };
  const score=scoreVisualIntent(
    'las vegas city skyline nightlife',
    visualSemanticSearchText(flagSemantic),
    'united states nevada las vegas'
  );
  assert.equal(score.hasVisualIntent,true);
  assert.equal(score.visualRelevance,0);
  assert.ok(score.contextRelevance>0);
});

test('Library First separates city context from supported skyline evidence',()=>{
  const skylineSemantic={
    subjects:['skyscrapers'],locations:[],landmarks:[],activities:[],objects:['buildings'],
    environments:['skyline','cityscape'],timeOfDay:['daytime'],weather:['clear'],shotTypes:['wide shot'],
    cameraMotion:['static'],moods:['urban'],visualStyle:['real-life footage'],periods:[]
  };
  const score=scoreVisualIntent(
    'new york skyline skyscrapers',
    visualSemanticSearchText(skylineSemantic),
    'united states new york new york city manhattan'
  );
  assert.equal(score.hasVisualIntent,true);
  assert.ok(score.visualRelevance>.5);
  assert.ok(score.contextRelevance>0);
});


test('Library First rejects one-cue partial matches for compound visual intent',()=>{
  const skylineDay={
    subjects:['skyline'],locations:[],landmarks:[],activities:[],objects:['buildings'],
    environments:['skyline'],timeOfDay:['daytime'],weather:['clear'],shotTypes:['wide shot'],
    cameraMotion:['static'],moods:['urban'],visualStyle:['realistic'],periods:[]
  };
  const score=scoreVisualIntent(
    'new york sunset skyline lights',
    visualSemanticSearchText(skylineDay),
    'united states new york new york city'
  );
  assert.equal(score.intentTokenCount,3);
  assert.equal(score.matchedIntentTokens,1);
  assert.ok(score.visualCoverage<.40);
});

test('Library First accepts compound intent when multiple visual cues are present',()=>{
  const skylineNight={
    subjects:['skyline'],locations:[],landmarks:[],activities:[],objects:['buildings','city lights'],
    environments:['skyline','cityscape'],timeOfDay:['sunset'],weather:['clear'],shotTypes:['wide shot'],
    cameraMotion:['static'],moods:['urban'],visualStyle:['realistic'],periods:[]
  };
  const score=scoreVisualIntent(
    'new york sunset skyline lights',
    visualSemanticSearchText(skylineNight),
    'united states new york new york city'
  );
  assert.equal(score.intentTokenCount,3);
  assert.equal(score.matchedIntentTokens,3);
  assert.equal(score.visualCoverage,1);
});

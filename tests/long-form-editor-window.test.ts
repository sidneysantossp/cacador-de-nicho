import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLongFormEditorWindows, timedContentDuration, timedEntriesInWindow
} from '../src/lib/long-form-editor-window';

test('60-minute editor is divided into six bounded 10-minute windows',()=>{
  const windows=buildLongFormEditorWindows(60*60);
  assert.equal(windows.length,6);
  assert.deepEqual(
    windows.map(item=>[item.startSeconds,item.endSeconds]),
    [[0,600],[600,1200],[1200,1800],[1800,2400],[2400,3000],[3000,3600]]
  );
  assert.ok(windows.every(item=>item.durationSeconds<=600));
});

test('timed entries belong to exactly one window and preserve master indexes',()=>{
  const items=[
    {id:'a',startSeconds:0,endSeconds:10},
    {id:'b',startSeconds:599.9,endSeconds:605},
    {id:'c',startSeconds:600,endSeconds:610},
    {id:'d',startSeconds:1200,endSeconds:1210}
  ];
  const windows=buildLongFormEditorWindows(1800);
  const entries=windows.flatMap(window=>timedEntriesInWindow(items,window));
  assert.deepEqual(entries.map(entry=>entry.item.id),['a','b','c','d']);
  assert.deepEqual(entries.map(entry=>entry.index),[0,1,2,3]);
  assert.deepEqual(
    timedEntriesInWindow(items,windows[1]).map(entry=>entry.item.id),
    ['c']
  );
});

test('timed duration uses the furthest end time',()=>{
  assert.equal(timedContentDuration([
    {startSeconds:0,endSeconds:4},
    {startSeconds:10,endSeconds:null},
    {startSeconds:9,endSeconds:12.5}
  ]),12.5);
});

test('upstream long-form editors render only active-window collections',()=>{
  const root=process.cwd();
  const transcript=readFileSync(resolve(root,'src/components/transcription-engine-workspace.tsx'),'utf8');
  const scene=readFileSync(resolve(root,'src/components/scene-timecode-workspace.tsx'),'utf8');
  const visual=readFileSync(resolve(root,'src/components/visual-prompt-engine-workspace.tsx'),'utf8');

  assert.match(transcript,/visibleSegments\.map/);
  assert.match(transcript,/visibleWords\.map/);
  assert.doesNotMatch(transcript,/draft\.segments\.map\(\(segment,index\)=>/);
  assert.doesNotMatch(transcript,/draft\.words\.map\(word=>/);

  assert.match(scene,/visibleScenes\.map/);
  assert.doesNotMatch(scene,/draft\.scenes\.map\(\(scene,index\)=>/);

  assert.match(visual,/visiblePrompts\.map/);
  assert.doesNotMatch(visual,/draft\.scenePrompts\.map\(\(scene,index\)=>/);

  for(const source of [transcript,scene,visual]){
    assert.match(source,/long-form-window-nav/);
    assert.match(source,/buildLongFormEditorWindows/);
  }
});

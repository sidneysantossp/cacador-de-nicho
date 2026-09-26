import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=process.cwd();

test('Long-form list views are security-invoker and never expose payload',()=>{
  const sql=readFileSync(resolve(root,'docs/schema.sql'),'utf8');
  for(const view of [
    'radar_transcript_list',
    'radar_scene_plan_list',
    'radar_visual_prompt_set_list',
    'radar_timeline_list',
    'radar_video_edit_list'
  ]){
    const marker='create or replace view public.'+view;
    const start=sql.indexOf(marker);
    assert.ok(start>=0,view+' view missing');
    const end=sql.indexOf('create or replace view public.',start+marker.length);
    const grant=sql.indexOf('revoke all on table',start);
    const block=sql.slice(start,Math.min(...[end,grant].filter(value=>value>start)));
    assert.match(block,/with \(security_invoker=true\)/,view+' must use caller security');
    assert.doesNotMatch(block,/select[\s\S]*\bpayload\s*(,|from)/i,view+' must not project full payload');
  }
});

test('Long-form list server queries use summary views without payload',()=>{
  const cases:Array<[string,string]>= [
    ['src/lib/server/transcription-engine.ts','radar_transcript_list'],
    ['src/lib/server/scene-timecode.ts','radar_scene_plan_list'],
    ['src/lib/server/visual-prompt-engine.ts','radar_visual_prompt_set_list'],
    ['src/lib/server/timeline-engine.ts','radar_timeline_list'],
    ['src/lib/server/video-editor.ts','radar_video_edit_list']
  ];
  for(const [file,view] of cases){
    const source=readFileSync(resolve(root,file),'utf8');
    const start=source.indexOf("from('"+view+"')");
    assert.ok(start>=0,file+' must query '+view);
    const selectStart=source.indexOf('.select(',start);
    const selectEnd=source.indexOf(')',selectStart);
    const selection=source.slice(selectStart,selectEnd+1);
    assert.doesNotMatch(selection,/payload/,file+' summary query must not request payload');
  }
});

test('List summary views retain the card metrics required by long-form workspaces',()=>{
  const sql=readFileSync(resolve(root,'docs/schema.sql'),'utf8');
  for(const field of [
    'segment_count','scene_count','scene_prompt_count','character_reference_count',
    'visual_clip_count','placeholder_count','clip_style_count','caption_count','overlay_count'
  ]){
    assert.match(sql,new RegExp('\\b'+field+'\\b'),field+' summary metric missing');
  }
});

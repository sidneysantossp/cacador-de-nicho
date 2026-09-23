import test from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodeScriptPayload } from '../src/lib/types';
import {
  combineScriptSections, countScriptWords, estimateScriptMinutes,
  normalizeScriptPayload, scriptApprovalIssues
} from '../src/lib/script-policy';
import { episodeScriptPayloadSchema } from '../src/lib/server/validation';

const now='2026-09-23T18:30:00.000Z';
const payload:EpisodeScriptPayload={
  kind:'episode-script',
  id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
  episodeId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  contentProjectId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  title:'How Grug Makes Rocks Grow',
  language:'English',
  sections:[
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',label:'Hook',purpose:'Open the contradiction.',content:'Grug saved rocks. Grug still poor.'},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',label:'Body',purpose:'Introduce productive assets.',content:'Then Grug notices one cave makes more rocks.'}
  ],
  content:'placeholder',
  wordCount:1,
  estimatedMinutes:null,
  continuityNotes:['Continue from the saving lesson.'],
  factCheckWarnings:[],
  provenance:{generatedBy:'operator'},
  createdAt:now,
  updatedAt:now
};

test('Script policy combines editable sections into continuous narration',()=>{
  assert.equal(
    combineScriptSections(payload.sections),
    'Grug saved rocks. Grug still poor.\n\nThen Grug notices one cave makes more rocks.'
  );
});

test('Script policy counts words and estimates duration from channel pace',()=>{
  assert.equal(countScriptWords('one two three four'),4);
  assert.equal(estimateScriptMinutes(300,150),2);
  assert.equal(estimateScriptMinutes(300,null),null);
});

test('Script normalization rebuilds content from sections',()=>{
  const normalized=normalizeScriptPayload(payload,120);
  assert.match(normalized.content,/Grug saved rocks/);
  assert.equal(normalized.wordCount,15);
  assert.equal(normalized.estimatedMinutes,0.13);
});

test('Script approval blocks fact-check warnings and verify markers',()=>{
  assert.deepEqual(scriptApprovalIssues({...payload,content:'Clean narration.',factCheckWarnings:[]}),[]);
  assert.deepEqual(
    scriptApprovalIssues({...payload,content:'This claim is [VERIFY].',factCheckWarnings:['Needs source']}),
    ['fact-check-warnings','verify-markers']
  );
});

test('Episode script schema accepts a normalized script payload',()=>{
  const normalized=normalizeScriptPayload(payload,120);
  const parsed=episodeScriptPayloadSchema.parse(normalized);
  assert.equal(parsed.sections.length,2);
  assert.equal(parsed.title,'How Grug Makes Rocks Grow');
});

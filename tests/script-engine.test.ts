import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContentFactCheck, EpisodeScriptPayload } from '../src/lib/types';
import {
  combineScriptSections, countScriptWords, documentaryScriptClaimIssues, estimateScriptMinutes,
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
  assert.equal(normalized.wordCount,14);
  assert.equal(normalized.estimatedMinutes,0.12);
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


const historicalClaimId='11111111-2222-4333-8444-555555555555';

function historicalClaim(overrides:Partial<ContentFactCheck>={}):ContentFactCheck{
  return {
    id:historicalClaimId,
    claim:'The documented event occurred in 1925.',
    status:'supported',
    claimType:'fact',
    narrationRule:'assert',
    sourceIds:['66666666-7777-4888-8999-aaaaaaaaaaaa'],
    notes:'Archive record.',
    ...overrides
  };
}

function documentaryScript(content:string,claimIds:string[]=[]):EpisodeScriptPayload{
  return normalizeScriptPayload({
    ...payload,
    sections:[{
      id:'12121212-3434-4567-8899-121212121212',
      label:'History',
      purpose:'State the historical point.',
      content,
      claimIds
    }],
    content,
    factCheckWarnings:[]
  },120);
}

test('Documentary script accepts a supported fact linked to the section',()=>{
  const script=documentaryScript('The archive records the event in 1925.',[historicalClaimId]);
  assert.deepEqual(documentaryScriptClaimIssues({
    payload:script,claims:[historicalClaim()],documentaryMode:true
  }),[]);
});

test('Documentary estimate must use uncertainty language',()=>{
  const claim=historicalClaim({
    claim:'The crowd contained 5,000 people.',
    claimType:'estimate',
    narrationRule:'qualify'
  });
  const certain=documentaryScript('The crowd contained 5,000 people.',[historicalClaimId]);
  assert.ok(documentaryScriptClaimIssues({
    payload:certain,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId));

  const qualified=documentaryScript('The crowd contained approximately 5,000 people.',[historicalClaimId]);
  assert.equal(documentaryScriptClaimIssues({
    payload:qualified,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId),false);
});

test('Documentary allegation must be attributed in narration',()=>{
  const claim=historicalClaim({
    claim:'An official was accused of hiding records.',
    claimType:'allegation',
    narrationRule:'attribute'
  });
  const direct=documentaryScript('An official hid the records in 1925.',[historicalClaimId]);
  assert.ok(documentaryScriptClaimIssues({
    payload:direct,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId));

  const attributed=documentaryScript('According to the archival report, an official allegedly hid the records in 1925.',[historicalClaimId]);
  assert.equal(documentaryScriptClaimIssues({
    payload:attributed,claims:[claim],documentaryMode:true
  }).includes('documentary-uncertainty-language-missing:'+historicalClaimId),false);
});

test('Documentary script blocks numeric assertions without a claim link',()=>{
  const script=documentaryScript('The tunnel collapsed in 1925.',[]);
  const issues=documentaryScriptClaimIssues({
    payload:script,claims:[historicalClaim()],documentaryMode:true
  });
  assert.ok(issues.some(issue=>issue.startsWith('documentary-unlinked-factual-section:')));
  assert.ok(issues.includes('documentary-script-without-claim-links'));
});

test('Documentary script blocks unknown and excluded claim links',()=>{
  const unknown='99999999-8888-4777-8666-555555555555';
  const unknownIssues=documentaryScriptClaimIssues({
    payload:documentaryScript('The archive records the event in 1925.',[unknown]),
    claims:[historicalClaim()],
    documentaryMode:true
  });
  assert.ok(unknownIssues.includes('documentary-unknown-claim:'+unknown));

  const excluded=historicalClaim({narrationRule:'exclude'});
  const excludedIssues=documentaryScriptClaimIssues({
    payload:documentaryScript('The archive records the event in 1925.',[historicalClaimId]),
    claims:[excluded],
    documentaryMode:true
  });
  assert.ok(excludedIssues.includes('documentary-excluded-claim-used:'+historicalClaimId));
});

test('Episode script schema accepts section-level claim provenance',()=>{
  const value=documentaryScript('The archive records the event in 1925.',[historicalClaimId]);
  const parsed=episodeScriptPayloadSchema.parse(value);
  assert.deepEqual(parsed.sections[0].claimIds,[historicalClaimId]);
});

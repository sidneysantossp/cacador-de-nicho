import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Operator Analysis exposes all four assisted-manual import surfaces',()=>{
  const route=readFileSync('src/app/api/operator-analysis/route.ts','utf8');
  assert.match(route,/kind==='channel-study'/);
  assert.match(route,/kind==='opportunity-report'/);
  assert.match(route,/kind==='universe-dna'/);
  assert.match(route,/kind==='universe-market'/);
  assert.match(route,/import-channel-study/);
  assert.match(route,/import-opportunity-report/);
  assert.match(route,/import-universe-dna/);
  assert.match(route,/import-universe-market/);
});

test('Analysis schemas are exported for operator validation',()=>{
  const ai=readFileSync('src/lib/server/ai.ts','utf8');
  assert.match(ai,/export const channelNicheProfileSchema=z\.object/);
  assert.match(ai,/export const channelStudyAnatomySchema=z\.object/);
  assert.match(ai,/export const channelThumbnailAnalysisSchema=z\.object/);
  assert.match(ai,/export const opportunityReportBodySchema=z\.object/);
  assert.match(ai,/export const universeChannelDnaSchema=z\.object/);
  assert.match(ai,/export const universeCurvesGapsSchema=z\.object/);
});

test('Operator imports keep structural calculations on the server',()=>{
  const opportunity=readFileSync('src/lib/server/opportunity-report.ts','utf8');
  const universe=readFileSync('src/lib/server/universe.ts','utf8');
  assert.match(opportunity,/classification=independentCreators>=3\?'structural':independentCreators>=2\?'emerging':'hypothesis'/);
  assert.match(universe,/universeCurveClassification\(support\)/);
  assert.match(universe,/universeGapDemandStatus\(curve\.classification,targetIds\)/);
  assert.match(universe,/resolveUniverseGapEvidence/);
});

test('Provider AI entry points are opt-in only',()=>{
  const files=[
    'src/app/api/actions/route.ts',
    'src/app/api/next-episode/route.ts',
    'src/app/api/script-engine/route.ts',
    'src/app/api/visual-prompt-engine/route.ts',
    'src/app/api/audience-intelligence/route.ts',
    'src/lib/server/jobs.ts',
    'src/lib/server/next-episode.ts',
    'src/lib/server/episode-script.ts',
    'src/lib/server/visual-prompt-engine.ts',
    'src/lib/server/audience-intelligence.ts',
    'src/lib/server/channel-study.ts',
    'src/lib/server/opportunity-report.ts',
    'src/lib/server/universe.ts'
  ];
  for(const file of files){
    const source=readFileSync(file,'utf8');
    assert.match(source,/CACADORES_AI_AUTORUN/,'missing provider AI gate in '+file);
  }
});

test('Operator Analysis is exposed through the scoped host-side agent channel',()=>{
  const helper=readFileSync('ops/self-hosted/bin/cacadores-agent-api','utf8');
  const auth=readFileSync('src/lib/server/auth.ts','utf8');
  assert.match(helper,/\/api\/operator-analysis/);
  assert.match(auth,/\/api\/operator-analysis/);
});

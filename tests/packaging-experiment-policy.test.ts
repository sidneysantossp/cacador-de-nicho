import test from 'node:test';
import assert from 'node:assert/strict';
import {createPackagingExperiment,recordPackagingSnapshot,packagingDiagnosis,packagingLearning} from '../src/lib/packaging-experiment-policy';
const base={channelId:'8c42ff90-41c9-477a-9ef4-6bb3359b7685',
 youtubeChannelId:'UCRBCnTUJ_ow5dXxENuNkdHA',videoId:'IQTbwGiTQpA',
 kind:'thumbnail' as const,baseline:{title:'Starlink no Brasil',thumbnailRef:'sha256:baseline'},
 candidate:{thumbnailRef:'sha256:candidate'},
 hypothesis:'Melhorar entendimento da conexão direta no celular'};
const snapshot={recordedAt:'2026-11-02T23:00:00Z',startDate:'2026-10-31',endDate:'2026-11-01',
 source:'studio-manual' as const,impressions:21300,ctrPercent:7.8,views:6404,engagedViews:null,
 watchTimeMinutes:null,averageViewDurationSeconds:null,notes:'Captura no Studio',artifactRef:'screenshot:local-20261102'};
test('creates thumbnail-only experiments with known video and explicit hypothesis',()=>{
 const e=createPackagingExperiment(base);
 assert.equal(e.phase,'draft');assert.equal(e.snapshots.length,0);
 assert.throws(()=>createPackagingExperiment({...base,candidate:{thumbnailRef:'candidate',title:'Changed'}}),/THUMBNAIL_ONLY/);
});
test('refuses to pronounce a low CTR without eligible source and sample',()=>{
 const e=createPackagingExperiment(base);
 assert.equal(packagingDiagnosis(e).decision,'no-ctr-evidence');
 const withData=recordPackagingSnapshot(e,snapshot);
 assert.equal(packagingDiagnosis(withData).decision,'traffic-mix-not-comparable');
 assert.equal(packagingDiagnosis(withData).canDeclareCausalWinner,false);
});
test('requires provenance for Studio manual entries, matching impressions, and no duplicate windows',()=>{
 const e=createPackagingExperiment(base);
 assert.throws(()=>recordPackagingSnapshot(e,{...snapshot,artifactRef:undefined}),/MANUAL_EVIDENCE_REQUIRED/);
 assert.throws(()=>recordPackagingSnapshot(e,{...snapshot,impressions:null}),/CTR_REQUIRES_IMPRESSIONS/);
 const v=recordPackagingSnapshot(e,snapshot);
 assert.throws(()=>recordPackagingSnapshot(v,snapshot),/DUPLICATE_SNAPSHOT/);
});
test('sequential pre/post does not assert winner even if CTR rises',()=>{
 const e=createPackagingExperiment(base);
 const first=recordPackagingSnapshot(e,snapshot);
 const second=recordPackagingSnapshot(first,{...snapshot,recordedAt:'2026-11-06T23:00:00Z',startDate:'2026-11-04',endDate:'2026-11-05',
 ctrPercent:12,impressions:33000,source:'youtube-reporting-api',artifactRef:'report:1'});
 assert.equal(packagingDiagnosis(second).canDeclareCausalWinner,false);
 assert.equal(packagingDiagnosis(second).decision,'observational-only');
});
test('only documented native A/B results create learning for next episode',()=>{
 const e=createPackagingExperiment(base);
 assert.throws(()=>packagingLearning(e),/NO_NATIVE_AB_EVIDENCE/);
 assert.throws(()=>packagingLearning({...e,nativeResult:'inconclusive',nativeReportRef:'studio:test-13'}),/NO_DEMONSTRATED_WINNER/);
 const l=packagingLearning({...e,nativeResult:'winner-candidate',nativeReportRef:'studio:test-13'});
 assert.equal(l.type,'editorial');assert.equal(l.confidence,'medium');
 assert.ok(l.evidence.some(s=>s.includes('YouTube Studio')));
});

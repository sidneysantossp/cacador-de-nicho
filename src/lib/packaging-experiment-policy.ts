import {randomUUID} from 'node:crypto';

export type PackagingKind='thumbnail'|'title';
export type PackagingEvidenceSource='youtube-studio-ab'|'youtube-reporting-api'|'studio-manual'|'vidiq-analytics';
export type PackagingPhase='draft'|'ready-for-approval'|'running'|'evaluated'|'learned'|'inconclusive';
export type PackagingSnapshot={
 recordedAt:string;startDate:string;endDate:string;source:PackagingEvidenceSource;
 impressions:number|null;ctrPercent:number|null;views:number|null;engagedViews:number|null;
 watchTimeMinutes:number|null;averageViewDurationSeconds:number|null;
 trafficSource?:string;notes:string;artifactRef?:string;
};
export type PackagingExperiment={
 id:string;channelId:string;youtubeChannelId:string;videoId:string;kind:PackagingKind;phase:PackagingPhase;
 baseline:{title:string;thumbnailRef:string};candidate:{title?:string;thumbnailRef?:string};
 hypothesis:string;createdAt:string;revision:number;snapshots:PackagingSnapshot[];
 nativeResult?:'winner-baseline'|'winner-candidate'|'performed-same'|'inconclusive';
 nativeReportRef?:string;decision?:string;learningId?:string;updatedAt:string;
};
const videoPattern=/^[A-Za-z0-9_-]{11}$/;
const channelPattern=/^UC[A-Za-z0-9_-]{22}$/;
const nonNegative=(x:number|null)=>x===null||(Number.isFinite(x)&&x>=0);
export function validateSnapshot(s:PackagingSnapshot){
 if(!['youtube-studio-ab','youtube-reporting-api','studio-manual','vidiq-analytics'].includes(s.source))
  throw Error('PACKAGING_UNKNOWN_METRIC_SOURCE');
 if(!Number.isFinite(Date.parse(s.recordedAt))||!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(s.endDate)||s.startDate>s.endDate)
  throw Error('PACKAGING_INVALID_METRIC_PERIOD');
 if(![s.impressions,s.views,s.engagedViews,s.watchTimeMinutes,s.averageViewDurationSeconds].every(nonNegative)||
  s.ctrPercent!==null&&(!Number.isFinite(s.ctrPercent)||s.ctrPercent<0||s.ctrPercent>100))
  throw Error('PACKAGING_INVALID_METRIC');
 if(s.ctrPercent!==null&&s.impressions===null)throw Error('PACKAGING_CTR_REQUIRES_IMPRESSIONS');
 if(s.source==='studio-manual'&&!s.artifactRef)throw Error('PACKAGING_MANUAL_EVIDENCE_REQUIRED');
 if(s.notes.length>2000)throw Error('PACKAGING_NOTES_TOO_LONG');
 return s;
}
export function createPackagingExperiment(args:{
 channelId:string;youtubeChannelId:string;videoId:string;kind:PackagingKind;
 baseline:{title:string;thumbnailRef:string};candidate:{title?:string;thumbnailRef?:string};hypothesis:string;
},now=new Date().toISOString()):PackagingExperiment{
 if(!/^[0-9a-f-]{36}$/i.test(args.channelId)||!channelPattern.test(args.youtubeChannelId)||
 !videoPattern.test(args.videoId)||!['thumbnail','title'].includes(args.kind))throw Error('PACKAGING_INVALID_TARGET');
 if(!args.baseline.title.trim()||!args.baseline.thumbnailRef.trim()||args.hypothesis.trim().length<12)
  throw Error('PACKAGING_MISSING_BASELINE_OR_HYPOTHESIS');
 if(args.kind==='thumbnail'&&(!args.candidate.thumbnailRef||args.candidate.title&&args.candidate.title!==args.baseline.title))
  throw Error('PACKAGING_THUMBNAIL_ONLY');
 if(args.kind==='title'&&(!args.candidate.title||args.candidate.thumbnailRef&&args.candidate.thumbnailRef!==args.baseline.thumbnailRef))
  throw Error('PACKAGING_TITLE_ONLY');
 return {id:randomUUID(),channelId:args.channelId,youtubeChannelId:args.youtubeChannelId,videoId:args.videoId,kind:args.kind,
  phase:'draft',baseline:args.baseline,candidate:args.candidate,hypothesis:args.hypothesis.trim(),createdAt:now,updatedAt:now,revision:1,snapshots:[]};
}
export function recordPackagingSnapshot(experiment:PackagingExperiment,raw:PackagingSnapshot,now=new Date().toISOString()){
 const snapshot=validateSnapshot(raw);
 if(experiment.snapshots.some(x=>x.source===snapshot.source&&x.startDate===snapshot.startDate&&x.endDate===snapshot.endDate&&x.trafficSource===snapshot.trafficSource))
  throw Error('PACKAGING_DUPLICATE_SNAPSHOT_PERIOD');
 if(experiment.phase==='learned')throw Error('PACKAGING_ALREADY_LEARNED');
 return {...experiment,snapshots:[...experiment.snapshots,snapshot],revision:experiment.revision+1,updatedAt:now};
}
export function packagingDiagnosis(experiment:PackagingExperiment){
 const latest=experiment.snapshots.at(-1);
 const observations=experiment.snapshots.filter(s=>s.impressions!==null&&s.ctrPercent!==null);
 const insufficient=observations.length===0;
 const comparables=observations.length>1&&observations.every(s=>s.trafficSource===observations[0].trafficSource);
 const totalImpressions=observations.reduce((sum,s)=>sum+(s.impressions||0),0);
 const decision=experiment.nativeResult==='winner-candidate'?'native-candidate-won':
  experiment.nativeResult==='winner-baseline'?'native-baseline-won':
  experiment.nativeResult==='performed-same'?'native-equivalent':
  experiment.nativeResult==='inconclusive'?'native-inconclusive':
  insufficient?'no-ctr-evidence':totalImpressions<1000?'low-sample':
  comparables?'observational-only':'traffic-mix-not-comparable';
 return {
   decision,canDeclareCausalWinner:decision==='native-candidate-won'||decision==='native-baseline-won',
   nextAction:experiment.nativeResult==='winner-candidate'?'document-learning':
    experiment.nativeResult==='winner-baseline'?'restore-baseline':
    experiment.nativeResult?'review-inconclusive':
    insufficient?'collect-ctr-from-reporting-or-studio':
    totalImpressions<1000?'collect-more-data':'prepare-native-ab-test',
   summary:latest?{lastObservedAt:latest.recordedAt,latestImpressions:latest.impressions,lastCtrPercent:latest.ctrPercent}:null,
   caveat:'Sequential before/after snapshots cannot prove title or thumbnail caused a change. YouTube native concurrent A/B test is preferred.'
 };
}
export function packagingLearning(experiment:PackagingExperiment,now=new Date().toISOString()){
 if(!experiment.nativeResult||!experiment.nativeReportRef)
  throw Error('PACKAGING_NO_NATIVE_AB_EVIDENCE');
 if(experiment.nativeResult==='inconclusive'||experiment.nativeResult==='performed-same')
  throw Error('PACKAGING_NO_DEMONSTRATED_WINNER');
 const winner=experiment.nativeResult==='winner-candidate'?'candidate':'baseline';
 return {
 id:'packaging:'+experiment.id,type:'editorial' as const,
 statement:('Teste A/B nativo do YouTube sobre '+experiment.kind+' do vídeo '+experiment.videoId+
 ': vencedor '+winner+'. Aplicar como referência contextual, não como garantia para o próximo vídeo.').slice(0,1200),
 evidence:[
  'Canal '+experiment.youtubeChannelId+', vídeo '+experiment.videoId,
  'Fonte: YouTube Studio A/B, relatório '+experiment.nativeReportRef,
  'Hipótese: '+experiment.hypothesis,
  'Variação testada: '+JSON.stringify(experiment.candidate).slice(0,250),
  'Resultado: '+experiment.nativeResult,
  'Não generalizar além do tema, público e janela observados.'
 ].map(s=>s.slice(0,600)),
 confidence:'medium' as const,createdAt:now
 };
}

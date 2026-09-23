import type {
  ChannelBrainLearning, ChannelBrainPayload, PerformanceReport
} from '@/lib/types';

function learningId(reportId:string,diagnosisId:string){
  return 'performance:'+reportId+':'+diagnosisId;
}

export function performanceLearningCandidates(report:PerformanceReport):ChannelBrainLearning[]{
  if(report.status!=='approved')return [];
  return report.diagnoses.map(diagnosis=>({
    id:learningId(report.id,diagnosis.id),
    type:'performance' as const,
    statement:('Hipótese de performance ('+diagnosis.area+'): '+diagnosis.hypothesis).slice(0,1200),
    evidence:[
      ...diagnosis.evidence,
      'Explicação concorrente: '+diagnosis.competingExplanation,
      'Próximo teste: '+diagnosis.nextTest,
      ...report.limitations.slice(0,3).map(item=>'Limitação do report: '+item)
    ].slice(0,30).map(item=>item.slice(0,600)),
    confidence:diagnosis.confidence,
    createdAt:report.updatedAt
  }));
}

export function performanceReportApplied(brain:ChannelBrainPayload|null,reportId:string){
  if(!brain)return false;
  const prefix='performance:'+reportId+':';
  return brain.learnings.some(item=>item.id.startsWith(prefix));
}

export function mergePerformanceReportIntoBrain(
  brain:ChannelBrainPayload,
  report:PerformanceReport
){
  const candidates=performanceLearningCandidates(report);
  const existing=new Set(brain.learnings.map(item=>item.id));
  const added=candidates.filter(item=>!existing.has(item.id));
  if(!added.length)return {brain,added:[] as ChannelBrainLearning[]};

  const merged:ChannelBrainPayload={
    ...brain,
    learnings:[...brain.learnings,...added],
    updatedAt:new Date().toISOString()
  };
  return {brain:merged,added};
}

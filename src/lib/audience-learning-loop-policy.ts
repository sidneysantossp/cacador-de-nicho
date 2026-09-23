import type {
  AudienceIntelligenceReport, ChannelBrainLearning, ChannelBrainPayload
} from '@/lib/types';

function learningId(reportId:string,themeId:string){
  return 'audience:'+reportId+':'+themeId;
}

export function audienceLearningCandidates(
  report:AudienceIntelligenceReport
):ChannelBrainLearning[]{
  if(report.status!=='approved')return [];
  return report.themes
    .filter(theme=>theme.confidence==='medium'||theme.confidence==='high')
    .map(theme=>({
      id:learningId(report.id,theme.id),
      type:'audience' as const,
      statement:('Sinal de audiência ('+theme.kind+'): '+theme.insight).slice(0,1200),
      evidence:[
        'Tema suportado por '+theme.commentRefs.length+' de '+report.sampleSize+
          ' comentários da amostra ('+theme.sampleSharePercent.toFixed(1)+'%).',
        'Referências internas da amostra: '+theme.commentRefs.join(', ')+'.',
        'Próximo teste editorial: '+theme.nextAction,
        ...report.limitations.slice(0,2).map(item=>'Limitação da amostra: '+item)
      ].slice(0,30).map(item=>item.slice(0,600)),
      confidence:theme.confidence,
      createdAt:report.updatedAt
    }));
}

export function audienceReportApplied(
  brain:ChannelBrainPayload|null,
  reportId:string
){
  if(!brain)return false;
  const prefix='audience:'+reportId+':';
  return brain.learnings.some(item=>item.id.startsWith(prefix));
}

export function mergeAudienceReportIntoBrain(
  brain:ChannelBrainPayload,
  report:AudienceIntelligenceReport
){
  const candidates=audienceLearningCandidates(report);
  const existing=new Set(brain.learnings.map(item=>item.id));
  const added=candidates.filter(item=>!existing.has(item.id));
  if(!added.length)return {brain,added:[] as ChannelBrainLearning[]};

  return {
    brain:{
      ...brain,
      learnings:[...brain.learnings,...added],
      updatedAt:new Date().toISOString()
    },
    added
  };
}

import type {
  PerformanceDiagnosis, PerformanceMetricComparison, PerformanceMetricKey,
  PerformanceObservation, PerformanceReportPayload, PerformanceRetentionEvent
} from '@/lib/types';

export const performanceMetricKeys:PerformanceMetricKey[]=[
  'views','impressions','ctrPercent','retentionFirstSecondsPercent','retention30Percent',
  'averageViewDurationSeconds','averagePercentageViewed','watchTimeMinutes','likes',
  'commentCount','shares','subscribersGained','subscribersLost','conversions','revenue','rpm'
];

function finite(value:unknown):value is number{
  return typeof value==='number'&&Number.isFinite(value);
}

function median(values:number[]){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

function comparison(
  observation:PerformanceObservation,
  history:PerformanceObservation[],
  metric:PerformanceMetricKey
):PerformanceMetricComparison{
  const current=finite(observation.metrics[metric])?observation.metrics[metric]!:null;
  const expected=finite(observation.expectations[metric])?observation.expectations[metric]!:null;
  const historical=history
    .map(item=>item.metrics[metric])
    .filter(finite);

  let baseline:number|null=null;
  let baselineSource:PerformanceMetricComparison['baselineSource']='none';
  let baselineSampleSize=0;

  if(expected!==null){
    baseline=expected;
    baselineSource='operator-expectation';
    baselineSampleSize=1;
  }else if(historical.length>=3){
    baseline=median(historical);
    baselineSource='channel-median';
    baselineSampleSize=historical.length;
  }

  if(current===null||baseline===null){
    return {
      metric,current,baseline,delta:null,deltaPercent:null,
      relation:'unavailable',baselineSource,baselineSampleSize
    };
  }

  const delta=current-baseline;
  const deltaPercent=baseline===0?null:delta/Math.abs(baseline)*100;
  const relation=Math.abs(delta)<1e-9?'equal':delta>0?'above':'below';
  return {
    metric,current,baseline,delta,deltaPercent,
    relation,baselineSource,baselineSampleSize
  };
}

export function buildPerformanceComparisons(
  observation:PerformanceObservation,
  priorObservations:PerformanceObservation[]
){
  return performanceMetricKeys.map(metric=>comparison(observation,priorObservations,metric));
}

export function retentionEvents(
  curve:PerformanceObservation['retentionCurve'],
  limitPerType=3
):PerformanceRetentionEvent[]{
  const points=[...curve]
    .filter(point=>finite(point.second)&&finite(point.audiencePercent))
    .sort((a,b)=>a.second-b.second);
  const events:PerformanceRetentionEvent[]=[];
  for(let i=1;i<points.length;i++){
    const previous=points[i-1],current=points[i];
    if(current.second<=previous.second)continue;
    const delta=current.audiencePercent-previous.audiencePercent;
    if(Math.abs(delta)<1e-9)continue;
    events.push({
      type:delta<0?'drop':'peak',
      fromSecond:previous.second,
      toSecond:current.second,
      deltaPercentPoints:delta,
      fromAudiencePercent:previous.audiencePercent,
      toAudiencePercent:current.audiencePercent
    });
  }
  const drops=events.filter(event=>event.type==='drop')
    .sort((a,b)=>a.deltaPercentPoints-b.deltaPercentPoints)
    .slice(0,limitPerType);
  const peaks=events.filter(event=>event.type==='peak')
    .sort((a,b)=>b.deltaPercentPoints-a.deltaPercentPoints)
    .slice(0,limitPerType);
  return [...drops,...peaks].sort((a,b)=>a.fromSecond-b.fromSecond);
}

function cmp(map:Map<PerformanceMetricKey,PerformanceMetricComparison>,key:PerformanceMetricKey){
  return map.get(key)!;
}

function hasBaseline(value:PerformanceMetricComparison){
  return value.current!==null&&value.baseline!==null&&value.relation!=='unavailable';
}

function evidenceLine(value:PerformanceMetricComparison,label:string){
  if(value.current===null||value.baseline===null)return label+': sem referência suficiente.';
  const source=value.baselineSource==='operator-expectation'?'expectativa informada':'mediana histórica do canal';
  return label+': '+value.current.toFixed(2)+' vs '+source+' '+value.baseline.toFixed(2)+'.';
}

function diagnosis(
  code:PerformanceDiagnosis['code'],
  area:PerformanceDiagnosis['area'],
  evidence:string[],
  hypothesis:string,
  competingExplanation:string,
  nextTest:string,
  confidence:PerformanceDiagnosis['confidence']='medium'
):PerformanceDiagnosis{
  return {
    id:crypto.randomUUID(),code,area,evidence,hypothesis,competingExplanation,nextTest,confidence
  };
}

export function deterministicPerformanceDiagnoses(
  observation:PerformanceObservation,
  comparisons:PerformanceMetricComparison[],
  events:PerformanceRetentionEvent[]
):PerformanceDiagnosis[]{
  const map=new Map(comparisons.map(item=>[item.metric,item]));
  const ctr=cmp(map,'ctrPercent');
  const r30=cmp(map,'retention30Percent');
  const rFirst=cmp(map,'retentionFirstSecondsPercent');
  const comments=cmp(map,'commentCount');
  const conversions=cmp(map,'conversions');
  const result:PerformanceDiagnosis[]=[];

  if(hasBaseline(ctr)&&hasBaseline(r30)){
    if(ctr.relation==='below'&&(r30.relation==='above'||r30.relation==='equal')){
      result.push(diagnosis(
        'packaging-underperforming-content-holding','packaging',
        [evidenceLine(ctr,'CTR'),evidenceLine(r30,'Retenção aos 30s')],
        'O conteúdo pode estar sustentando atenção melhor do que a embalagem está convertendo impressões em cliques.',
        'A distribuição pode ter alcançado uma audiência menos alinhada, reduzindo CTR sem que título ou thumbnail sejam a causa principal.',
        'Testar uma única mudança de embalagem — título OU thumbnail — mantendo o conteúdo e a promessa central constantes.'
      ));
    }else if((ctr.relation==='above'||ctr.relation==='equal')&&r30.relation==='below'){
      result.push(diagnosis(
        'promise-attracts-delivery-loses','hook',
        [evidenceLine(ctr,'CTR'),evidenceLine(r30,'Retenção aos 30s')],
        'A promessa pode estar atraindo o clique, mas o início ou a entrega inicial pode não sustentar a expectativa criada.',
        'Uma origem de tráfego diferente pode trazer espectadores com intenção distinta, afetando retenção sem representar falha do hook.',
        'Testar apenas o início do próximo vídeo: reduzir contexto inicial ou antecipar a primeira entrega prometida.'
      ));
    }else if(ctr.relation==='below'&&r30.relation==='below'){
      result.push(diagnosis(
        'topic-package-hook-all-under-pressure','topic',
        [evidenceLine(ctr,'CTR'),evidenceLine(r30,'Retenção aos 30s')],
        'Tema, promessa, embalagem ou adequação ao público podem estar sob pressão simultaneamente.',
        'Uma mudança de distribuição ou um vídeo atípico pode derrubar as duas métricas sem invalidar o formato.',
        'Separar variáveis: primeiro testar embalagem em um conceito comparável; só depois alterar tema ou estrutura.'
      ));
    }
  }

  const maxSecond=Math.max(0,...observation.retentionCurve.map(point=>point.second));
  const midDrops=events.filter(event=>
    event.type==='drop'&&event.fromSecond>=30&&
    (maxSecond<=0||event.fromSecond<=maxSecond*.8)
  );
  if(hasBaseline(rFirst)&&(rFirst.relation==='above'||rFirst.relation==='equal')&&midDrops.length){
    const drop=[...midDrops].sort((a,b)=>a.deltaPercentPoints-b.deltaPercentPoints)[0];
    result.push(diagnosis(
      'mid-video-drop','mid-video',
      [
        evidenceLine(rFirst,'Retenção inicial'),
        'Maior queda intermediária observada: '+drop.deltaPercentPoints.toFixed(2)+' p.p. entre '+drop.fromSecond.toFixed(1)+'s e '+drop.toSecond.toFixed(1)+'s.'
      ],
      'A abertura pode estar funcionando, enquanto um trecho intermediário pode concentrar repetição, contexto excessivo, transição fraca ou ausência de nova tensão.',
      'A queda pode coincidir com mudança natural de audiência, capítulo, inserção externa ou comportamento específico da fonte de tráfego.',
      'Revisar o trecho correspondente sem reescrever o vídeo inteiro e testar uma única correção estrutural no próximo episódio.'
    ));
  }

  if(hasBaseline(comments)&&hasBaseline(conversions)&&
    (comments.relation==='above'||comments.relation==='equal')&&conversions.relation==='below'){
    result.push(diagnosis(
      'interest-with-low-conversion','cta',
      [evidenceLine(comments,'Comentários'),evidenceLine(conversions,'Conversões')],
      'Existe sinal de interesse/interação, mas a proposta de próximo passo pode não estar convertendo na mesma proporção.',
      'Comentários podem refletir debate ou curiosidade sem intenção de conversão; a oferta também pode não ser relevante para essa audiência.',
      'Testar um CTA mais específico e alinhado ao estágio do espectador, sem alterar simultaneamente conteúdo, oferta e posicionamento.'
    ));
  }

  return result;
}

function trafficSummary(observation:PerformanceObservation){
  const rows=observation.trafficSources.filter(item=>item.views>=0);
  const total=rows.reduce((sum,item)=>sum+item.views,0);
  return [...rows]
    .sort((a,b)=>b.views-a.views)
    .map(item=>({
      source:item.source,
      views:item.views,
      viewSharePercent:total>0?item.views/total*100:null
    }));
}

export function buildPerformanceReport(
  observation:PerformanceObservation,
  priorObservations:PerformanceObservation[]
):PerformanceReportPayload{
  const now=new Date().toISOString();
  const comparisons=buildPerformanceComparisons(observation,priorObservations);
  const events=retentionEvents(observation.retentionCurve);
  const diagnoses=deterministicPerformanceDiagnoses(observation,comparisons,events);

  const comparable=comparisons.filter(item=>item.deltaPercent!==null);
  const strongest=[...comparable]
    .filter(item=>item.deltaPercent!>0)
    .sort((a,b)=>b.deltaPercent!-a.deltaPercent!)
    .slice(0,3)
    .map(item=>item.metric+' acima da referência em '+item.deltaPercent!.toFixed(1)+'%.');
  const weakest=[...comparable]
    .filter(item=>item.deltaPercent!<0)
    .sort((a,b)=>a.deltaPercent!-b.deltaPercent!)
    .slice(0,3)
    .map(item=>item.metric+' abaixo da referência em '+Math.abs(item.deltaPercent!).toFixed(1)+'%.');

  const limitations:string[]=[];
  const withBaseline=comparisons.filter(hasBaseline).length;
  if(withBaseline===0)limitations.push('Sem expectativas explícitas ou pelo menos 3 observações históricas por métrica; não foi possível classificar desempenho relativo.');
  if(observation.retentionCurve.length<2)limitations.push('Curva de retenção insuficiente para localizar quedas e picos.');
  if(!observation.comments.length)limitations.push('Nenhuma amostra de comentários foi fornecida; temas qualitativos não podem ser avaliados.');
  if(!finite(observation.metrics.conversions))limitations.push('Conversões não foram fornecidas.');
  if(priorObservations.length<3)limitations.push('Histórico do canal ainda é curto; qualquer padrão deve ser tratado como hipótese.');

  return {
    kind:'performance-report',
    id:crypto.randomUUID(),
    channelId:observation.channelId,
    episodeId:observation.episodeId,
    observationId:observation.id,
    observedAt:observation.observedAt,
    comparisons,
    retentionEvents:events,
    trafficSummary:trafficSummary(observation),
    commentSummary:{
      sampledComments:observation.comments.length,
      totalLikesInSample:observation.comments.reduce((sum,item)=>sum+(item.likes??0),0)
    },
    diagnoses,
    strongestSignals:strongest,
    weakestSignals:weakest,
    limitations,
    handoff:{
      nextAgent:'Learning Loop',
      question:'Qual parte é evidência repetível e qual pode ser acaso?',
      candidateHypothesisIds:diagnoses.map(item=>item.id)
    },
    review:{notes:''},
    createdAt:now,
    updatedAt:now
  };
}

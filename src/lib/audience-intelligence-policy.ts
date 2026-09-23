import type {
  AudienceCommentClassification, AudienceIntent, AudienceSentiment, AudienceTheme,
  PerformanceObservation
} from '@/lib/types';

export type AudienceCommentSample = {
  ref:string;
  text:string;
  likes:number;
};

export type AudienceModelResult = {
  classifications:Array<{
    commentRef:string;
    sentiment:AudienceSentiment;
    intents:AudienceIntent[];
  }>;
  themes:Array<{
    kind:AudienceIntent;
    label:string;
    insight:string;
    commentRefs:string[];
    nextAction:string;
  }>;
};

export function buildAudienceCommentSample(
  observation:PerformanceObservation,
  maxComments=50
):AudienceCommentSample[]{
  return observation.comments
    .slice(0,Math.max(1,Math.min(maxComments,80)))
    .map((comment,index)=>({
      ref:'c'+(index+1),
      text:comment.text.replace(/\s+/g,' ').trim().slice(0,1200),
      likes:Math.max(0,Number(comment.likes??0))
    }))
    .filter(item=>item.text);
}

function unique<T>(values:T[]){return [...new Set(values)];}

function themeConfidence(refCount:number,sampleSize:number):AudienceTheme['confidence']{
  const share=sampleSize>0?refCount/sampleSize*100:0;
  if(sampleSize>=10&&refCount>=5&&share>=10)return 'high';
  if(refCount>=3)return 'medium';
  return 'low';
}

export function compileAudienceModelResult(
  sample:AudienceCommentSample[],
  model:AudienceModelResult
){
  const known=new Map(sample.map(item=>[item.ref,item]));
  const seen=new Set<string>();
  const classifications:AudienceCommentClassification[]=[];

  for(const item of model.classifications){
    if(!known.has(item.commentRef)){
      throw new Error('Audience model referenced unknown comment: '+item.commentRef);
    }
    if(seen.has(item.commentRef)){
      throw new Error('Audience model classified comment more than once: '+item.commentRef);
    }
    seen.add(item.commentRef);
    classifications.push({
      commentRef:item.commentRef,
      sentiment:item.sentiment,
      intents:unique(item.intents).slice(0,4)
    });
  }

  const themes:AudienceTheme[]=[];
  for(const raw of model.themes){
    const refs=unique(raw.commentRefs);
    for(const ref of refs){
      if(!known.has(ref))throw new Error('Audience theme referenced unknown comment: '+ref);
    }
    if(!refs.length)continue;
    const share=sample.length?refs.length/sample.length*100:0;
    themes.push({
      id:crypto.randomUUID(),
      kind:raw.kind,
      label:raw.label.trim().slice(0,180),
      insight:raw.insight.trim().slice(0,2000),
      commentRefs:refs.slice(0,30),
      nextAction:raw.nextAction.trim().slice(0,2000),
      confidence:themeConfidence(refs.length,sample.length),
      sampleSharePercent:Math.round(share*10)/10,
      totalLikesInEvidence:refs.reduce((sum,ref)=>sum+(known.get(ref)?.likes??0),0)
    });
  }

  const sentimentSampleCounts:Record<AudienceSentiment,number>={
    positive:0,neutral:0,negative:0,mixed:0
  };
  for(const item of classifications)sentimentSampleCounts[item.sentiment]++;

  const limitations=[
    'A amostra de comentários é parcial e pode estar ordenada por relevância; ela não representa toda a audiência do vídeo.',
    'Percentuais e contagens deste report descrevem somente a amostra analisada, não a audiência total.'
  ];
  if(classifications.length<sample.length){
    limitations.push(
      'O classificador cobriu '+classifications.length+' de '+sample.length+
      ' comentários da amostra; os demais não entram nas contagens de sentimento.'
    );
  }
  if(sample.length<10){
    limitations.push('A amostra tem menos de 10 comentários; todos os padrões devem ser tratados como sinais preliminares.');
  }

  return {
    classifications,
    themes,
    sentimentSampleCounts,
    analyzedCommentRefs:classifications.map(item=>item.commentRef),
    limitations
  };
}

export function audienceThemeEvidence(
  theme:AudienceTheme,
  sample:AudienceCommentSample[]
){
  const byRef=new Map(sample.map(item=>[item.ref,item]));
  return theme.commentRefs
    .map(ref=>({ref,...byRef.get(ref)}))
    .filter((item):item is {ref:string;text:string;likes:number}=>Boolean(item.text));
}

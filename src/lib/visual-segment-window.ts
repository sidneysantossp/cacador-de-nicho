export type ExcludedSourceRange={
  startSeconds:number;
  endSeconds:number;
};

export type RankedVisualSegment<T extends {startSeconds:number;endSeconds:number}>={
  segment:T;
  relevance:number;
  score:number;
};

function overlapRatio(
  start:number,
  end:number,
  excluded:ExcludedSourceRange
){
  const excludedStart=Number(excluded.startSeconds);
  const excludedEnd=Number(excluded.endSeconds);
  if(
    !Number.isFinite(excludedStart)||
    !Number.isFinite(excludedEnd)||
    excludedEnd-excludedStart<.20
  )return 0;
  const overlap=Math.max(0,Math.min(end,excludedEnd)-Math.max(start,excludedStart));
  const smaller=Math.min(end-start,excludedEnd-excludedStart);
  return smaller>0?overlap/smaller:0;
}

export function selectVisualSegmentWindow<
  T extends {startSeconds:number;endSeconds:number}
>(input:{
  ranked:RankedVisualSegment<T>[];
  desiredDurationSeconds:number;
  excludedSourceRanges?:ExcludedSourceRange[];
  maxOverlapRatio?:number;
}){
  const desired=Math.max(.25,Number(input.desiredDurationSeconds)||.25);
  const excluded=(input.excludedSourceRanges??[]).filter(range=>
    Number.isFinite(range.startSeconds)&&
    Number.isFinite(range.endSeconds)&&
    range.endSeconds-range.startSeconds>=.20
  );
  const maxOverlap=Math.max(0,Math.min(1,input.maxOverlapRatio??.25));

  for(const item of [...input.ranked].sort((a,b)=>b.score-a.score)){
    if(item.relevance<.08)continue;
    const segmentStart=Number(item.segment.startSeconds);
    const segmentEnd=Number(item.segment.endSeconds);
    if(
      !Number.isFinite(segmentStart)||
      !Number.isFinite(segmentEnd)||
      segmentEnd-segmentStart<.25
    )continue;

    if(!excluded.length){
      return {
        ...item,
        sourceStartSeconds:segmentStart,
        sourceEndSeconds:Math.min(segmentEnd,segmentStart+desired)
      };
    }

    // When avoiding already-used microcuts, require a nearly full requested
    // window so Timeline fitting cannot silently expand back into excluded time.
    if(segmentEnd-segmentStart<desired-.05)continue;

    const latestStart=Math.max(segmentStart,segmentEnd-desired);
    const starts=[
      segmentStart,
      latestStart,
      ...excluded.flatMap(range=>[
        range.endSeconds,
        range.startSeconds-desired
      ])
    ]
      .map(value=>Math.max(segmentStart,Math.min(latestStart,Number(value))))
      .filter(Number.isFinite);

    const uniqueStarts=[...new Set(starts.map(value=>Math.round(value*1000)/1000))];
    for(const sourceStartSeconds of uniqueStarts){
      const sourceEndSeconds=Math.min(segmentEnd,sourceStartSeconds+desired);
      if(sourceEndSeconds-sourceStartSeconds<desired-.05)continue;
      const blocked=excluded.some(range=>
        overlapRatio(sourceStartSeconds,sourceEndSeconds,range)>maxOverlap
      );
      if(blocked)continue;
      return {
        ...item,
        sourceStartSeconds,
        sourceEndSeconds
      };
    }
  }

  return null;
}

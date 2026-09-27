import type { RenderJob, RenderPreset } from '@/lib/types';

export type RenderCapacityMode='cold'|'cached';

export type RenderCapacityProfile={
  preset:RenderPreset;
  mode:RenderCapacityMode;
  sampleCount:number;
  medianRealTimeFactor:number;
  minRealTimeFactor:number;
  maxRealTimeFactor:number;
};

export type RenderCapacityForecast={
  durationMinutes:number;
  singleJobMinutes:number;
  fleetVideosPerDay:number;
};

function median(values:number[]){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2
    ?sorted[middle]
    :(sorted[middle-1]+sorted[middle])/2;
}

function finitePositive(value:unknown){
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

export function renderCapacityProfiles(jobs:RenderJob[]):RenderCapacityProfile[]{
  const buckets=new Map<string,{preset:RenderPreset;mode:RenderCapacityMode;values:number[]}>();
  for(const job of jobs){
    if(job.status!=='completed'||job.payload.compilerVersion!=='render-v4')continue;
    const metrics=job.payload.metrics;
    if(!metrics)continue;
    const rtf=finitePositive(metrics.realTimeFactor);
    if(rtf===null)continue;
    const preset=job.payload.preset??'source';
    let mode:RenderCapacityMode|null=null;
    if(metrics.renderedChapters>0&&metrics.cacheHits===0)mode='cold';
    if(metrics.renderedChapters===0&&metrics.cacheHits>0)mode='cached';
    if(!mode)continue;
    const key=preset+':'+mode;
    const bucket=buckets.get(key)??{preset,mode,values:[]};
    bucket.values.push(rtf);
    buckets.set(key,bucket);
  }
  return [...buckets.values()].map(bucket=>({
    preset:bucket.preset,
    mode:bucket.mode,
    sampleCount:bucket.values.length,
    medianRealTimeFactor:median(bucket.values)!,
    minRealTimeFactor:Math.min(...bucket.values),
    maxRealTimeFactor:Math.max(...bucket.values)
  })).sort((a,b)=>a.preset.localeCompare(b.preset)||a.mode.localeCompare(b.mode));
}

export function renderCapacityForecast(input:{
  profile:RenderCapacityProfile;
  durationsMinutes:number[];
  onlineWorkers:number;
}):RenderCapacityForecast[]{
  const workers=Math.max(0,Math.floor(input.onlineWorkers));
  return input.durationsMinutes
    .filter(value=>Number.isFinite(value)&&value>0)
    .map(durationMinutes=>{
      const singleJobMinutes=durationMinutes*input.profile.medianRealTimeFactor;
      return {
        durationMinutes,
        singleJobMinutes,
        fleetVideosPerDay:workers>0
          ?workers*1440/singleJobMinutes
          :0
      };
    });
}

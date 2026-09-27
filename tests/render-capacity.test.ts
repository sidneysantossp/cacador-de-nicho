import test from 'node:test';
import assert from 'node:assert/strict';
import type { RenderJob } from '../src/lib/types';
import { renderCapacityForecast, renderCapacityProfiles } from '../src/lib/render-capacity-policy';

function job(input:{
  id:string;
  preset:'source'|'hd-1080p30'|'draft-720p30';
  rtf:number;
  cacheHits:number;
  renderedChapters:number;
}):RenderJob{
  return {
    id:input.id,
    channelId:'29383ee5-36cf-4f02-b64e-67371c9e076d',
    episodeId:'22222222-2222-4222-8222-222222222222',
    videoEditId:'88888888-8888-4888-8888-888888888888',
    videoEditVersion:1,
    status:'completed',
    progress:100,
    stage:'completed',
    attempts:1,
    payload:{
      preset:input.preset,
      videoCodec:'libx264',
      fallbackVideoCodecs:['mpeg4'],
      crf:20,
      audioCodec:'aac',
      audioBitrateKbps:192,
      outputFormat:{width:1920,height:1080,fps:30},
      compilerVersion:'render-v4',
      requestedBy:'operator',
      metrics:{
        wallSeconds:input.rtf*60,
        finishedMinutes:1,
        secondsPerFinishedMinute:input.rtf*60,
        realTimeFactor:input.rtf,
        cacheHits:input.cacheHits,
        renderedChapters:input.renderedChapters
      },
      manifest:{
        videoEditId:'88888888-8888-4888-8888-888888888888',
        videoEditVersion:1,
        timelineId:'11111111-1111-4111-8111-111111111111',
        timelineVersion:1,
        transcriptId:'77777777-7777-4777-8777-777777777777',
        transcriptVersion:1,
        format:{width:1920,height:1080,fps:30,aspectRatio:'16:9'},
        durationSeconds:60,
        visualClips:[],
        voice:{assetId:'55555555-5555-4555-8555-555555555555',storagePath:'voice.mp3',mimeType:'audio/mpeg'},
        music:null,
        sfxEvents:[],
        captions:{
          enabled:false,position:'bottom',fontSize:52,maxLines:2,backgroundOpacity:.35,
          styleDescription:'',style:{
            fontFamily:'DejaVu Sans',fontWeight:800,primaryColor:'#fff',highlightColor:'#fff',
            outlineColor:'#000',outlineWidth:2,uppercase:false,maxWordsPerLine:6,
            smartBreaks:true,highlightMode:'none',safeMarginPercent:6
          },cues:[]
        },
        overlays:[],
        audioMix:{voiceVolume:1,musicVolume:.2,sfxVolume:.7,normalizeVoice:true,duckMusicUnderVoice:true}
      }
    },
    createdAt:'2026-09-27T00:00:00.000Z',
    completedAt:'2026-09-27T00:01:00.000Z',
    updatedAt:'2026-09-27T00:01:00.000Z'
  };
}

test('Render capacity separates cold jobs from fully cached revisions',()=>{
  const profiles=renderCapacityProfiles([
    job({id:'1',preset:'hd-1080p30',rtf:7.4,cacheHits:0,renderedChapters:1}),
    job({id:'2',preset:'hd-1080p30',rtf:.3,cacheHits:1,renderedChapters:0}),
    job({id:'3',preset:'hd-1080p30',rtf:4,cacheHits:1,renderedChapters:1})
  ]);
  const cold=profiles.find(item=>item.preset==='hd-1080p30'&&item.mode==='cold');
  const cached=profiles.find(item=>item.preset==='hd-1080p30'&&item.mode==='cached');
  assert.equal(cold?.sampleCount,1);
  assert.equal(cold?.medianRealTimeFactor,7.4);
  assert.equal(cached?.sampleCount,1);
  assert.equal(cached?.medianRealTimeFactor,.3);
  assert.equal(profiles.length,2,'mixed cache/render jobs are intentionally excluded');
});

test('Render capacity uses median RTF instead of an outlier-sensitive mean',()=>{
  const profiles=renderCapacityProfiles([
    job({id:'1',preset:'draft-720p30',rtf:2,cacheHits:0,renderedChapters:1}),
    job({id:'2',preset:'draft-720p30',rtf:2.5,cacheHits:0,renderedChapters:1}),
    job({id:'3',preset:'draft-720p30',rtf:20,cacheHits:0,renderedChapters:1})
  ]);
  const profile=profiles[0];
  assert.equal(profile.medianRealTimeFactor,2.5);
  assert.equal(profile.minRealTimeFactor,2);
  assert.equal(profile.maxRealTimeFactor,20);
});

test('Capacity forecast separates one-job latency from fleet throughput',()=>{
  const profile={
    preset:'hd-1080p30' as const,
    mode:'cold' as const,
    sampleCount:2,
    medianRealTimeFactor:5,
    minRealTimeFactor:4,
    maxRealTimeFactor:6
  };
  const rows=renderCapacityForecast({
    profile,
    durationsMinutes:[20,60],
    onlineWorkers:4
  });
  assert.equal(rows[0].singleJobMinutes,100);
  assert.equal(rows[1].singleJobMinutes,300);
  assert.equal(rows[1].fleetVideosPerDay,19.2);
});

test('Capacity forecast returns zero throughput when no render node is online',()=>{
  const profile={
    preset:'source' as const,
    mode:'cold' as const,
    sampleCount:1,
    medianRealTimeFactor:3,
    minRealTimeFactor:3,
    maxRealTimeFactor:3
  };
  const [row]=renderCapacityForecast({profile,durationsMinutes:[60],onlineWorkers:0});
  assert.equal(row.singleJobMinutes,180);
  assert.equal(row.fleetVideosPerDay,0);
});

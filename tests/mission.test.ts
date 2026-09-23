import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMissionCandidates, productionReadiness } from '../src/lib/mission';
import type { Channel, OpportunityReport } from '../src/lib/types';

function report(overrides:Partial<OpportunityReport>={}):OpportunityReport{
  return {
    kind:'opportunity-report',
    id:'opportunity-report:c1',
    channelStudyId:'channel-study:c1',
    sourceChannelId:'c1',
    title:'Validated Curve',
    thesis:'A repeatable curve.',
    curve:{
      thesis:'Known subject → uncommon angle → payoff',
      subject:'Subject',
      promise:'Promise',
      angle:'Angle',
      narrativeMechanism:'Mechanism',
      visualMechanism:'Visual',
      emotionalDriver:'Curiosity',
      repeatabilityEvidence:['Multiple hits'],
      failureConditions:[]
    },
    validation:{
      classification:'structural',
      independentCreators:3,
      supportingVideos:12,
      evidence:['Three creators'],
      counterEvidence:[],
      limitations:[]
    },
    saturation:{level:'medium',rationale:'Room remains.',saturatedPatterns:[],underusedAngles:[],whitespace:['Gap']},
    viralDNA:{
      demand:{level:'high',rationale:'Repeated reach.'},
      repeatability:{level:'high',rationale:'Multiple hits.'},
      breakout:{level:'high',rationale:'Small-channel breakouts.'},
      saturation:{level:'medium',rationale:'Not crowded.'},
      gap:{level:'high',rationale:'Clear whitespace.'}
    },
    evidence:{topVideos:[],similarChannels:[]},
    transfers:[],
    channelConcept:{
      nameDirections:['Concept'],
      positioning:'Positioning',
      audience:'Audience',
      promise:'Promise',
      format:'Long form',
      thumbnailSystem:'System',
      productionModel:'Model',
      firstEpisodes:['Episode 1','Episode 2','Episode 3','Episode 4','Episode 5','Episode 6','Episode 7','Episode 8','Episode 9','Episode 10'],
      testPlan:['Pilot']
    },
    nextMove:'Produce pilot.',
    limitations:[],
    createdAt:'2026-09-22T12:00:00Z',
    ...overrides
  };
}

function channel(id:string,views:number,subscribers:number|null,ageHours:number):Channel{
  const observed='2026-09-22T12:00:00Z';
  return {
    id,
    name:id,
    handle:'@'+id,
    niche:'Test',
    language:'en-US',
    country:'US',
    format:'Long form',
    description:'',
    lens:'',
    thumbnail:'',
    url:'https://youtube.com/channel/'+id,
    createdAt:'2026-08-01T12:00:00Z',
    firstSeenAt:observed,
    observedAt:observed,
    videoCount:8,
    subscribers,
    video:{
      id:'v-'+id,
      title:'Video',
      publishedAt:new Date(Date.parse(observed)-ageHours*3600000).toISOString(),
      views,
      duration:'PT8M',
      thumbnail:'',
      url:'https://youtube.com/watch?v=v-'+id
    },
    status:'new',
    evidence:[],
    discoverySource:'reference-adjacent'
  };
}

test('Mission Control only marks structurally validated opportunities as production ready',()=>{
  assert.equal(productionReadiness(report()).ready,true);
  assert.equal(productionReadiness(report({
    validation:{...report().validation,classification:'emerging',independentCreators:2}
  })).ready,false);
});

test('high saturation or low gap keeps an otherwise structural opportunity out of production',()=>{
  assert.equal(productionReadiness(report({
    viralDNA:{...report().viralDNA,saturation:{level:'high',rationale:'Crowded.'}}
  })).ready,false);
  assert.equal(productionReadiness(report({
    viralDNA:{...report().viralDNA,gap:{level:'low',rationale:'No whitespace.'}}
  })).ready,false);
});

test('mission candidate ordering prefers stronger breakout before raw views',()=>{
  const strongerBreakout=channel('breakout',600000,10000,30);
  const largerViews=channel('views',900000,100000,20);
  assert.equal([largerViews,strongerBreakout].sort(compareMissionCandidates)[0].id,'breakout');
});

test('when breakout is equal, mission ordering prefers more views',()=>{
  const smaller=channel('small',600000,10000,30);
  const larger=channel('large',900000,15000,30);
  assert.equal([smaller,larger].sort(compareMissionCandidates)[0].id,'large');
});

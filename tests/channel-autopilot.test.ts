import test from 'node:test';
import assert from 'node:assert/strict';
import { managedChannelSchema } from '../src/lib/server/validation';

const base={
  id:'11111111-1111-4111-8111-111111111111',
  name:'Dino Knows',
  niche:'AI and future',
  format:'2D animation',
  stage:'production' as const,
  priority:'high' as const,
  description:'Future of humanity',
  createdAt:'2026-09-24T00:00:00.000Z',
  updatedAt:'2026-09-24T00:00:00.000Z'
};

test('Managed Channel remains backwards compatible without Autopilot settings',()=>{
  const parsed=managedChannelSchema.parse(base);
  assert.equal(parsed.autopilot,undefined);
  assert.equal(parsed.createdAt,base.createdAt);
});

test('Managed Channel accepts explicit disabled Autopilot defaults',()=>{
  const parsed=managedChannelSchema.parse({
    ...base,
    autopilot:{
      enabled:false,
      mode:'assisted',
      startOnAcceptedNextEpisode:true
    }
  });
  assert.equal(parsed.autopilot?.enabled,false);
  assert.equal(parsed.autopilot?.mode,'assisted');
  assert.equal(parsed.autopilot?.startOnAcceptedNextEpisode,true);
  assert.equal(parsed.autopilot?.learningLoopEnabled,true);
  assert.deepEqual(parsed.autopilot?.learningWindowsHours,[24,72,168]);
  assert.equal(parsed.autopilot?.autoApprovePerformance,true);
  assert.equal(parsed.autopilot?.autoAnalyzeAudience,true);
  assert.equal(parsed.autopilot?.autoApproveAudience,true);
});

test('Managed Channel accepts Autonomous opt-in without enabling auto publish implicitly',()=>{
  const parsed=managedChannelSchema.parse({
    ...base,
    autopilot:{
      enabled:true,
      mode:'autonomous',
      startOnAcceptedNextEpisode:true
    }
  });
  assert.deepEqual(parsed.autopilot,{
    enabled:true,
    mode:'autonomous',
    startOnAcceptedNextEpisode:true,
    learningLoopEnabled:true,
    learningWindowsHours:[24,72,168],
    autoApprovePerformance:true,
    autoAnalyzeAudience:true,
    autoApproveAudience:true
  });
});

test('Managed Channel rejects unknown Autopilot modes',()=>{
  const parsed=managedChannelSchema.safeParse({
    ...base,
    autopilot:{
      enabled:true,
      mode:'full-auto',
      startOnAcceptedNextEpisode:true
    }
  });
  assert.equal(parsed.success,false);
});

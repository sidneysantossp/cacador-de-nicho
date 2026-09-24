import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelAutopilotStartsAcceptedEpisode,
  defaultChannelAutopilot,
  effectiveChannelAutopilot,
  startAcceptedEpisodeAutopilot
} from '../src/lib/channel-autopilot-policy';

test('Channel Autopilot defaults are disabled and conservative',()=>{
  assert.deepEqual(defaultChannelAutopilot,{
    enabled:false,
    mode:'assisted',
    startOnAcceptedNextEpisode:true
  });
  assert.equal(channelAutopilotStartsAcceptedEpisode({}),false);
  assert.deepEqual(effectiveChannelAutopilot({}),defaultChannelAutopilot);
});

test('Disabled Autopilot never invokes Episode Automation',async()=>{
  let calls=0;
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{enabled:false,mode:'autonomous',startOnAcceptedNextEpisode:true}},
    '11111111-1111-4111-8111-111111111111',
    async()=>{calls++;return{id:'run',mode:'autonomous' as const};}
  );
  assert.equal(calls,0);
  assert.equal(result.automationStarted,false);
  assert.equal(result.automationRunId,undefined);
});

test('Autopilot respects the accepted-episode handoff toggle',async()=>{
  let calls=0;
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{enabled:true,mode:'autonomous',startOnAcceptedNextEpisode:false}},
    '11111111-1111-4111-8111-111111111111',
    async()=>{calls++;return{id:'run',mode:'autonomous' as const};}
  );
  assert.equal(calls,0);
  assert.equal(result.automationStarted,false);
});

test('Autonomous opt-in starts exactly one Automation Run with the Content Project',async()=>{
  const calls:Array<{contentProjectId:string;mode:'assisted'|'autonomous'}>=[];
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{enabled:true,mode:'autonomous',startOnAcceptedNextEpisode:true}},
    '11111111-1111-4111-8111-111111111111',
    async input=>{
      calls.push(input);
      return{id:'22222222-2222-4222-8222-222222222222',mode:input.mode};
    }
  );
  assert.deepEqual(calls,[{
    contentProjectId:'11111111-1111-4111-8111-111111111111',
    mode:'autonomous'
  }]);
  assert.equal(result.automationStarted,true);
  assert.equal(result.automationRunId,'22222222-2222-4222-8222-222222222222');
  assert.equal(result.automationMode,'autonomous');
});

test('Autopilot startup failure is reported without throwing away the editorial decision',async()=>{
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{enabled:true,mode:'assisted',startOnAcceptedNextEpisode:true}},
    '11111111-1111-4111-8111-111111111111',
    async()=>{throw new Error('synthetic automation failure');}
  );
  assert.equal(result.automationStarted,false);
  assert.equal(result.automationMode,'assisted');
  assert.equal(result.automationError,'synthetic automation failure');
});

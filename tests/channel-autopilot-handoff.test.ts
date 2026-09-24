import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelAutopilotLearningEnabled, channelAutopilotStartsAcceptedEpisode,
  channelLearningWindows, channelNextEpisodeTriggerWindow,
  autopilotDecisionPreview, autopilotOperationalIssues, channelShouldAutoPlanNextEpisode, defaultChannelAutopilot,
  effectiveChannelAutopilot, nextEpisodeAutoAcceptIssues,
  startAcceptedEpisodeAutopilot
} from '../src/lib/channel-autopilot-policy';

test('Channel Autopilot defaults are disabled and conservative',()=>{
  assert.deepEqual(defaultChannelAutopilot,{
    enabled:false,
    mode:'assisted',
    startOnAcceptedNextEpisode:true,
    learningLoopEnabled:true,
    learningWindowsHours:[24,72,168],
    autoApprovePerformance:true,
    autoAnalyzeAudience:true,
    autoApproveAudience:true,
    autoPlanNextEpisode:true,
    autoAcceptNextEpisode:false,
    nextEpisodeTriggerHours:72,
    nextEpisodeMinEvidence:'high'
  });
  assert.equal(channelAutopilotStartsAcceptedEpisode({}),false);
  assert.deepEqual(effectiveChannelAutopilot({}),defaultChannelAutopilot);
});

test('Disabled Autopilot never invokes Episode Automation',async()=>{
  let calls=0;
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{...defaultChannelAutopilot,enabled:false,mode:'autonomous'}},
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
    {autopilot:{...defaultChannelAutopilot,enabled:true,mode:'autonomous',startOnAcceptedNextEpisode:false}},
    '11111111-1111-4111-8111-111111111111',
    async()=>{calls++;return{id:'run',mode:'autonomous' as const};}
  );
  assert.equal(calls,0);
  assert.equal(result.automationStarted,false);
});

test('Autonomous opt-in starts exactly one Automation Run with the Content Project',async()=>{
  const calls:Array<{contentProjectId:string;mode:'assisted'|'autonomous'}>=[];
  const result=await startAcceptedEpisodeAutopilot(
    {autopilot:{...defaultChannelAutopilot,enabled:true,mode:'autonomous'}},
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
    {autopilot:{...defaultChannelAutopilot,enabled:true,mode:'assisted'}},
    '11111111-1111-4111-8111-111111111111',
    async()=>{throw new Error('synthetic automation failure');}
  );
  assert.equal(result.automationStarted,false);
  assert.equal(result.automationMode,'assisted');
  assert.equal(result.automationError,'synthetic automation failure');
});

test('Closed Loop starts only for enabled channel Autopilot and normalizes windows',()=>{
  assert.equal(channelAutopilotLearningEnabled({}),false);
  assert.equal(channelAutopilotLearningEnabled({
    autopilot:{...defaultChannelAutopilot,enabled:true,learningLoopEnabled:true}
  }),true);
  assert.deepEqual(channelLearningWindows({
    autopilot:{
      ...defaultChannelAutopilot,
      enabled:true,
      learningWindowsHours:[168,24,72,24,9999,-1]
    }
  }),[24,72,168]);
});


test('Auto Next Episode chooses the first learning window at or after target',()=>{
  const channel={
    autopilot:{
      ...defaultChannelAutopilot,
      enabled:true,
      learningLoopEnabled:true,
      autoPlanNextEpisode:true,
      learningWindowsHours:[24,72,168],
      nextEpisodeTriggerHours:50
    }
  };
  assert.equal(channelNextEpisodeTriggerWindow(channel),72);
  assert.equal(channelShouldAutoPlanNextEpisode(channel,24),false);
  assert.equal(channelShouldAutoPlanNextEpisode(channel,72),true);
  assert.equal(channelShouldAutoPlanNextEpisode(channel,168),false);
});

test('Autopilot Canary Gate blocks overlapping automatic episode decisions',()=>{
  assert.deepEqual(autopilotOperationalIssues({
    automaticAcceptanceInLast24Hours:false,
    activeEpisodeAutomation:false
  }),[]);
  assert.deepEqual(autopilotOperationalIssues({
    automaticAcceptanceInLast24Hours:true,
    activeEpisodeAutomation:false
  }),['auto-accept-cooldown']);
  assert.deepEqual(autopilotOperationalIssues({
    automaticAcceptanceInLast24Hours:false,
    activeEpisodeAutomation:true
  }),['episode-automation-active']);
  assert.deepEqual(autopilotOperationalIssues({
    automaticAcceptanceInLast24Hours:true,
    activeEpisodeAutomation:true
  }),['auto-accept-cooldown','episode-automation-active']);
});

test('Autopilot Dry Run exposes disabled generate review and auto-accept states',()=>{
  const plan={
    recommendedCandidateId:'candidate-1',
    candidates:[{
      id:'candidate-1',
      workingTitle:'The next test',
      narrativeReady:true,
      blockers:[],
      evidenceStrength:'high' as const,
      evidenceRefs:['learning:1']
    }],
    context:{evidenceSnapshot:[
      {ref:'learning:1',type:'learning' as const,confidence:'high' as const}
    ]}
  };

  const disabled=autopilotDecisionPreview({},plan);
  assert.equal(disabled.action,'disabled');
  assert.ok(disabled.issues.includes('autopilot-disabled'));

  const planning=autopilotDecisionPreview({
    autopilot:{...defaultChannelAutopilot,enabled:true}
  },null);
  assert.equal(planning.action,'generate-plan');
  assert.equal(planning.triggerWindowHours,72);

  const review=autopilotDecisionPreview({
    autopilot:{...defaultChannelAutopilot,enabled:true,mode:'assisted'}
  },plan);
  assert.equal(review.action,'review');
  assert.equal(review.candidateTitle,'The next test');
  assert.ok(review.issues.includes('autonomous-mode-required'));

  const automatic=autopilotDecisionPreview({
    autopilot:{
      ...defaultChannelAutopilot,
      enabled:true,
      mode:'autonomous',
      autoAcceptNextEpisode:true,
      nextEpisodeMinEvidence:'high'
    }
  },plan);
  assert.equal(automatic.action,'auto-accept');
  assert.equal(automatic.candidateId,'candidate-1');
  assert.equal(automatic.evidenceStrength,'high');
  assert.deepEqual(automatic.issues,[]);
});

test('Automatic acceptance requires autonomous mode, threshold and strong learning evidence',()=>{
  const plan={
    recommendedCandidateId:'candidate-1',
    candidates:[{
      id:'candidate-1',
      narrativeReady:true,
      blockers:[],
      evidenceStrength:'high' as const,
      evidenceRefs:['learning:1','concept:future']
    }],
    context:{evidenceSnapshot:[
      {ref:'learning:1',type:'learning' as const,confidence:'high' as const},
      {ref:'concept:future',type:'concept' as const}
    ]}
  };
  const ready={
    autopilot:{
      ...defaultChannelAutopilot,
      enabled:true,
      mode:'autonomous' as const,
      autoAcceptNextEpisode:true,
      nextEpisodeMinEvidence:'high' as const
    }
  };
  assert.deepEqual(nextEpisodeAutoAcceptIssues(ready,plan),[]);

  const assisted={autopilot:{...ready.autopilot,mode:'assisted' as const}};
  assert.ok(nextEpisodeAutoAcceptIssues(assisted,plan).includes('autonomous-mode-required'));

  const weak={
    ...plan,
    candidates:[{...plan.candidates[0],evidenceStrength:'medium' as const}]
  };
  assert.ok(nextEpisodeAutoAcceptIssues(ready,weak).includes('evidence-below-threshold'));

  const noLearning={
    ...plan,
    candidates:[{...plan.candidates[0],evidenceRefs:['concept:future']}]
  };
  assert.ok(nextEpisodeAutoAcceptIssues(ready,noLearning).includes('no-strong-learning-evidence'));
});

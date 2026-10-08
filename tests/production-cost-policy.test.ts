import test from 'node:test';
import assert from 'node:assert/strict';
import { visualGenerationBudgetDecision } from '../src/lib/production-cost-policy';

test('Visual generation budget blocks unknown provider pricing',()=>{
  const decision=visualGenerationBudgetDecision({
    snapshot:{incurredUsd:.12,unknownPaidAssets:0,paidAssetCount:2},
    budgetUsd:.50,
    estimatedCostUsd:null
  });
  assert.equal(decision.allowed,false);
  assert.equal(decision.reason,'generation-cost-unknown');
  assert.equal(decision.projectedUsd,null);
});

test('Visual generation budget blocks when previous paid cost is unknown',()=>{
  const decision=visualGenerationBudgetDecision({
    snapshot:{incurredUsd:.08,unknownPaidAssets:1,paidAssetCount:2},
    budgetUsd:.50,
    estimatedCostUsd:.04
  });
  assert.equal(decision.allowed,false);
  assert.equal(decision.reason,'existing-paid-cost-unknown');
});

test('Visual generation budget blocks projected overspend',()=>{
  const decision=visualGenerationBudgetDecision({
    snapshot:{incurredUsd:.47,unknownPaidAssets:0,paidAssetCount:4},
    budgetUsd:.50,
    estimatedCostUsd:.04
  });
  assert.equal(decision.allowed,false);
  assert.equal(decision.reason,'visual-budget-exceeded');
  assert.equal(decision.projectedUsd,.51);
});

test('Visual generation budget allows known spend inside the episode cap',()=>{
  const decision=visualGenerationBudgetDecision({
    snapshot:{incurredUsd:.21,unknownPaidAssets:0,paidAssetCount:3},
    budgetUsd:.50,
    estimatedCostUsd:.04
  });
  assert.equal(decision.allowed,true);
  assert.equal(decision.reason,'within-budget');
  assert.equal(decision.projectedUsd,.25);
});

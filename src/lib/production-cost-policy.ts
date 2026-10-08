export type VisualCostSnapshot={
  incurredUsd:number;
  unknownPaidAssets:number;
  paidAssetCount:number;
};

export type VisualGenerationBudgetDecision={
  allowed:boolean;
  reason:
    |'within-budget'
    |'generation-cost-unknown'
    |'existing-paid-cost-unknown'
    |'visual-budget-exceeded';
  budgetUsd:number;
  incurredUsd:number;
  estimatedCostUsd:number|null;
  projectedUsd:number|null;
};

function money(value:number){
  return Math.round(value*10000)/10000;
}

export function visualGenerationBudgetDecision(input:{
  snapshot:VisualCostSnapshot;
  budgetUsd:number;
  estimatedCostUsd:number|null|undefined;
}):VisualGenerationBudgetDecision{
  const budgetUsd=Math.max(0,Number(input.budgetUsd)||0);
  const incurredUsd=Math.max(0,Number(input.snapshot.incurredUsd)||0);
  const estimated=Number(input.estimatedCostUsd);

  if(input.snapshot.unknownPaidAssets>0){
    return {
      allowed:false,
      reason:'existing-paid-cost-unknown',
      budgetUsd:money(budgetUsd),
      incurredUsd:money(incurredUsd),
      estimatedCostUsd:Number.isFinite(estimated)&&estimated>=0?money(estimated):null,
      projectedUsd:null
    };
  }

  if(!Number.isFinite(estimated)||estimated<0){
    return {
      allowed:false,
      reason:'generation-cost-unknown',
      budgetUsd:money(budgetUsd),
      incurredUsd:money(incurredUsd),
      estimatedCostUsd:null,
      projectedUsd:null
    };
  }

  const projected=incurredUsd+estimated;
  if(projected>budgetUsd+1e-9){
    return {
      allowed:false,
      reason:'visual-budget-exceeded',
      budgetUsd:money(budgetUsd),
      incurredUsd:money(incurredUsd),
      estimatedCostUsd:money(estimated),
      projectedUsd:money(projected)
    };
  }

  return {
    allowed:true,
    reason:'within-budget',
    budgetUsd:money(budgetUsd),
    incurredUsd:money(incurredUsd),
    estimatedCostUsd:money(estimated),
    projectedUsd:money(projected)
  };
}

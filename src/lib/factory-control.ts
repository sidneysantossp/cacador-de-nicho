export type FactoryAgentStatus='active'|'paused'|'retired';
export type FactoryOperationStatus='ready'|'processing'|'blocked'|'review'|'completed'|'failed';

export type FactoryAgent={
  id:string;
  displayName:string;
  signature:string;
  provider:string;
  model:string|null;
  role:string;
  status:FactoryAgentStatus;
  description:string;
  updatedAt:string;
};

export type FactoryOperation={
  id:string;
  source:'episode'|'agent-operation';
  operationKey:string;
  agentId:string;
  agentName:string;
  agentSignature:string;
  channelId:string|null;
  channelName:string;
  episodeId:string|null;
  videoTitle:string;
  batchKey:string|null;
  stage:string;
  stageLabel:string;
  status:FactoryOperationStatus;
  progress:number;
  summary:string;
  blocker:string|null;
  updatedAt:string;
};

export type FactoryAgentPerformance={
  agentId:string;
  attributedEpisodes:number;
  publishedSamples:number;
  medianViews:number|null;
  medianCtrPercent:number|null;
  medianAveragePercentageViewed:number|null;
  medianRpm:number|null;
  totalRevenue:number|null;
  bestEpisode:{episodeId:string;title:string;views:number}|null;
};

export type FactoryControlState={
  generatedAt:string;
  summary:{
    ready:number;
    processing:number;
    blocked:number;
    review:number;
    completed:number;
    failed:number;
  };
  agents:FactoryAgent[];
  operations:FactoryOperation[];
  performance:FactoryAgentPerformance[];
};

export const factoryStatusLabels:Record<FactoryOperationStatus,string>={
  ready:'READY',
  processing:'PROCESSING',
  blocked:'BLOCKED',
  review:'REVIEW',
  completed:'COMPLETED',
  failed:'FAILED'
};

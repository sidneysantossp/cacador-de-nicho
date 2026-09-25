export type ChannelStudyComment = { text: string; likes: number; publishedAt: string };
export type ChannelStudySnapshot = { observedAt: string; views: number };
export type ChannelStudyVideo = { id: string; title: string; publishedAt: string; views: number; likes: number | null; commentCount: number | null; duration: string; thumbnail: string; url: string; comments: ChannelStudyComment[]; snapshots: ChannelStudySnapshot[]; velocity: { baseline: boolean; deltaViews: number | null; deltaHours: number | null; viewsPerHour: number | null } };
export type ChannelNicheProfile = { primaryNiche: string; subniche: string; audienceIntent: string; coreTopics: string[]; anchorTerms: string[]; excludedAdjacentTopics: string[]; searchQueries: string[]; formatSignature: string };
export type ChannelStudyTopicGenome = { winningEntities: string[]; recurringAngles: string[]; curiosityMechanisms: string[]; titleTokens: string[]; underperformingContrasts: string[] };
export type ChannelStudySustainability = { score: number; classification: 'fragile' | 'emerging' | 'repeatable'; rationale: string; supportingSignals: string[]; riskSignals: string[] };
export type ChannelStudyThumbnailAnalysis = { inspected: boolean; hitPatterns: string[]; weakPatterns: string[]; visualContrasts: string[]; compositionPatterns: string[]; textUsage: string[]; recurringSubjects: string[]; visualHooks: string[]; consistencySignals: string[]; limitations: string[] };
export type ChannelStudyCommentDemand = { requestedTopics: string[]; repeatedQuestions: string[]; confusionPoints: string[]; emotionalTriggers: string[]; objectionsAndDebates: string[] };
export type ChannelStudySequence = { hitVideoId: string; hitTitle: string; before: { id: string; title: string; views: number }[]; after: { id: string; title: string; views: number }[] };
export type ChannelStudyAnatomy = { executiveSummary: string; viralPatterns: string[]; titlePatterns: string[]; topicClusters: string[]; formatPatterns: string[]; commentSignals: string[]; audienceQuestions: string[]; repeatableMechanisms: string[]; oneOffRisks: string[]; contentGaps: string[]; productionNotes: string[]; commentDemand: ChannelStudyCommentDemand; topicGenome: ChannelStudyTopicGenome; sustainability: ChannelStudySustainability; sequenceInsights: string[]; weakVideoContrasts: string[]; limitations: string[] };
export type SimilarChannelMatch = { channel: Channel; similarityScore: number; similarityReason: string; matchedTerms: string[] };
export type ChannelStudy = { kind: 'channel-study'; id: string; input: string; topSampleScope?: 'global-search-candidates' | 'recent-uploads'; source: { id: string; name: string; handle: string; description: string; url: string; createdAt: string; videoCount: number; subscribers: number | null; avatar: string }; scannedVideos: number; totalPublicVideos: number; scanTruncated: boolean; comparisonSampleSize: number; topVideos: ChannelStudyVideo[]; thumbnailAnalysis: ChannelStudyThumbnailAnalysis; weakRecentVideos: ChannelStudyVideo[]; sequences: ChannelStudySequence[]; commentSampleSize: number; commentsAvailableVideos: number; nicheProfile: ChannelNicheProfile; anatomy: ChannelStudyAnatomy; similarCandidates: SimilarChannelMatch[]; metrics: { top10Views: number; top3Share: number; medianTop10Views: number; weakMedianViews: number | null; hitToWeakMedianRatio: number | null; videosAboveSubscribers: number | null; velocityTrackedVideos: number }; createdAt: string };
export type OpportunityCurve = {
 thesis: string;
 subject: string;
 promise: string;
 angle: string;
 narrativeMechanism: string;
 visualMechanism: string;
 emotionalDriver: string;
 repeatabilityEvidence: string[];
 failureConditions: string[];
};
export type OpportunitySignal = { level: 'low' | 'medium' | 'high' | 'uncertain'; rationale: string };
export type OpportunityValidation = {
 classification: 'hypothesis' | 'emerging' | 'structural';
 independentCreators: number;
 supportingVideos: number;
 evidence: string[];
 counterEvidence: string[];
 limitations: string[];
};
export type OpportunityTransfer = {
 id: string;
 label: string;
 principle: string;
 targetNiche: string;
 targetAudience: string;
 changedVariable: string;
 preservedMechanism: string;
 demandStatus: 'observed' | 'partial' | 'hypothesis';
 demandEvidence: string[];
 gap: string;
 whyItCouldWork: string;
 titles: string[];
 risks: string[];
};
export type OpportunityReport = {
 kind: 'opportunity-report';
 id: string;
 channelStudyId: string;
 sourceChannelId: string;
 title: string;
 thesis: string;
 curve: OpportunityCurve;
 validation: OpportunityValidation;
 saturation: {
  level: 'low' | 'medium' | 'high' | 'uncertain';
  rationale: string;
  saturatedPatterns: string[];
  underusedAngles: string[];
  whitespace: string[];
 };
 viralDNA: {
  demand: OpportunitySignal;
  repeatability: OpportunitySignal;
  breakout: OpportunitySignal;
  saturation: OpportunitySignal;
  gap: OpportunitySignal;
 };
 evidence: {
  topVideos: { id: string; title: string; views: number; url: string }[];
  similarChannels: { id: string; name: string; similarityScore: number; videoViews: number; url: string }[];
 };
 transfers: OpportunityTransfer[];
 channelConcept: {
  nameDirections: string[];
  positioning: string;
  audience: string;
  promise: string;
  format: string;
  thumbnailSystem: string;
  productionModel: string;
  firstEpisodes: string[];
  testPlan: string[];
 };
 nextMove: string;
 limitations: string[];
 createdAt: string;
};
export type Opportunity = { id: string; name: string; lens: string; promise: string; difference: string; episodes: string[]; risk: string; test: string; gap?: string; demandEvidence?: string[] };
export type GapOpportunity = { id: string; format: string; niche: string; status: 'investigate'; strength: number; rationale: string; directReferences: string[]; analogReferences: string[]; observedChannels: string[] };
export type Analysis = { observation: string; mechanism: string; hypotheses: string[]; gaps: string[]; limitations: string[]; opportunities: Opportunity[]; sources: { title: string; url: string }[]; review: string; createdAt: string };
export type Channel = { id: string; name: string; handle: string; niche: string; language: string; country?: string; format: string; description: string; lens: string; thumbnail: string; avatar?: string; url: string; createdAt: string; firstSeenAt: string; observedAt: string; videoCount: number; subscribers: number | null; video: { id: string; title: string; publishedAt: string; views: number; duration: string; thumbnail: string; url: string }; status: 'new' | 'watching' | 'analyzed' | 'archived'; evidence: string[]; analysis?: Analysis; demo?: boolean; discoverySource?: 'reference' | 'reference-adjacent'; reference?: { catalogName: string; tier: 'Legendary' | 'Really Good' | 'Reference'; format: string; niche: string } };
export type UniversePilotBrief = {
 kind:'universe-pilot-brief';
 id:string;
 decisionId:string;
 gapId:string;
 marketGeneratedAt:string;
 createdAt:string;
 status:'approved-for-test';
 title:string;
 targetSpace:string;
 curveId:string;
 curveName:string;
 firstTest:string;
 alternateAngles:Array<{
  title:string;
  curveName:string;
  targetSpace:string;
  firstTest:string;
 }>;
 hypothesis:string;
 evidence:{
  curveClassification:'structural';
  independentCreators:number;
  targetEvidenceCount:number;
  demandStatus:'observed';
  sampleSaturation:'low'|'medium'|'uncertain';
  supportingChannelIds:string[];
  targetEvidenceChannelIds:string[];
  demandEvidence:string[];
 };
 risks:string[];
 testPlan:{
  episodeTitle:string;
  purpose:string;
  preserveMechanism:string;
  changedVariable:string;
  successGate:string[];
  stopGate:string[];
 };
 nextGate:'produce-one-pilot';
};
export type UniversePilotHandoff = {
 channelId:string;
 channelName:string;
 episodeId:string;
 contentProjectId:string;
 createdAt:string;
};
export type Decision = {
 id: string;
 channelId: string;
 opportunityId?: string;
 decision: 'approved' | 'rejected' | 'note';
 reason: string;
 createdAt: string;
 kind?: 'channel' | 'universe-pilot';
 marketGeneratedAt?: string;
 title?: string;
 targetSpace?: string;
 readiness?: 'pilot-ready' | 'investigate';
 demandStatus?: 'observed' | 'partial';
 sampleSaturation?: 'low' | 'medium' | 'uncertain';
 independentCreators?: number;
 targetEvidenceCount?: number;
 firstTest?: string;
 alternateAngles?: Array<{
  title: string;
  curveName: string;
  targetSpace: string;
  firstTest: string;
 }>;
 pilotBrief?: UniversePilotBrief;
 pilotHandoff?: UniversePilotHandoff;
};
export type ResearchContext = { id: string; title: string; content: string; createdAt: string };
export type Script = { id: string; channelId: string; opportunityId: string; title: string; content: string; createdAt: string; status: 'draft' };
export type MissionBrief = {
 kind: 'mission-brief';
 id: string;
 objective: string;
 status: 'completed' | 'partial' | 'blocked';
 startedAt: string;
 completedAt: string;
 health: {
  supabase: boolean;
  youtube: boolean;
  openai: boolean;
  blockers: string[];
 };
 market: {
  qualifiedChannels: number;
  channelStudies: number;
  opportunityReports: number;
  productionReady: number;
  competitors?: number;
  competitorSignals?: number;
  competitorDna?: number;
  universeCurves?: number;
  universeGaps?: number;
  universeActionableGaps?: number;
  universeQueuePending?: number;
  universeQueueCompleted?: number;
 };
 workCompleted: string[];
 productionQueue: Array<{
  reportId: string;
  channelStudyId: string;
  sourceChannelId: string;
  title: string;
  sourceChannel: string;
  conceptName: string;
  firstEpisode: string;
  readiness: 'production-ready';
  reasons: string[];
  nextAction: string;
 }>;
 universeOpportunities: Array<{
  gapId: string;
  curveId: string;
  title: string;
  curveName: string;
  targetSpace: string;
  readiness: 'pilot-ready' | 'investigate';
  demandStatus: 'observed' | 'partial';
  sampleSaturation: 'low' | 'medium' | 'uncertain';
  independentCreators: number;
  targetEvidenceCount: number;
  firstTest: string;
  alternateAngles?: Array<{
   title: string;
   curveName: string;
   targetSpace: string;
   firstTest: string;
  }>;
  reasons: string[];
  risks: string[];
 }>;
 decisionsNeeded: Array<{
  type: 'pilot-decision' | 'evidence-review';
  title: string;
  reason: string;
  reportId?: string;
 }>;
 blockers: string[];
 notes: string[];
};
export type YouTubeSearchPurpose = 'reference-resolution' | 'radar-discovery' | 'channel-resolution' | 'channel-study' | 'similar-channels';
export type YouTubeSearchBudgetState = {
 kind: 'youtube-search-budget';
 id: string;
 pacificDate: string;
 limit: number;
 used: number;
 remaining: number;
 byPurpose: Record<YouTubeSearchPurpose,number>;
 purposeLimits: Record<YouTubeSearchPurpose,number>;
 duplicateSkips: number;
 blocked: boolean;
 blockedReason?: string;
 recentKeys: string[];
 updatedAt: string;
};
export type Run = { id: string; type: string; status: 'queued' | 'running' | 'completed' | 'failed'; startedAt: string; message: string; details?: Record<string,unknown> };
export type UniverseCompetitorStatus = 'watch' | 'heating-up' | 'breakout' | 'pattern' | 'emerging-curve' | 'structural-curve' | 'gap-found' | 'production-reference';
export type UniverseSignal = {
 kind: 'breakout' | 'internal-outlier' | 'acceleration' | 'repeat-hit' | 'cadence-shift';
 strength: 'low' | 'medium' | 'high';
 title: string;
 evidence: string;
 observedAt: string;
};
export type UniverseCompetitorSnapshot = {
 observedAt: string;
 subscribers: number | null;
 videoCount: number;
 recentAverageViews: number | null;
 recentMedianViews: number | null;
 uploadsLast30d: number;
 strongestVideoId: string | null;
 strongestVideoViews: number | null;
};
export type UniverseChannelDNA = {
 generatedAt: string;
 provenance?: {
  schemaVersion: 1;
  generatedBy: 'platform' | 'chatgpt' | 'codex' | 'external-agent' | 'operator';
  model?: string;
  sourceVideoCount: number;
  sourceSignalCount: number;
  observedAt: string;
 };
 summary: string;
 primaryNiche: string;
 subniche: string;
 audienceIntent: string;
 editorialPromise: string;
 formatSignature: string;
 contentPillars: string[];
 recurringEntities: string[];
 titlePatterns: string[];
 curiosityMechanisms: string[];
 emotionalDrivers: string[];
 differentiationSignals: string[];
 limitations: string[];
};
export type UniverseCompetitor = {
 kind: 'competitor';
 id: string;
 channelId: string;
 name: string;
 handle: string;
 url: string;
 avatar: string;
 country?: string;
 language: string;
 sourceCluster?: string;
 cluster: string;
 subniche: string;
 format: string;
 description: string;
 subscribers: number | null;
 videoCount: number;
 createdAt: string;
 importedAt: string;
 lastMonitoredAt: string;
 monitoringTier: 'hot' | 'active' | 'stable' | 'dormant';
 status: UniverseCompetitorStatus;
 recentAverageViews: number | null;
 recentMedianViews: number | null;
 recentVideoCount: number;
 uploadsLast30d: number;
 breakoutRatio: number | null;
 strongestRecentVideo: {
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  duration: string;
  thumbnail: string;
  url: string;
 } | null;
 recentUploads: Array<{
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  duration: string;
  thumbnail: string;
  url: string;
 }>;
 signals: string[];
 signalDetails?: UniverseSignal[];
 snapshots?: UniverseCompetitorSnapshot[];
 dna?: UniverseChannelDNA;
 dnaAttempts?: number;
 lastDnaAttemptAt?: string;
 lastDnaError?: string;
 dnaTags: string[];
 gapSummary?: string;
 updatedAt: string;
};
export type UniverseCurveClassification = 'hypothesis' | 'emerging' | 'structural';
export type UniverseCurve = {
 id: string;
 key: string;
 name: string;
 thesis: string;
 mechanismSteps: string[];
 supportingChannelIds: string[];
 independentCreators: number;
 classification: UniverseCurveClassification;
 clusters: string[];
 evidence: string[];
 counterEvidence: string[];
 recurringTitlePatterns: string[];
 transferableVariables: string[];
 limitations: string[];
};
export type UniverseGap = {
 id: string;
 curveId: string;
 title: string;
 targetSpace: string;
 targetKeywords?: string[];
 preservedMechanism: string;
 changedVariable: string;
 demandStatus: 'observed' | 'partial' | 'hypothesis';
 targetEvidenceChannelIds: string[];
 demandEvidence: string[];
 sampleSaturation: 'low' | 'medium' | 'high' | 'uncertain';
 rationale: string;
 risks: string[];
 firstTests: string[];
};
export type UniverseImportQueueSummary = {
 total: number;
 pending: number;
 processing: number;
 completed: number;
 failed: number;
 retryable: number;
 terminalFailed: number;
 resolved: number;
 progressPct: number;
};

export type UniverseMarketIntelligence = {
 kind: 'universe-market-intelligence';
 id: string;
 generatedAt: string;
 evidenceRevalidatedAt?: string;
 evidenceDnaCount?: number;
 sourceCompetitorIds: string[];
 dnaCount: number;
 curves: UniverseCurve[];
 gaps: UniverseGap[];
 limitations: string[];
};
export type LearningLoopJobStatus =
 | 'scheduled'
 | 'processing'
 | 'waiting'
 | 'completed'
 | 'failed'
 | 'cancelled';

export type LearningLoopJobPayload = {
 kind: 'learning-loop-job';
 channelId: string;
 publishJobId: string;
 packageId: string;
 episodeId: string;
 windowHours: number;
 dueAt: string;
 policy: {
  autoApprovePerformance: boolean;
  autoAnalyzeAudience: boolean;
  autoApproveAudience: boolean;
 };
 createdAt: string;
};

export type LearningLoopJob = LearningLoopJobPayload & {
 id: string;
 status: LearningLoopJobStatus;
 attempts: number;
 stage: string;
 observationId?: string;
 performanceReportId?: string;
 audienceReportId?: string;
 brainVersion?: number;
 nextEpisodePlanId?: string;
 nextEpisodeEpisodeId?: string;
 nextEpisodeAutomationRunId?: string;
 nextEpisodeAction?: 'planned' | 'review' | 'accepted' | 'automation-started';
 lastError?: string;
 completedAt?: string;
 updatedAt: string;
};

export type ChannelAutopilotSettings = {
 enabled: boolean;
 mode: 'assisted' | 'autonomous';
 startOnAcceptedNextEpisode: boolean;
 learningLoopEnabled: boolean;
 learningWindowsHours: number[];
 autoApprovePerformance: boolean;
 autoAnalyzeAudience: boolean;
 autoApproveAudience: boolean;
 autoPlanNextEpisode: boolean;
 autoAcceptNextEpisode: boolean;
 nextEpisodeTriggerHours: number;
 nextEpisodeMinEvidence: 'medium' | 'high';
};
export type AutopilotReadinessCheck = {
 code:string;
 label:string;
 area:'editorial'|'production'|'youtube'|'workers'|'operations';
 status:'pass'|'blocker'|'warning';
 requiredFor:'assisted'|'autonomous'|'closed-loop';
 detail:string;
};
export type AutopilotReadiness = {
 channelId:string;
 assistedReady:boolean;
 productionAutonomousReady:boolean;
 closedLoopReady:boolean;
 autonomousReady:boolean;
 checks:AutopilotReadinessCheck[];
 checkedAt:string;
};
export type AutopilotControlStatus = 'running' | 'paused';
export type AutopilotControlPayload = {
 kind:'autopilot-control';
 id:'global';
 status:AutopilotControlStatus;
 pauseReason:string;
 maxConcurrentAutomationRuns:number;
 maxConcurrentLearningJobs:number;
 updatedBy:'operator'|'system';
 createdAt:string;
 updatedAt:string;
};
export type AutopilotControl = AutopilotControlPayload & {
 version:number;
};
export type AutopilotControlVersion = {
 version:number;
 status:AutopilotControlStatus;
 payload:AutopilotControlPayload;
 createdAt:string;
};
export type AutopilotIncidentArea =
 | 'episode-automation'
 | 'closed-loop'
 | 'youtube-publisher'
 | 'render'
 | 'control-plane';
export type AutopilotIncidentSeverity = 'warning' | 'critical';
export type AutopilotIncidentStatus = 'open' | 'resolved' | 'ignored';
export type AutopilotIncident = {
 id:string;
 area:AutopilotIncidentArea;
 channelId?:string;
 entityId:string;
 severity:AutopilotIncidentSeverity;
 code:string;
 message:string;
 status:AutopilotIncidentStatus;
 occurrences:number;
 firstSeenAt:string;
 lastSeenAt:string;
 resolvedAt?:string;
 payload:Record<string,unknown>;
};
export type ManagedChannel = { id: string; name: string; niche: string; format: string; stage: 'idea' | 'research' | 'production' | 'published' | 'paused'; priority: 'high' | 'normal' | 'low'; description: string; sourceChannelId?: string; opportunityId?: string; autopilot?: ChannelAutopilotSettings; createdAt: string; updatedAt: string };
export type ChannelBrainCharacter = {
 id: string;
 name: string;
 role: string;
 traits: string[];
 knows: string[];
 doesNotKnow: string[];
 rules: string[];
};
export type ChannelBrainLearning = {
 id: string;
 type: 'audience' | 'performance' | 'editorial' | 'production' | 'operator';
 statement: string;
 evidence: string[];
 confidence: 'low' | 'medium' | 'high';
 createdAt: string;
};
export type ChannelBrainPayload = {
 kind: 'channel-brain';
 channelId: string;
 constitution: {
  premise: string;
  audience: string;
  editorialPromise: string;
  worldview: string;
  tone: string[];
  languageRules: string[];
  humor: string[];
  universeRules: string[];
  forbidden: string[];
  metaphors: string[];
 };
 characters: ChannelBrainCharacter[];
 narrative: {
  currentArc: string;
  stateSummary: string;
  lastEpisodeId?: string;
  establishedConcepts: string[];
  partialConcepts: string[];
  unknownConcepts: string[];
  openThreads: string[];
  resolvedThreads: string[];
  doNotRepeat: string[];
  nextConcepts: string[];
 };
 learnings: ChannelBrainLearning[];
 createdAt: string;
 updatedAt: string;
};
export type ChannelBrain = ChannelBrainPayload & { version: number };
export type ChannelBrainVersion = { version: number; payload: ChannelBrainPayload; createdAt: string };
export type ContentArc = {
 id: string;
 channelId: string;
 sequence: number;
 status: 'planned' | 'active' | 'completed' | 'paused';
 name: string;
 objective: string;
 premise: string;
 prerequisiteConcepts: string[];
 targetConcepts: string[];
 notes: string[];
 createdAt: string;
 updatedAt: string;
};
export type ChannelEpisode = {
 id: string;
 channelId: string;
 arcId?: string;
 sequence: number;
 status: 'idea' | 'planned' | 'scripted' | 'producing' | 'published' | 'archived';
 title: string;
 thesis: string;
 narrativeSummary: string;
 prerequisiteConcepts: string[];
 introducesConcepts: string[];
 reinforcesConcepts: string[];
 opensThreads: string[];
 resolvesThreads: string[];
 repetitionKeys: string[];
 youtubeVideoId?: string;
 publishedAt?: string;
 createdAt: string;
 updatedAt: string;
};
export type ChannelConcept = {
 id: string;
 channelId: string;
 key: string;
 label: string;
 description: string;
 status: 'unknown' | 'introduced' | 'partial' | 'established' | 'retired';
 prerequisiteKeys: string[];
 introducedEpisodeId?: string;
 establishedEpisodeId?: string;
 createdAt: string;
 updatedAt: string;
};
export type NarrativeBundle = {
 arcs: ContentArc[];
 episodes: ChannelEpisode[];
 concepts: ChannelConcept[];
};
export type ProductionDnaCharacter = {
 id: string;
 name: string;
 description: string;
 visualRules: string[];
 forbidden: string[];
 referenceAssets: string[];
};
export type ProductionDnaPayload = {
 kind: 'production-dna';
 channelId: string;
 format: {
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  targetDurationMinutes: { min: number | null; max: number | null };
  sceneDurationSeconds: { min: number | null; preferred: number | null; max: number | null };
 };
 visual: {
  styleName: string;
  styleDescription: string;
  palette: string[];
  compositionRules: string[];
  cameraRules: string[];
  motionRules: string[];
  basePrompt: string;
  scenePromptTemplate: string;
  negativePrompt: string;
  forbidden: string[];
 };
 characters: ProductionDnaCharacter[];
 voice: {
  language: string;
  providerPreference: string[];
  voiceId: string;
  voiceName: string;
  narrationStyle: string[];
  paceWpm: number | null;
  pronunciationRules: string[];
 };
 captions: {
  enabled: boolean;
  styleDescription: string;
  position: string;
  maxWordsPerCaption: number | null;
  highlightKeywords: boolean;
 };
 editing: {
  transitions: string[];
  defaultTransition: string;
  kenBurns: boolean;
  musicStyle: string[];
  sfxRules: string[];
  pacingRules: string[];
 };
 thumbnail: {
  styleRules: string[];
  forbidden: string[];
 };
 providers: {
  image: string[];
  video: string[];
  voice: string[];
  stock: string[];
 };
 createdAt: string;
 updatedAt: string;
};
export type ProductionDNA = ProductionDnaPayload & { version: number };
export type ProductionDnaVersion = { version: number; payload: ProductionDnaPayload; createdAt: string };
export type ContentResearchSource = {
 id: string;
 title: string;
 url: string;
 sourceType: 'primary' | 'secondary' | 'reference';
 origin?: 'institutional' | 'academic' | 'archive' | 'wikipedia' | 'reddit' | 'news' | 'reference' | 'other';
 role?: 'evidence' | 'discovery' | 'context' | 'anecdotal' | 'visual';
 claim: string;
 checkedAt?: string;
};
export type ContentResearchTimelineItem = {
 id: string;
 dateLabel: string;
 event: string;
 sourceIds: string[];
};
export type ContentAudienceSignal = {
 id: string;
 sourceId: string;
 kind: 'question' | 'memory' | 'language' | 'story' | 'sentiment';
 signal: string;
 notes: string;
};
export type ContentVisualLead = {
 id: string;
 title: string;
 pageUrl: string;
 provider: string;
 mediaType: 'image' | 'video';
 period: string;
 location: string;
 rightsStatus: 'public-domain' | 'creative-commons' | 'licensed' | 'owned' | 'hotlink-only' | 'unknown';
 licenseLabel: string;
 attribution: string;
 notes: string;
};
export type ContentResearchPack = {
 question: string;
 storyAngle: string;
 entities: string[];
 timeline: ContentResearchTimelineItem[];
 audienceSignals: ContentAudienceSignal[];
 visualLeads: ContentVisualLead[];
 provenance?: {
  generatedBy: 'chatgpt' | 'operator' | 'platform' | 'external';
  model?: string;
  observedAt?: string;
 };
};
export type ContentFactCheck = {
 id: string;
 claim: string;
 status: 'unverified' | 'supported' | 'contradicted' | 'needs-review';
 sourceIds: string[];
 notes: string;
};
export type ContentProjectPayload = {
 kind: 'content-project';
 id: string;
 channelId: string;
 episodeId: string;
 opportunityId?: string;
 brief: {
  theme: string;
  thesis: string;
  angle: string;
  promise: string;
  workingTitle: string;
  thumbnailConcept: string;
  targetAudience: string;
  objective: string;
  previousEpisodeConnection: string;
  arcConnection: string;
 };
 research: {
  notes: string;
  sources: ContentResearchSource[];
  factChecks: ContentFactCheck[];
  pack?: ContentResearchPack;
 };
 approval: {
  status: 'draft' | 'ready' | 'approved' | 'blocked';
  notes: string;
  approvedAt?: string;
  approvedBy?: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type ContentProject = ContentProjectPayload & {
 version: number;
 status: 'brief' | 'research' | 'review' | 'approved' | 'blocked';
};
export type ContentProjectVersion = {
 version: number;
 status: ContentProject['status'];
 payload: ContentProjectPayload;
 createdAt: string;
};
export type EpisodeScriptSection = {
 id: string;
 label: string;
 purpose: string;
 content: string;
};
export type EpisodeScriptPayload = {
 kind: 'episode-script';
 id: string;
 channelId: string;
 episodeId: string;
 contentProjectId: string;
 title: string;
 language: string;
 sections: EpisodeScriptSection[];
 content: string;
 wordCount: number;
 estimatedMinutes: number | null;
 continuityNotes: string[];
 factCheckWarnings: string[];
 provenance: {
  generatedBy: 'platform' | 'chatgpt' | 'codex' | 'external' | 'operator';
  model?: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type EpisodeScript = EpisodeScriptPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type EpisodeScriptVersion = {
 version: number;
 status: EpisodeScript['status'];
 payload: EpisodeScriptPayload;
 createdAt: string;
};
export type VoiceAlignment = {
 characters: string[];
 characterStartTimesSeconds: number[];
 characterEndTimesSeconds: number[];
};
export type VoiceAsset = {
 id: string;
 channelId: string;
 episodeId: string;
 scriptId: string;
 take: number;
 sourceType: 'uploaded' | 'generated';
 provider?: string;
 status: 'processing' | 'ready' | 'failed';
 selected: boolean;
 storagePath: string;
 mimeType: string;
 originalName?: string;
 bytes: number;
 scriptVersion: number;
 scriptWordCount: number;
 textHash: string;
 modelId?: string;
 voiceId?: string;
 voiceName?: string;
 durationSeconds: number | null;
 characterCount: number;
 alignment?: VoiceAlignment;
 createdAt: string;
 updatedAt: string;
};
export type TranscriptWord = {
 id: string;
 text: string;
 startSeconds: number;
 endSeconds: number;
 type: 'word' | 'audio_event';
 speakerId?: string;
 confidence?: number;
};
export type TranscriptSegment = {
 id: string;
 startSeconds: number;
 endSeconds: number | null;
 text: string;
 wordIds: string[];
};
export type TranscriptPayload = {
 kind: 'transcript';
 id: string;
 channelId: string;
 episodeId: string;
 scriptId: string;
 voiceAssetId: string;
 sourceType: 'alignment' | 'scribe' | 'imported';
 languageCode?: string;
 text: string;
 words: TranscriptWord[];
 segments: TranscriptSegment[];
 scriptMatchScore: number | null;
 scriptVersion: number;
 voiceTake: number;
 originalFormat?: 'srt' | 'vtt' | 'txt' | 'json';
 provenance: {
  provider?: string;
  model?: string;
  importedBy?: 'operator';
 };
 review: {
  scriptMismatchOverride: boolean;
  notes: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type Transcript = TranscriptPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type TranscriptVersion = {
 version: number;
 status: Transcript['status'];
 payload: TranscriptPayload;
 createdAt: string;
};
export type SceneAssetMode = 'image' | 'video' | 'stock' | 'mixed' | 'none';
export type SceneTimecode = {
 id: string;
 sequence: number;
 startSeconds: number;
 endSeconds: number;
 durationSeconds: number;
 narration: string;
 transcriptSegmentIds: string[];
 transcriptWordIds: string[];
 visualIntent: string;
 shotType: string;
 characterIds: string[];
 assetMode: SceneAssetMode;
 promptDirection: string;
 notes: string;
};
export type ScenePlanPayload = {
 kind: 'scene-plan';
 id: string;
 channelId: string;
 episodeId: string;
 scriptId: string;
 voiceAssetId: string;
 transcriptId: string;
 transcriptVersion: number;
 voiceTake: number;
 audioDurationSeconds: number;
 scenes: SceneTimecode[];
 review: {
  notes: string;
  durationWarningsAccepted: boolean;
 };
 createdAt: string;
 updatedAt: string;
};
export type ScenePlan = ScenePlanPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type ScenePlanVersion = {
 version: number;
 status: ScenePlan['status'];
 payload: ScenePlanPayload;
 createdAt: string;
};
export type VisualCharacterReference = {
 characterId: string;
 refName: string;
 prompt: string;
 sceneIds: string[];
 assetReady: boolean;
};
export type VisualScenePrompt = {
 sceneId: string;
 sequence: number;
 timecodeLabel: string;
 startSeconds: number;
 endSeconds: number;
 characterIds: string[];
 referenceNames: string[];
 direction: string;
 prompt: string;
};
export type VisualPromptSetPayload = {
 kind: 'visual-prompt-set';
 id: string;
 channelId: string;
 episodeId: string;
 scenePlanId: string;
 scenePlanVersion: number;
 productionDnaVersion: number;
 styleLock: string;
 workflowStage: 'references' | 'scenes' | 'complete';
 characterReferences: VisualCharacterReference[];
 scenePrompts: VisualScenePrompt[];
 review: {
  notes: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type VisualPromptSet = VisualPromptSetPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type VisualPromptSetVersion = {
 version: number;
 status: VisualPromptSet['status'];
 payload: VisualPromptSetPayload;
 createdAt: string;
};
export type SceneAssetKind = 'image' | 'video' | 'graphic';
export type SceneAssetSource = 'generated' | 'uploaded' | 'stock';
export type SceneAssetStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
export type SceneAssetLicense = {
 type: 'provider-terms' | 'owned' | 'licensed' | 'unknown';
 label: string;
 sourceUrl?: string;
 notes?: string;
};
export type StockMediaProvider = 'pexels' | 'pixabay' | 'unsplash' | 'vecteezy';
export type StockMediaResult = {
 provider: StockMediaProvider;
 providerAssetId: string;
 kind: 'image' | 'video';
 title: string;
 previewUrl: string;
 pageUrl: string;
 creatorName: string;
 creatorUrl?: string;
 width: number | null;
 height: number | null;
 durationSeconds: number | null;
 licenseLabel: string;
 attributionLabel: string;
};
export type SceneAsset = {
 id: string;
 channelId: string;
 episodeId: string;
 scenePlanId: string;
 visualPromptSetId: string;
 sceneId: string;
 variant: number;
 assetKind: SceneAssetKind;
 sourceType: SceneAssetSource;
 provider?: string;
 status: SceneAssetStatus;
 selected: boolean;
 storagePath: string;
 mimeType: string;
 originalName?: string;
 bytes: number;
 width: number | null;
 height: number | null;
 durationSeconds: number | null;
 timecodeLabel: string;
 promptSetVersion: number;
 prompt: string;
 promptHash: string;
 modelId?: string;
 providerOperationId?: string;
 generation: {
  aspectRatio?: string;
  imageSize?: string;
  resolution?: string;
  durationSeconds?: number;
 };
 license: SceneAssetLicense;
 stock?: {
  providerAssetId: string;
  pageUrl: string;
  creatorName: string;
  creatorUrl?: string;
  attributionLabel: string;
 };
 costUsd: number | null;
 error?: string;
 createdAt: string;
 updatedAt: string;
};
export type ExternalImportKind = 'image' | 'video' | 'audio' | 'transcript' | 'other';
export type ExternalImportItemStatus = 'pending' | 'processing' | 'ready' | 'unmatched' | 'failed' | 'skipped';
export type ExternalImportItem = {
 id: string;
 batchId: string;
 itemIndex: number;
 kind: ExternalImportKind;
 originalName: string;
 mimeType: string;
 bytes: number;
 matchedSceneId?: string;
 matchedTimeSeconds?: number;
 status: ExternalImportItemStatus;
 resourceType?: 'scene_asset' | 'voice_asset' | 'transcript';
 resourceId?: string;
 error?: string;
 payload: {
  detectedBy?: 'timecode' | 'scene-number' | 'manual' | 'none';
  normalizedMarker?: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type ExternalImportBatch = {
 id: string;
 channelId: string;
 scriptId: string;
 visualPromptSetId?: string;
 status: 'planned' | 'processing' | 'partial' | 'completed' | 'failed';
 payload: {
  voiceAssetId?: string;
  sourceLabel?: string;
 };
 items: ExternalImportItem[];
 createdAt: string;
 updatedAt: string;
};
export type MediaLibrarySemantic = {
 subjects: string[];
 locations: string[];
 periods: string[];
 shotTypes: string[];
 moods: string[];
};
export type VisualSegmentSemantic = {
 subjects: string[];
 locations: string[];
 landmarks: string[];
 activities: string[];
 objects: string[];
 environments: string[];
 timeOfDay: string[];
 weather: string[];
 shotTypes: string[];
 cameraMotion: string[];
 moods: string[];
 visualStyle: string[];
 periods: string[];
};
export type VisualAssetSegment = {
 id: string;
 channelId: string;
 assetId: string;
 sequence: number;
 startSeconds: number;
 endSeconds: number;
 durationSeconds: number;
 title: string;
 summary: string;
 semantic: VisualSegmentSemantic;
 confidence: number;
 searchText: string;
 keyframeSeconds: number;
 createdAt: string;
 updatedAt: string;
};
export type VisualIntelligenceResult = {
 assetId: string;
 status: 'idle' | 'processing' | 'completed' | 'failed';
 provider: 'googleai';
 model: string;
 assetTitle: string;
 durationSeconds: number | null;
 analyzedAt?: string;
 error?: string;
 segments: VisualAssetSegment[];
};
export type MediaLibraryItem = {
 mediaKey: string;
 resourceType: 'scene_asset' | 'voice_asset';
 resourceId: string;
 channelId: string;
 episodeId: string;
 mediaKind: 'image' | 'video' | 'audio';
 sourceType: string;
 provider?: string;
 title: string;
 originalName?: string;
 mimeType: string;
 bytes: number;
 width: number | null;
 height: number | null;
 durationSeconds: number | null;
 storagePath: string;
 signedUrl: string | null;
 selected: boolean;
 stale: boolean;
 favorite: boolean;
 tags: string[];
 notes: string;
 semantic: MediaLibrarySemantic;
 channelName?: string;
 scriptId?: string;
 voiceTake?: number;
 scenePlanId?: string;
 visualPromptSetId?: string;
 sceneId?: string;
 variant?: number;
 timecodeLabel?: string;
 prompt?: string;
 license?: SceneAssetLicense;
 stock?: {
  providerAssetId: string;
  pageUrl: string;
  creatorName: string;
  creatorUrl?: string;
  attributionLabel: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type TimelineClipKind = 'image' | 'video' | 'audio' | 'placeholder';
export type TimelineTrackType = 'visual' | 'voice' | 'overlay' | 'music' | 'sfx' | 'captions';
export type TimelineClip = {
 id: string;
 sceneId?: string;
 assetId?: string;
 clipKind: TimelineClipKind;
 label: string;
 startSeconds: number;
 endSeconds: number;
 durationSeconds: number;
 sourceStartSeconds: number | null;
 sourceEndSeconds: number | null;
 fit: 'cover' | 'contain' | 'stretch';
 playback: 'hold' | 'trim' | 'loop';
 volume: number;
 muted: boolean;
};
export type TimelineTrack = {
 id: string;
 type: TimelineTrackType;
 name: string;
 locked: boolean;
 muted: boolean;
 clips: TimelineClip[];
};
export type TimelinePayload = {
 kind: 'timeline';
 id: string;
 channelId: string;
 episodeId: string;
 scenePlanId: string;
 scenePlanVersion: number;
 scriptId: string;
 voiceAssetId: string;
 visualPromptSetId: string;
 visualPromptSetVersion: number;
 format: {
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
 };
 durationSeconds: number;
 tracks: TimelineTrack[];
 review: {
  notes: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type Timeline = TimelinePayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type TimelineVersion = {
 version: number;
 status: Timeline['status'];
 payload: TimelinePayload;
 createdAt: string;
};
export type VideoEditTransition = 'none' | 'fade' | 'cross-dissolve';
export type VideoEditMotionPreset = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'custom';
export type VideoEditClipStyle = {
 timelineClipId: string;
 sceneId: string;
 motionPreset: VideoEditMotionPreset;
 scaleStart: number;
 scaleEnd: number;
 xStart: number;
 xEnd: number;
 yStart: number;
 yEnd: number;
 transitionIn: VideoEditTransition;
 transitionOut: VideoEditTransition;
 transitionSeconds: number;
};
export type AudioLibraryAsset = {
 id: string;
 channelId: string;
 kind: 'music' | 'sfx';
 sourceType: 'uploaded' | 'generated' | 'stock';
 provider?: string;
 status: 'processing' | 'ready' | 'failed';
 storagePath: string;
 mimeType: string;
 originalName?: string;
 bytes: number;
 durationSeconds: number | null;
 bpm: number | null;
 favorite: boolean;
 tags: string[];
 notes: string;
 license: SceneAssetLicense;
 signedUrl: string | null;
 createdAt: string;
 updatedAt: string;
};
export type VideoEditCaptionWord = {
 id: string;
 text: string;
 startSeconds: number;
 endSeconds: number;
 highlighted: boolean;
};
export type VideoEditCaptionCue = {
 id: string;
 transcriptSegmentId: string;
 startSeconds: number;
 endSeconds: number;
 text: string;
 words: VideoEditCaptionWord[];
};
export type VideoEditCaptionStyle = {
 fontFamily: string;
 fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
 primaryColor: string;
 highlightColor: string;
 outlineColor: string;
 outlineWidth: number;
 uppercase: boolean;
 maxWordsPerLine: number;
 smartBreaks: boolean;
 highlightMode: 'none' | 'keywords' | 'active-word';
 safeMarginPercent: number;
};
export type VideoEditOverlay = {
 id: string;
 type: 'text';
 text: string;
 startSeconds: number;
 endSeconds: number;
 x: number;
 y: number;
 width: number;
 height: number;
 opacity: number;
 fontSize: number;
};
export type VideoEditMusicTrack = {
 assetId: string;
 startSeconds: number;
 endSeconds: number;
 sourceStartSeconds: number;
 loop: boolean;
 volume: number;
 fadeInSeconds: number;
 fadeOutSeconds: number;
 duckUnderVoice: boolean;
 duckingStrength: number;
};
export type VideoEditSfxEvent = {
 id: string;
 assetId: string;
 eventType: 'scene-transition' | 'emphasis' | 'custom';
 sceneId?: string;
 startSeconds: number;
 sourceStartSeconds: number;
 durationSeconds: number;
 volume: number;
};
export type VideoEditPayload = {
 kind: 'video-edit';
 id: string;
 channelId: string;
 episodeId: string;
 timelineId: string;
 timelineVersion: number;
 transcriptId: string;
 transcriptVersion: number;
 format: {
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
 };
 durationSeconds: number;
 clipStyles: VideoEditClipStyle[];
 captions: {
  enabled: boolean;
  position: 'top' | 'center' | 'bottom';
  fontSize: number;
  maxLines: number;
  backgroundOpacity: number;
  styleDescription: string;
  style: VideoEditCaptionStyle;
  cues: VideoEditCaptionCue[];
 };
 overlays: VideoEditOverlay[];
 audioMix: {
  voiceVolume: number;
  musicVolume: number;
  sfxVolume: number;
  normalizeVoice: boolean;
  duckMusicUnderVoice: boolean;
 };
 musicTrack: VideoEditMusicTrack | null;
 sfxEvents: VideoEditSfxEvent[];
 review: {
  notes: string;
 };
 createdAt: string;
 updatedAt: string;
};
export type VideoEdit = VideoEditPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};
export type VideoEditVersion = {
 version: number;
 status: VideoEdit['status'];
 payload: VideoEditPayload;
 createdAt: string;
};
export type RenderJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type RenderManifestVisualClip = {
 clipId: string;
 sceneId: string;
 assetId: string;
 kind: 'image' | 'video';
 storagePath: string;
 mimeType: string;
 startSeconds: number;
 endSeconds: number;
 durationSeconds: number;
 sourceStartSeconds: number | null;
 sourceEndSeconds: number | null;
 playback: 'hold' | 'trim' | 'loop';
 fit: 'cover' | 'contain' | 'stretch';
 style: VideoEditClipStyle;
};
export type RenderManifest = {
 videoEditId: string;
 videoEditVersion: number;
 timelineId: string;
 timelineVersion: number;
 transcriptId: string;
 transcriptVersion: number;
 format: {
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
 };
 durationSeconds: number;
 visualClips: RenderManifestVisualClip[];
 voice: {
  assetId: string;
  storagePath: string;
  mimeType: string;
 };
 music: {
  assetId: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  placement: VideoEditMusicTrack;
 } | null;
 sfxEvents: Array<{
  event: VideoEditSfxEvent;
  assetId: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
 }>;
 captions: VideoEditPayload['captions'];
 overlays: VideoEditOverlay[];
 audioMix: VideoEditPayload['audioMix'];
};
export type RenderPreset = 'source' | 'hd-1080p30' | 'draft-720p30';
export type RenderOutputFormat = {
 width: number;
 height: number;
 fps: number;
};
export type RenderJobPayload = {
 preset: RenderPreset;
 videoCodec: 'libx264';
 fallbackVideoCodecs?: Array<'mpeg4'>;
 crf: number;
 audioCodec: 'aac';
 audioBitrateKbps: number;
 outputFormat?: RenderOutputFormat;
 compilerVersion: 'render-v1' | 'render-v2' | 'render-v3';
 requestedBy: 'operator';
 manifest: RenderManifest;
};
export type RenderJob = {
 id: string;
 channelId: string;
 episodeId: string;
 videoEditId: string;
 videoEditVersion: number;
 status: RenderJobStatus;
 progress: number;
 stage: string;
 attempts: number;
 outputPath?: string;
 outputBytes?: number;
 outputSignedUrl?: string | null;
 error?: string;
 payload: RenderJobPayload;
 createdAt: string;
 startedAt?: string;
 completedAt?: string;
 updatedAt: string;
};
export type ProductionQualityCheckStatus = 'pass' | 'warning' | 'blocker' | 'manual-review';
export type ProductionQualityCategory =
  | 'render'
  | 'timeline'
  | 'audio'
  | 'captions'
  | 'visual'
  | 'text';
export type ProductionQualityCheckCode =
  | 'render-completed'
  | 'decode-integrity'
  | 'duration-match'
  | 'resolution-match'
  | 'aspect-ratio-match'
  | 'fps-match'
  | 'audio-stream'
  | 'audio-silence'
  | 'audio-clipping'
  | 'caption-timing'
  | 'visual-coverage'
  | 'asset-duplication'
  | 'asset-provenance'
  | 'asset-rights'
  | 'character-continuity'
  | 'prompt-asset-alignment'
  | 'text-placeholders'
  | 'spelling-review'
  | 'black-frames';
export type ProductionQualityCheck = {
 id: string;
 code: ProductionQualityCheckCode;
 category: ProductionQualityCategory;
 title: string;
 status: ProductionQualityCheckStatus;
 summary: string;
 evidence: string[];
 metrics: Record<string,number|string|boolean|null>;
};
export type ProductionQualityTechnical = {
 durationSeconds: number | null;
 width: number | null;
 height: number | null;
 fps: number | null;
 videoCodec: string | null;
 audioCodec: string | null;
 sampleRate: number | null;
 audioChannels: number | null;
 maxVolumeDb: number | null;
 silenceSeconds: number | null;
 silenceRatio: number | null;
 blackSeconds: number | null;
 blackRatio: number | null;
 decodeOk: boolean;
};
export type ProductionQualityReportPayload = {
 kind: 'production-quality-report';
 id: string;
 channelId: string;
 episodeId: string;
 renderJobId: string;
 videoEditId: string;
 videoEditVersion: number;
 renderCompilerVersion: RenderJobPayload['compilerVersion'];
 checkedAt: string;
 checks: ProductionQualityCheck[];
 summary: {
  pass: number;
  warnings: number;
  blockers: number;
  manualReview: number;
 };
 technical: ProductionQualityTechnical;
 review: {
  notes: string;
  overrides: ProductionQualityCheckCode[];
  approvedAt?: string;
  approvedBy?: 'operator';
 };
 createdAt: string;
 updatedAt: string;
};
export type ProductionQualityReport = ProductionQualityReportPayload & {
 version: number;
 status: 'blocked' | 'review' | 'approved';
};
export type ProductionQualityReportVersion = {
 version: number;
 status: ProductionQualityReport['status'];
 payload: ProductionQualityReportPayload;
 createdAt: string;
};

export type PublicationPackageStatus = 'draft' | 'review' | 'approved';
export type PublicationPackageAudience = 'unset' | 'made-for-kids' | 'not-made-for-kids';
export type PublicationPackageSyntheticDisclosure = 'review' | 'yes' | 'no';
export type PublicationPackageVisibility = 'private' | 'unlisted' | 'public';
export type PublicationThumbnail = {
 source: 'none' | 'uploaded' | 'generated' | 'frame';
 storagePath: string | null;
 mimeType: string | null;
 originalName: string | null;
 bytes: number | null;
 width: number | null;
 height: number | null;
 concept: string;
 overlayText: string;
 altText: string;
};
export type PublicationPackagePayload = {
 kind: 'publication-package';
 id: string;
 channelId: string;
 episodeId: string;
 qualityReportId: string;
 qualityReportVersion: number;
 renderJobId: string;
 renderOutputPath: string;
 metadata: {
  title: string;
  description: string;
  tags: string[];
  language: string;
  categoryId: string;
  visibility: PublicationPackageVisibility;
  audience: PublicationPackageAudience;
  syntheticMediaDisclosure: PublicationPackageSyntheticDisclosure;
  license: 'youtube' | 'creativeCommon';
 };
 thumbnail: PublicationThumbnail;
 review: {
  notes: string;
  approvedAt?: string;
  approvedBy?: 'operator';
 };
 createdAt: string;
 updatedAt: string;
};
export type PublicationPackage = PublicationPackagePayload & {
 version: number;
 status: PublicationPackageStatus;
 thumbnailSignedUrl?: string | null;
 renderOutputSignedUrl?: string | null;
};
export type PublicationPackageVersion = {
 version: number;
 status: PublicationPackageStatus;
 payload: PublicationPackagePayload;
 createdAt: string;
};

export type YouTubeConnectionStatus = 'connected' | 'needs-reauth' | 'disconnected';
export type YouTubeConnection = {
 id: string;
 channelId: string;
 youtubeChannelId: string;
 youtubeTitle: string;
 youtubeHandle?: string;
 youtubeThumbnail?: string;
 scopes: string[];
 status: YouTubeConnectionStatus;
 lastValidatedAt?: string;
 error?: string;
 createdAt: string;
 updatedAt: string;
};
export type YouTubePublishJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type YouTubePublishPayload = {
 kind: 'youtube-publish-job';
 channelId: string;
 packageId: string;
 packageVersion: number;
 connectionId: string;
 youtubeChannelId: string;
 renderOutputPath: string;
 thumbnailStoragePath: string;
 video: {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage: string;
  privacyStatus: PublicationPackageVisibility;
  license: 'youtube' | 'creativeCommon';
  selfDeclaredMadeForKids: boolean;
  containsSyntheticMedia: boolean;
 };
 requestedBy: 'operator';
 createdAt: string;
};
export type YouTubePublishJob = {
 id: string;
 channelId: string;
 packageId: string;
 packageVersion: number;
 connectionId: string;
 status: YouTubePublishJobStatus;
 progress: number;
 stage: string;
 attempts: number;
 youtubeVideoId?: string;
 youtubeUrl?: string;
 actualPrivacyStatus?: string;
 error?: string;
 payload: YouTubePublishPayload;
 createdAt: string;
 startedAt?: string;
 completedAt?: string;
 updatedAt: string;
};
export type PublicationPackageIssue = {
 code:
  | 'quality-not-approved'
  | 'quality-version-stale'
  | 'render-not-completed'
  | 'render-output-mismatch'
  | 'title-missing'
  | 'title-too-long'
  | 'description-too-long'
  | 'tags-too-long'
  | 'language-missing'
  | 'category-missing'
  | 'audience-unconfirmed'
  | 'synthetic-disclosure-unconfirmed'
  | 'thumbnail-missing'
  | 'thumbnail-format'
  | 'thumbnail-too-large'
  | 'thumbnail-too-small'
  | 'thumbnail-aspect-ratio'
  | 'thumbnail-nonstandard-size';
 level: 'blocker' | 'warning';
 message: string;
};

export type PerformanceMetricKey =
  | 'views'
  | 'impressions'
  | 'ctrPercent'
  | 'retentionFirstSecondsPercent'
  | 'retention30Percent'
  | 'averageViewDurationSeconds'
  | 'averagePercentageViewed'
  | 'watchTimeMinutes'
  | 'likes'
  | 'commentCount'
  | 'shares'
  | 'subscribersGained'
  | 'subscribersLost'
  | 'conversions'
  | 'revenue'
  | 'rpm';

export type PerformanceMetrics = Partial<Record<PerformanceMetricKey,number>>;

export type PerformanceObservationPayload = {
 kind: 'performance-observation';
 id: string;
 channelId: string;
 episodeId: string;
 externalVideoId?: string;
 sourceType: 'manual' | 'imported' | 'youtube-analytics';
 observedAt: string;
 metrics: PerformanceMetrics;
 retentionCurve: Array<{
  second: number;
  audiencePercent: number;
 }>;
 trafficSources: Array<{
  source: string;
  views: number;
  watchTimeMinutes?: number;
 }>;
 comments: Array<{
  text: string;
  likes?: number;
 }>;
 expectations: PerformanceMetrics;
 experiment: {
  changedVariables: string[];
  notes: string;
 };
 provenance: {
  sourceLabel?: string;
  importedFileName?: string;
 };
 createdAt: string;
};

export type PerformanceObservation = PerformanceObservationPayload;

export type PerformanceMetricComparison = {
 metric: PerformanceMetricKey;
 current: number | null;
 baseline: number | null;
 delta: number | null;
 deltaPercent: number | null;
 relation: 'above' | 'below' | 'equal' | 'unavailable';
 baselineSource: 'operator-expectation' | 'channel-median' | 'none';
 baselineSampleSize: number;
};

export type PerformanceRetentionEvent = {
 type: 'drop' | 'peak';
 fromSecond: number;
 toSecond: number;
 deltaPercentPoints: number;
 fromAudiencePercent: number;
 toAudiencePercent: number;
};

export type PerformanceDiagnosis = {
 id: string;
 code:
  | 'packaging-underperforming-content-holding'
  | 'promise-attracts-delivery-loses'
  | 'topic-package-hook-all-under-pressure'
  | 'mid-video-drop'
  | 'interest-with-low-conversion';
 area: 'packaging' | 'hook' | 'topic' | 'audience' | 'mid-video' | 'cta';
 evidence: string[];
 hypothesis: string;
 competingExplanation: string;
 nextTest: string;
 confidence: 'low' | 'medium' | 'high';
};

export type PerformanceReportPayload = {
 kind: 'performance-report';
 id: string;
 channelId: string;
 episodeId: string;
 observationId: string;
 observedAt: string;
 comparisons: PerformanceMetricComparison[];
 retentionEvents: PerformanceRetentionEvent[];
 trafficSummary: Array<{
  source: string;
  views: number;
  viewSharePercent: number | null;
 }>;
 commentSummary: {
  sampledComments: number;
  totalLikesInSample: number;
 };
 diagnoses: PerformanceDiagnosis[];
 strongestSignals: string[];
 weakestSignals: string[];
 limitations: string[];
 handoff: {
  nextAgent: 'Learning Loop';
  question: 'Qual parte é evidência repetível e qual pode ser acaso?';
  candidateHypothesisIds: string[];
 };
 review: {
  notes: string;
 };
 createdAt: string;
 updatedAt: string;
};

export type PerformanceReport = PerformanceReportPayload & {
 version: number;
 status: 'draft' | 'review' | 'approved';
};

export type PerformanceReportVersion = {
 version: number;
 status: PerformanceReport['status'];
 payload: PerformanceReportPayload;
 createdAt: string;
};

export type AudienceSentiment = 'positive' | 'neutral' | 'negative' | 'mixed';
export type AudienceIntent =
  | 'praise'
  | 'question'
  | 'confusion'
  | 'request'
  | 'objection'
  | 'follow-up'
  | 'topic'
  | 'debate';

export type AudienceCommentClassification = {
 commentRef: string;
 sentiment: AudienceSentiment;
 intents: AudienceIntent[];
};

export type AudienceTheme = {
 id: string;
 kind: AudienceIntent;
 label: string;
 insight: string;
 commentRefs: string[];
 nextAction: string;
 confidence: 'low' | 'medium' | 'high';
 sampleSharePercent: number;
 totalLikesInEvidence: number;
};

export type AudienceIntelligencePayload = {
 kind: 'audience-intelligence';
 id: string;
 channelId: string;
 episodeId: string;
 performanceReportId: string;
 performanceReportVersion: number;
 observationId: string;
 externalVideoId?: string;
 sampleSize: number;
 analyzedCommentRefs: string[];
 sentimentSampleCounts: Record<AudienceSentiment,number>;
 classifications: AudienceCommentClassification[];
 themes: AudienceTheme[];
 limitations: string[];
 provenance: {
  model: string;
  sourceLabel: string;
 };
 review: {
  notes: string;
  approvedAt?: string;
  approvedBy?: 'operator';
 };
 createdAt: string;
 updatedAt: string;
};

export type AudienceIntelligenceReport = AudienceIntelligencePayload & {
 version: number;
 status: 'review' | 'approved';
};

export type AudienceIntelligenceVersion = {
 version: number;
 status: AudienceIntelligenceReport['status'];
 payload: AudienceIntelligencePayload;
 createdAt: string;
};

export type NextEpisodeCandidate = {
 id: string;
 workingTitle: string;
 theme: string;
 thesis: string;
 angle: string;
 promise: string;
 thumbnailConcept: string;
 targetAudience: string;
 objective: string;
 previousEpisodeConnection: string;
 arcId?: string;
 prerequisiteConcepts: string[];
 introducesConcepts: string[];
 reinforcesConcepts: string[];
 opensThreads: string[];
 resolvesThreads: string[];
 repetitionKeys: string[];
 evidenceRefs: string[];
 rationale: string;
 risks: string[];
 narrativeReady: boolean;
 blockers: string[];
 evidenceStrength: 'low' | 'medium' | 'high';
};

export type NextEpisodePlanPayload = {
 kind: 'next-episode-plan';
 id: string;
 channelId: string;
 brainVersion: number;
 generatedAt: string;
 context: {
  learningRefs: string[];
  threadRefs: string[];
  conceptRefs: string[];
  arcRefs: string[];
  recentEpisodeRefs: string[];
  marketSignal: 'linked-opportunity' | 'unavailable';
  evidenceSnapshot: Array<{
   ref: string;
   type: 'learning' | 'thread' | 'concept' | 'arc' | 'episode';
   summary: string;
   confidence?: 'low' | 'medium' | 'high';
  }>;
 };
 candidates: NextEpisodeCandidate[];
 recommendedCandidateId: string | null;
 recommendationRationale: string;
 limitations: string[];
 review: {
  notes: string;
  acceptedCandidateId?: string;
  acceptedEpisodeId?: string;
  acceptedContentProjectId?: string;
  acceptedAt?: string;
  acceptedBy?: 'operator';
 };
 updatedAt: string;
};

export type NextEpisodePlan = NextEpisodePlanPayload & {
 version: number;
 status: 'review' | 'accepted' | 'superseded';
};

export type NextEpisodePlanVersion = {
 version: number;
 status: NextEpisodePlan['status'];
 payload: NextEpisodePlanPayload;
 createdAt: string;
};

export type EpisodeAutomationMode = 'assisted' | 'autonomous';
export type EpisodeAutomationStatus = 'active' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type EpisodeAutomationStep =
 | 'content'
 | 'script'
 | 'voice'
 | 'transcript'
 | 'scenes'
 | 'visual-prompts'
 | 'visual-assets'
 | 'timeline'
 | 'video-edit'
 | 'render'
 | 'quality'
 | 'packaging'
 | 'publish'
 | 'done';
export type EpisodeAutomationStepState = {
 step: EpisodeAutomationStep;
 status: 'pending' | 'ready' | 'running' | 'waiting' | 'completed' | 'blocked' | 'failed' | 'skipped';
 label: string;
 entityId?: string;
 entityVersion?: number;
 reason?: string;
 requiresOperator: boolean;
};
export type EpisodeAutomationPolicy = {
 autoGenerateScript: boolean;
 autoApproveObjectiveGates: boolean;
 autoGenerateVoice: boolean;
 autoCreateTranscript: boolean;
 autoCreateScenes: boolean;
 autoGenerateVisualPrompts: boolean;
 autoGenerateVisualAssets: boolean;
 autoBuildTimeline: boolean;
 autoCreateVideoEdit: boolean;
 autoRender: boolean;
 autoRunQuality: boolean;
 autoCreatePackage: boolean;
 autoPublish: boolean;
};
export type EpisodeAutomationRunPayload = {
 kind: 'episode-automation-run';
 id: string;
 channelId: string;
 episodeId: string;
 contentProjectId: string;
 mode: EpisodeAutomationMode;
 policy: EpisodeAutomationPolicy;
 steps: EpisodeAutomationStepState[];
 currentStep: EpisodeAutomationStep;
 blockers: string[];
 lastDecision: string;
 createdAt: string;
 updatedAt: string;
};
export type EpisodeAutomationRun = EpisodeAutomationRunPayload & {
 status: EpisodeAutomationStatus;
 attempts: number;
 lastError?: string;
 holdStep?: EpisodeAutomationStep;
 holdReason?: string;
 holdCreatedAt?: string;
};
export type EpisodeAutomationEvent = {
 id: number;
 runId: string;
 step: EpisodeAutomationStep;
 status: 'info' | 'started' | 'completed' | 'waiting' | 'blocked' | 'failed';
 message: string;
 payload: Record<string,unknown>;
 createdAt: string;
};
export type Settings = { queries: string[]; languages: string[]; minViews: number; maxVideoAgeHours: number; maxChannelVideos: number; maxChannelAgeDays: number; enabled: boolean; autoAnalyze: boolean; maxAnalysesPerRun: number; analysisModel: string; scriptModel: string };
export type Integration = { id: string; name: string; configured: boolean; detail: string };
export type RadarData = { mode: 'demo' | 'live'; channels: Channel[]; universeCompetitors?: UniverseCompetitor[]; universeMarketIntelligence?: UniverseMarketIntelligence | null; universeQueue?: UniverseImportQueueSummary | null; channelStudies: ChannelStudy[]; opportunityReports?: OpportunityReport[]; missionBrief?: MissionBrief | null; youtubeSearchBudget?: YouTubeSearchBudgetState | null; gaps: GapOpportunity[]; managedChannels: ManagedChannel[]; channelBrains?: ChannelBrain[]; decisions: Decision[]; contexts: ResearchContext[]; scripts: Script[]; runs: Run[]; settings: Settings; integrations: Integration[]; authenticated: boolean; authConfigured: boolean; lastUpdated: string | null; policyApproved: boolean };
export const defaultSettings: Settings = { queries: ['animated history', '3d animation engineering', 'animated storytelling', 'animated science explained', 'animated military history'], languages: ['en'], minViews: 500000, maxVideoAgeHours: 72, maxChannelVideos: 20, maxChannelAgeDays: 180, enabled: false, autoAnalyze: false, maxAnalysesPerRun: 6, analysisModel: 'gpt-5.6-terra', scriptModel: 'gpt-5.6-sol' };


export type OwnedMediaAsset = {
 id:string;
 assetKind:'image'|'video';
 status:'uploading'|'ready'|'failed';
 sourceType:'owned';
 storagePath:string;
 mimeType:string;
 originalName:string;
 bytes:number;
 width:number|null;
 height:number|null;
 durationSeconds:number|null;
 title:string;
 tags:string[];
 semantic:{
  subjects:string[];
  locations:string[];
  periods:string[];
  countries:string[];
  regions:string[];
  cities:string[];
  districts:string[];
  landmarks:string[];
  scenes:string[];
  objects:string[];
  activities:string[];
  people:string[];
  timeOfDay:string[];
  weather:string[];
  seasons:string[];
  shotTypes:string[];
  cameraMotion:string[];
  moods:string[];
 };
 signedUrl:string|null;
 etag?:string;
 createdAt:string;
 updatedAt:string;
};

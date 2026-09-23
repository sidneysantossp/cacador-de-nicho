import { z } from 'zod';
export const modelIds=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'] as const;
export const modelSchema=z.enum(modelIds);
export const managedChannelSchema=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(2).max(100),niche:z.string().trim().min(2).max(80),format:z.string().trim().min(2).max(80),stage:z.enum(['idea','research','production','published','paused']),priority:z.enum(['high','normal','low']),description:z.string().trim().max(1000),sourceChannelId:z.string().max(100).optional(),opportunityId:z.string().max(150).optional()}).strict();
const shortList=(maxItems:number,maxLength=300)=>z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
export const channelBrainPayloadSchema=z.object({
 kind:z.literal('channel-brain'),
 channelId:z.string().uuid(),
 constitution:z.object({
  premise:z.string().trim().max(4000),
  audience:z.string().trim().max(2500),
  editorialPromise:z.string().trim().max(2500),
  worldview:z.string().trim().max(4000),
  tone:shortList(16,160),
  languageRules:shortList(30,500),
  humor:shortList(16,500),
  universeRules:shortList(30,500),
  forbidden:shortList(30,500),
  metaphors:shortList(30,500)
 }).strict(),
 characters:z.array(z.object({
  id:z.string().trim().min(1).max(80),
  name:z.string().trim().min(1).max(120),
  role:z.string().trim().max(600),
  traits:shortList(20,200),
  knows:shortList(60,300),
  doesNotKnow:shortList(60,300),
  rules:shortList(40,400)
 }).strict()).max(20),
 narrative:z.object({
  currentArc:z.string().trim().max(1000),
  stateSummary:z.string().trim().max(5000),
  lastEpisodeId:z.string().trim().max(180).optional(),
  establishedConcepts:shortList(120,300),
  partialConcepts:shortList(120,300),
  unknownConcepts:shortList(120,300),
  openThreads:shortList(120,600),
  resolvedThreads:shortList(120,600),
  doNotRepeat:shortList(120,600),
  nextConcepts:shortList(120,400)
 }).strict(),
 learnings:z.array(z.object({
  id:z.string().trim().min(1).max(120),
  type:z.enum(['audience','performance','editorial','production','operator']),
  statement:z.string().trim().min(1).max(1200),
  evidence:shortList(30,600),
  confidence:z.enum(['low','medium','high']),
  createdAt:z.string().datetime()
 }).strict()).max(300),
 createdAt:z.string().datetime(),
 updatedAt:z.string().datetime()
}).strict();
export const contentArcSchema=z.object({
 id:z.string().uuid(),
 channelId:z.string().uuid(),
 sequence:z.number().int().min(1).max(10000),
 status:z.enum(['planned','active','completed','paused']),
 name:z.string().trim().min(1).max(180),
 objective:z.string().trim().max(4000),
 premise:z.string().trim().max(4000),
 prerequisiteConcepts:shortList(100,120),
 targetConcepts:shortList(100,120),
 notes:shortList(100,600),
 createdAt:z.string().datetime(),
 updatedAt:z.string().datetime()
}).strict();
export const channelEpisodeSchema=z.object({
 id:z.string().uuid(),
 channelId:z.string().uuid(),
 arcId:z.string().uuid().optional(),
 sequence:z.number().int().min(1).max(100000),
 status:z.enum(['idea','planned','scripted','producing','published','archived']),
 title:z.string().trim().min(1).max(300),
 thesis:z.string().trim().max(5000),
 narrativeSummary:z.string().trim().max(5000),
 prerequisiteConcepts:shortList(100,120),
 introducesConcepts:shortList(100,120),
 reinforcesConcepts:shortList(100,120),
 opensThreads:shortList(100,600),
 resolvesThreads:shortList(100,600),
 repetitionKeys:shortList(100,300),
 youtubeVideoId:z.string().trim().max(120).optional(),
 publishedAt:z.string().datetime().optional(),
 createdAt:z.string().datetime(),
 updatedAt:z.string().datetime()
}).strict();
export const channelConceptSchema=z.object({
 id:z.string().uuid(),
 channelId:z.string().uuid(),
 key:z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/),
 label:z.string().trim().min(1).max(180),
 description:z.string().trim().max(3000),
 status:z.enum(['unknown','introduced','partial','established','retired']),
 prerequisiteKeys:shortList(100,120),
 introducedEpisodeId:z.string().uuid().optional(),
 establishedEpisodeId:z.string().uuid().optional(),
 createdAt:z.string().datetime(),
 updatedAt:z.string().datetime()
}).strict();
export const settingsSchema=z.object({queries:z.array(z.string().trim().min(2).max(100)).min(1).max(5),languages:z.tuple([z.literal('en')]),minViews:z.number().int().min(1000).max(1000000000),maxVideoAgeHours:z.number().int().min(1).max(168),maxChannelVideos:z.number().int().min(1).max(1000),maxChannelAgeDays:z.number().int().min(1).max(3650),enabled:z.boolean(),autoAnalyze:z.boolean(),maxAnalysesPerRun:z.number().int().min(0).max(12),analysisModel:modelSchema,scriptModel:modelSchema}).strict();
export function observedWithinWindow(publishedAt:string,observedAt:string,views:number,minViews:number,maxHours:number){ const age=Date.parse(observedAt)-Date.parse(publishedAt); return Number.isFinite(age)&&age>=0&&age<maxHours*3600000&&views>=minViews; }

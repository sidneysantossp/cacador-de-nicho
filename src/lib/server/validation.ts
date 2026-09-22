import { z } from 'zod';
export const modelIds=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-6-astra'] as const;
export const modelSchema=z.enum(modelIds);
export const settingsSchema=z.object({queries:z.array(z.string().trim().min(2).max(100)).min(1).max(5),languages:z.tuple([z.literal('en')]),minViews:z.number().int().min(1000).max(1000000000),maxVideoAgeHours:z.number().int().min(1).max(168),maxChannelVideos:z.number().int().min(1).max(1000),maxChannelAgeDays:z.number().int().min(1).max(3650),enabled:z.boolean(),autoAnalyze:z.boolean(),maxAnalysesPerRun:z.number().int().min(0).max(12),analysisModel:modelSchema,scriptModel:modelSchema}).strict();
export function observedWithinWindow(publishedAt:string,observedAt:string,views:number,minViews:number,maxHours:number){ const age=Date.parse(observedAt)-Date.parse(publishedAt); return Number.isFinite(age)&&age>=0&&age<maxHours*3600000&&views>=minViews; }

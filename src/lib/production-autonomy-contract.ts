import type { ProductionAutonomyAssessment, ProductionAutonomyInput } from './production-autonomy-policy';

export type ProductionAutonomySubject = {
 subjectType:'universe-gap'|'opportunity-report'|'next-episode';
 subjectId:string;
 candidateId?:string;
};
export type StoredProductionAutonomy = ProductionAutonomyAssessment & {
 id:string;
 subject:ProductionAutonomySubject;
 sourceFingerprint:string;
 createdAt:string;
 expiresAt:string;
 diagnostics:string[];
 input:ProductionAutonomyInput;
};
export type ProductionAutonomyJob = {
 id:string;
 subject:ProductionAutonomySubject;
 status:'queued'|'processing'|'completed'|'failed';
 attempts:number;
 lastError?:string;
};
export function productionAutonomySubjectKey(subject:ProductionAutonomySubject){
 return JSON.stringify([subject.subjectType,subject.subjectId,subject.candidateId??null]);
}

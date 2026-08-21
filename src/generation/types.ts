import type { DocumentType, JobSlot } from "@/types/domain";

export type CareerAnalysisSource = {
  filename: string | null;
  documentType: DocumentType;
  jobId: string | null;
  chunkIndex: number;
  similarity: number;
};

export type CareerAnalysis = {
  answer: string;
  strengths: string[];
  skillGaps: string[];
  experienceAlignment: string;
  interviewPreparation: string[];
  recommendations: string[];
  sources: CareerAnalysisSource[];
};

export const SCORE_CATEGORIES = [
  "technicalSkillAlignment",
  "experienceAlignment",
  "domainAlignment",
  "leadershipSeniorityAlignment",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export type CategoryScores = Record<ScoreCategory, number>;

export type BestMatchResult = {
  categoryScores: CategoryScores;
  strengths: string[];
  skillGaps: string[];
  reasoning: string;
  jobId: string;
  jobSlot: JobSlot;
  score: number;
  sources: CareerAnalysisSource[];
};

export const DEFAULT_SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  technicalSkillAlignment: 0.4,
  experienceAlignment: 0.3,
  domainAlignment: 0.2,
  leadershipSeniorityAlignment: 0.1,
};

export function calculateWeightedScore(categoryScores: CategoryScores): number {
  const totalWeight = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + DEFAULT_SCORE_WEIGHTS[category],
    0,
  );
  const weightedSum = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + categoryScores[category] * DEFAULT_SCORE_WEIGHTS[category],
    0,
  );
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

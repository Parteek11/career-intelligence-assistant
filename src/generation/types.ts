import type { DocumentType } from "@/types/domain";

/**
 * The shape the LLM must return, before source metadata is attached.
 * Sources are never trusted from the model — they are built directly from
 * the retrieved evidence (see career-analysis.ts) so citations cannot be
 * hallucinated or mismatched.
 */
export type AnalysisModelOutput = {
  answer: string;
  strengths: string[];
  skillGaps: string[];
  experienceAlignment: string;
  interviewPreparation: string[];
  recommendations: string[];
};

export type CareerAnalysisSource = {
  filename: string | null;
  documentType: DocumentType;
  jobId: string | null;
  chunkIndex: number;
  similarity: number;
};

export type CareerAnalysis = AnalysisModelOutput & {
  sources: CareerAnalysisSource[];
};

export type GroundedPrompt = {
  system: string;
  user: string;
};

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export interface AnalysisLLMProvider {
  generate(prompt: GroundedPrompt): Promise<string>;
  readonly model?: string;
  readonly lastUsage?: TokenUsage | null;
}

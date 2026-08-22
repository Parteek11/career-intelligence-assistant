import type { CareerEvidenceItem } from "@/services/retrieval";

/**
 * Prompt builders for grounded career analysis.
 *
 * Both prompts follow the same contract:
 * - The system message lists hard rules (use only retrieved evidence, no
 *   invented experience, JSON-only response).
 * - The user message is the question plus a numbered evidence dump.
 *
 * Numbering `[1]`, `[2]`, … lets the model refer to chunks without us
 * asking it to invent citations. Source rows returned to the UI still
 * come from retrieval, not from whatever the model mentions.
 */

/**
 * Render retrieved chunks as labeled blocks the model can quote.
 *
 * Each block includes `document_type`, `job_id`, filename, chunk index,
 * and similarity so the model can tell a resume bullet from a JD
 * requirement. Mixing those up is the main hallucination we are trying
 * to prevent (e.g. treating a job requirement as candidate experience).
 */
function formatEvidence(evidence: CareerEvidenceItem[]): string {
  if (evidence.length === 0) {
    return "(no evidence retrieved)";
  }

  return evidence
    .map(
      (item, index) =>
        `[${index + 1}] document_type=${item.documentType} job_id=${item.jobId ?? "null"} ` +
        `filename=${item.filename ?? "unknown"} chunk_index=${item.chunkIndex} ` +
        `similarity=${item.similarity.toFixed(4)}\ncontent: ${item.content}`,
    )
    .join("\n\n");
}

/**
 * Build the Analyze prompt: free-form career question → structured JSON.
 *
 * Rule 5 ("do not treat a missed retrieval as proof a skill is absent")
 * is intentional: top-K search is incomplete, so a missing keyword is
 * not evidence the candidate lacks that skill. The model should say
 * "insufficient evidence" instead of "the candidate has never done X".
 */
export function buildAnalysisPrompt(question: string, evidence: CareerEvidenceItem[]) {
  const system = [
    "You are the Career Intelligence Assistant. Compare a candidate's resume against job description evidence.",
    "Rules:",
    "1. Use ONLY the retrieved evidence. Do not use outside knowledge.",
    "2. Never invent the candidate's experience or skills.",
    "3. Do not present a job requirement as something the candidate has done.",
    '4. If evidence is missing, say "insufficient evidence" instead of guessing.',
    "5. Do not treat a missed retrieval as proof a skill is absent.",
    "6. Respond with a single JSON object and nothing else:",
    `{
  "answer": string,
  "strengths": string[],
  "skillGaps": string[],
  "experienceAlignment": string,
  "interviewPreparation": string[],
  "recommendations": string[]
}`,
  ].join("\n");

  const user = `Question: ${question}\n\nRetrieved evidence (use only this):\n${formatEvidence(evidence)}`;
  return { system, user };
}

/**
 * Build the Best Match prompt for *one* job.
 *
 * The model scores four categories 0–100. It is told not to emit an
 * overall score — `calculateWeightedScore` in TypeScript combines them
 * with fixed weights so ranking cannot be gamed by a generous model.
 * Thin evidence should produce low-to-moderate scores, not 90+.
 */
export function buildBestMatchPrompt(evidence: CareerEvidenceItem[]) {
  const system = [
    "You are scoring how well a candidate's resume matches ONE specific job, using only the retrieved evidence.",
    "Rules:",
    "1. Use ONLY the retrieved evidence.",
    "2. Never invent experience or skills.",
    "3. Score each category from 0 to 100. If evidence is thin, use a low-to-moderate score.",
    "4. Do not report one overall score — application code will combine the categories.",
    "5. Respond with a single JSON object and nothing else:",
    `{
  "categoryScores": {
    "technicalSkillAlignment": number,
    "experienceAlignment": number,
    "domainAlignment": number,
    "leadershipSeniorityAlignment": number
  },
  "strengths": string[],
  "skillGaps": string[],
  "reasoning": string
}`,
  ].join("\n");

  const user = `Score the candidate's fit for this one job using only the evidence below.\n\nRetrieved evidence (use only this):\n${formatEvidence(evidence)}`;
  return { system, user };
}

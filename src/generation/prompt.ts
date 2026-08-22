import { INVALID_QUESTION_MESSAGE } from "@/generation/question";
import type { CareerEvidenceItem } from "@/services/retrieval";
import type { JobSlot } from "@/types/domain";

/** Job row used to label evidence and to tell Ask which slots are in scope. */
export type PromptJob = {
  id: string;
  slot: JobSlot;
  filename: string;
};

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
function jobScopeLabel(item: CareerEvidenceItem, jobs: PromptJob[]): string {
  if (item.documentType === "resume" || !item.jobId) return "resume";
  const job = jobs.find((candidate) => candidate.id === item.jobId);
  if (!job) return `job_id=${item.jobId}`;
  return `Job ${job.slot} (${job.filename})`;
}

function formatEvidence(evidence: CareerEvidenceItem[], jobs: PromptJob[] = []): string {
  if (evidence.length === 0) {
    return "(no evidence retrieved)";
  }

  return evidence
    .map((item, index) => {
      const job = jobScopeLabel(item, jobs);
      return (
        `[${index + 1}] document_type=${item.documentType} job=${job} ` +
        `job_id=${item.jobId ?? "null"} filename=${item.filename ?? "unknown"} ` +
        `chunk_index=${item.chunkIndex} similarity=${item.similarity.toFixed(4)}\n` +
        `content: ${item.content}`
      );
    })
    .join("\n\n");
}

function formatJobCatalog(jobs: PromptJob[]): string {
  if (jobs.length === 0) return "(no jobs in scope)";
  return jobs.map((job) => `- Job ${job.slot}: ${job.filename} (job_id=${job.id})`).join("\n");
}

/**
 * Build the Ask prompt: answer the user's question only.
 *
 * Unlike Analyze, this must not dump a full resume-vs-JD report. When
 * several jobs are in scope, the model is told to answer per job so a
 * question like "what skill missing" cannot collapse into one blended
 * paragraph. Incomplete fragments must return INVALID_QUESTION_MESSAGE.
 */
export function buildAskPrompt(input: {
  question: string;
  evidence: CareerEvidenceItem[];
  jobs: PromptJob[];
  perJob: boolean;
}) {
  const perJobRule = input.perJob
    ? [
        "7. Multiple jobs are in scope. You MUST fill jobAnswers with one object per job. Never merge jobs into one paragraph.",
        "8. Put each job's full answer only in that object's answer field. Leave the top-level answer empty.",
        "9. Write each job answer as short lines. For missing skills, put one skill per line instead of a comma-separated paragraph.",
        "10. If the question names a job number (Job 1–4) or a JD filename, include only that job in jobAnswers.",
        "11. If it is unclear which job was meant, include every job in scope in jobAnswers.",
      ]
    : [
        "7. Answer only for the single job in scope. Put the reply in answer and use an empty jobAnswers array.",
      ];

  const system = [
    "You are the Career Intelligence Assistant. Answer one user question from retrieved resume and job-description evidence.",
    "Rules:",
    "1. Use ONLY the retrieved evidence. Do not use outside knowledge.",
    "2. Never invent the candidate's experience or skills.",
    "3. Do not present a job requirement as something the candidate has done.",
    "4. Answer ONLY the asked question. Do not produce a full resume-vs-JD analysis (no strengths/gaps/interview-prep report unless that is what was asked).",
    `5. If the user input is incomplete, fragmentary, or not a real question — examples: "what", "what should", "skills", "what skills", "skills great", "experience" — set answer to exactly "${INVALID_QUESTION_MESSAGE}" and jobAnswers to [].`,
    `6. A short but complete ask such as "what skill missing" IS a valid question. Do not reject it.`,
    ...perJobRule,
    "12. Respond with a single JSON object and nothing else:",
    `{
  "answer": string,
  "jobAnswers": [
    { "jobSlot": 1, "filename": "example.pdf", "answer": "React is missing." }
  ]
}`,
    input.perJob
      ? 'Example: { "answer": "", "jobAnswers": [ { "jobSlot": 1, "filename": "frontend.pdf", "answer": "React is missing." }, { "jobSlot": 2, "filename": "backend.pdf", "answer": "Node is missing." } ] }'
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Question: ${input.question}`,
    "",
    "Jobs in scope:",
    formatJobCatalog(input.jobs),
    "",
    "Retrieved evidence (use only this):",
    formatEvidence(input.evidence, input.jobs),
  ].join("\n");

  return { system, user };
}

/**
 * Build the Analyze prompt: full resume-vs-JD comparison for ONE job.
 *
 * Analyze never uses the Ask text box. The task is always the same:
 * compare the uploaded resume against the selected job description.
 *
 * Rule 5 ("do not treat a missed retrieval as proof a skill is absent")
 * is intentional: top-K search is incomplete, so a missing keyword is
 * not evidence the candidate lacks that skill. The model should say
 * "insufficient evidence" instead of "the candidate has never done X".
 */
export function buildAnalysisPrompt(evidence: CareerEvidenceItem[], jobs: PromptJob[] = []) {
  const system = [
    "You are the Career Intelligence Assistant. Compare a candidate's resume against ONE selected job description.",
    "Rules:",
    "1. Use ONLY the retrieved evidence. Do not use outside knowledge.",
    "2. Never invent the candidate's experience or skills.",
    "3. Do not present a job requirement as something the candidate has done.",
    '4. If evidence is missing, say "insufficient evidence" instead of guessing.',
    "5. Do not treat a missed retrieval as proof a skill is absent.",
    "6. Ignore any user question. This is a full resume-vs-job comparison, not a Q&A.",
    "7. Respond with a single JSON object and nothing else:",
    `{
  "answer": string,
  "strengths": string[],
  "skillGaps": string[],
  "experienceAlignment": string,
  "interviewPreparation": string[],
  "recommendations": string[]
}`,
  ].join("\n");

  const user = `Compare the candidate's resume against this job description.\n\nRetrieved evidence (use only this):\n${formatEvidence(evidence, jobs)}`;
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

import { listJobs } from "@/db/queries";
import { completeJson } from "@/generation/llm";
import { parseAnalysisResponse, parseAskResponse, parseBestMatchResponse } from "@/generation/parse";
import { buildAnalysisPrompt, buildAskPrompt, buildBestMatchPrompt } from "@/generation/prompt";
import { splitJobAnswersFromText } from "@/generation/job-answers";
import { INVALID_QUESTION_MESSAGE, isCompleteQuestion } from "@/generation/question";
import {
  calculateWeightedScore,
  type BestMatchResult,
  type CareerAnalysis,
  type CareerAnalysisSource,
  type CareerAskJobAnswer,
  type CareerAskResult,
} from "@/generation/types";
import {
  retrieveCareerEvidence,
  type CareerEvidenceItem,
  type RetrievalTarget,
} from "@/services/retrieval";
import { isJobSlot, type JobSlot } from "@/types/domain";

/**
 * Analysis service: retrieve evidence, call Groq, attach sources.
 *
 * The LLM never sees the raw database and never computes the Best Match
 * overall score. Retrieval decides the evidence; TypeScript decides the
 * weighted score; the model only writes grounded JSON from the chunks.
 */

/**
 * Fixed query used for every Best Match job. Using the same wording for
 * all four slots means score differences come from the *job evidence*,
 * not from a different question embedding per slot.
 */
const BEST_MATCH_QUERY =
  "The candidate's technical skills, programming languages, frameworks, tools, projects, work experience, and education matched to the job's required qualifications and responsibilities.";

/**
 * Fixed retrieval query for Analyze. Wording is chosen so MiniLM scores
 * resume bullets (skills, projects, experience) as highly as JD
 * requirements. The previous phrasing ("job description", "skill gaps")
 * sat closer to JD language and let a long JD fill all top-K slots.
 * The LLM prompt is separate and still asks for a full comparison.
 */
export const DEFAULT_ANALYZE_QUERY =
  "The candidate's technical skills, programming languages, frameworks, tools, projects, work experience, and education matched to the job's required qualifications and responsibilities.";

/**
 * Strip chunk text before returning sources to the UI.
 * Citations need filename / type / job / index / similarity — not a second
 * copy of the prompt context.
 */
function toSource(item: CareerEvidenceItem): CareerAnalysisSource {
  return {
    filename: item.filename,
    documentType: item.documentType,
    jobId: item.jobId,
    chunkIndex: item.chunkIndex,
    similarity: item.similarity,
  };
}

function toPromptJobs(jobs: { id: string; slot: JobSlot; original_filename: string }[]) {
  return jobs.map((job) => ({ id: job.id, slot: job.slot, filename: job.original_filename }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsJobName(question: string, filename: string): boolean {
  const q = question.toLowerCase();
  const name = filename.toLowerCase();
  if (name.length >= 4 && q.includes(name)) return true;
  const stem = name.replace(/\.[^.]+$/, "");
  if (stem.length < 8) return false;
  return new RegExp(`\\b${escapeRegExp(stem)}\\b`, "i").test(question);
}

/**
 * If the question names a job slot ("job 2", "JD 1") or a JD filename,
 * return those uploaded jobs. Otherwise return every job in `jobs` so
 * Ask can answer per job when the target is All.
 */
function resolveJobsFromQuestion(
  question: string,
  jobs: { id: string; slot: JobSlot; original_filename: string }[],
): { id: string; slot: JobSlot; original_filename: string }[] {
  const q = question.toLowerCase();
  const slotMentions = new Set<JobSlot>();
  const slotPattern = /\b(?:job|jd|slot)\s*#?\s*([1-4])\b/gi;
  for (const match of q.matchAll(slotPattern)) {
    const slot = Number(match[1]);
    if (isJobSlot(slot)) slotMentions.add(slot);
  }

  const mentioned = jobs.filter((job) => slotMentions.has(job.slot) || mentionsJobName(question, job.original_filename));
  return mentioned.length > 0 ? mentioned : jobs;
}

/**
 * Retrieve resume + JD evidence for every job in scope.
 *
 * One global top-K over all JDs can drop a smaller job entirely. Asking
 * per job (then keeping resume chunks once) keeps each JD in the prompt
 * so "what skill missing" can be answered job-by-job.
 */
async function retrieveAskEvidence(
  query: string,
  jobs: { id: string; slot: JobSlot; original_filename: string }[],
): Promise<CareerEvidenceItem[]> {
  if (jobs.length === 1) {
    return retrieveCareerEvidence({ query, targetJobId: jobs[0].id });
  }

  const perJob = await Promise.all(
    jobs.map((job) => retrieveCareerEvidence({ query, targetJobId: job.id, topK: 6 })),
  );

  const resumeKeys = new Set<string>();
  const merged: CareerEvidenceItem[] = [];
  for (const items of perJob) {
    for (const item of items) {
      if (item.documentType === "resume") {
        const key = `${item.chunkIndex}:${item.content.slice(0, 48)}`;
        if (resumeKeys.has(key)) continue;
        resumeKeys.add(key);
      }
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Answer one career question against a chosen job (or all jobs).
 *
 * Pipeline:
 *   retrieve → buildAskPrompt → Groq JSON → parse → attach sources
 *
 * Retrieval always runs, including for incomplete questions, so the RAG
 * path stays the same. Incomplete fragments are forced to
 * INVALID_QUESTION_MESSAGE after generation.
 *
 * `sources` is always taken from the retrieved chunks, never from the
 * model, so the UI cannot show a citation the retriever did not return.
 */
export async function askCareerQuestion(input: {
  question: string;
  targetJobId: RetrievalTarget;
}): Promise<CareerAskResult> {
  const question = input.question.trim();
  const uploaded = await listJobs();
  const scopedJobs =
    input.targetJobId === "all"
      ? resolveJobsFromQuestion(question, uploaded)
      : uploaded.filter((job) => job.id === input.targetJobId);

  if (scopedJobs.length === 0) {
    throw new Error(
      "No evidence was retrieved. Upload a resume and at least one job description before asking questions.",
    );
  }

  const evidence = await retrieveAskEvidence(question, scopedJobs);
  if (evidence.length === 0) {
    throw new Error(
      "No evidence was retrieved. Upload a resume and at least one job description before asking questions.",
    );
  }

  const prompt = buildAskPrompt({
    question,
    evidence,
    jobs: toPromptJobs(scopedJobs),
    perJob: scopedJobs.length > 1,
  });

  let answer = "";
  let jobAnswers: CareerAskJobAnswer[] = [];
  try {
    const modelOutput = parseAskResponse(await completeJson(prompt.system, prompt.user));
    if (!isCompleteQuestion(question)) {
      return { answer: INVALID_QUESTION_MESSAGE, jobAnswers: [], sources: evidence.map(toSource) };
    }
    answer = modelOutput.answer;
    jobAnswers = modelOutput.jobAnswers;
  } catch (error) {
    if (!isCompleteQuestion(question)) {
      return { answer: INVALID_QUESTION_MESSAGE, jobAnswers: [], sources: evidence.map(toSource) };
    }
    throw error;
  }

  if (scopedJobs.length > 1 && jobAnswers.length < 2) {
    const split = splitJobAnswersFromText(answer);
    if (split.length >= 2) jobAnswers = split;
  }

  jobAnswers = jobAnswers
    .map((item) => {
      const job = scopedJobs.find((candidate) => candidate.slot === item.jobSlot);
      return {
        ...item,
        filename: item.filename || job?.original_filename || null,
      };
    })
    .sort((a, b) => a.jobSlot - b.jobSlot);

  if (jobAnswers.length > 1) answer = "";

  return { answer, jobAnswers, sources: evidence.map(toSource) };
}

/**
 * Full resume-vs-JD analysis for one job.
 *
 * Pipeline:
 *   retrieveCareerEvidence → buildAnalysisPrompt → Groq JSON → parse → attach sources
 */
export async function analyzeCareerFit(input: {
  targetJobId: string;
  topK?: number;
}): Promise<CareerAnalysis> {
  const jobs = await listJobs();
  const scopedJobs = jobs.filter((job) => job.id === input.targetJobId);
  const evidence = await retrieveCareerEvidence({
    query: DEFAULT_ANALYZE_QUERY,
    targetJobId: input.targetJobId,
    topK: input.topK,
  });
  if (evidence.length === 0) {
    throw new Error(
      "No evidence was retrieved. Upload a resume and at least one job description before analyzing.",
    );
  }

  const prompt = buildAnalysisPrompt(evidence, toPromptJobs(scopedJobs));
  const modelOutput = parseAnalysisResponse(await completeJson(prompt.system, prompt.user));
  return { ...modelOutput, sources: evidence.map(toSource) };
}

/**
 * Score every uploaded job independently, then sort high → low.
 *
 * Isolation matters: each job gets its own retrieve + generate call with
 * `targetJobId = job.id`. That is what stops Job 2's requirements from
 * leaking into Job 1's score. A job with no JD chunks is skipped rather
 * than scored from resume-only evidence (which would look like a match).
 *
 * `calculateWeightedScore` runs in this process with fixed weights so the
 * model cannot inflate one overall number.
 */
export async function findBestMatch(): Promise<BestMatchResult[]> {
  const jobs = await listJobs();
  if (jobs.length === 0) {
    throw new Error(
      "No job descriptions have been uploaded yet. Upload at least one job before running Best Match.",
    );
  }

  const results: BestMatchResult[] = [];

  for (const job of jobs) {
    const evidence = await retrieveCareerEvidence({
      query: BEST_MATCH_QUERY,
      targetJobId: job.id,
    });
    if (!evidence.some((item) => item.documentType === "job_description")) {
      continue;
    }

    const prompt = buildBestMatchPrompt(evidence);
    const modelOutput = parseBestMatchResponse(await completeJson(prompt.system, prompt.user));
    results.push({
      ...modelOutput,
      jobId: job.id,
      jobSlot: job.slot,
      score: calculateWeightedScore(modelOutput.categoryScores),
      sources: evidence.map(toSource),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

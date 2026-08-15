import type { CareerEvidenceItem } from "@/services/retrieval";
import type { GroundedPrompt } from "@/generation/types";

const RESPONSE_SHAPE = `{
  "categoryScores": {
    "technicalSkillAlignment": number,
    "experienceAlignment": number,
    "domainAlignment": number,
    "leadershipSeniorityAlignment": number
  },
  "strengths": string[],
  "skillGaps": string[],
  "reasoning": string
}`;

const SYSTEM_RULES = [
  "You are the Career Intelligence Assistant. You are scoring how well a candidate's resume matches ONE specific job, using only the retrieved evidence below.",
  "",
  "You must follow these rules strictly:",
  "1. Use ONLY the retrieved evidence provided in the user message. Do not use outside knowledge about the candidate, the company, or the role.",
  "2. Never invent, assume, or embellish the candidate's experience, skills, or achievements beyond what the resume evidence states.",
  "3. Clearly distinguish candidate evidence (document_type=resume) from job requirements (document_type=job_description).",
  '4. Score each category from 0 to 100 based only on the evidence: 0 means the evidence shows no support at all or directly contradicts the requirement; 100 means the evidence strongly and directly supports it. If the evidence is too thin to judge a category confidently, use a low-to-moderate score (do not guess a high score) and say so in "reasoning".',
  "5. Do not assume a skill is definitely absent just because it was not retrieved — reflect that uncertainty in the score and in the reasoning rather than scoring as if it were confirmed absent.",
  "6. Score the four categories independently. Do not compute or report one overall score yourself — application code combines the categories.",
  "7. Respond with a single strict JSON object and nothing else — no markdown code fences, no commentary before or after — matching exactly this shape:",
  RESPONSE_SHAPE,
  "",
  'Category meaning: "technicalSkillAlignment" is alignment on the specific technical skills/tools the job requires; "experienceAlignment" is alignment on the years/type of relevant work experience; "domainAlignment" is alignment on industry or domain knowledge; "leadershipSeniorityAlignment" is alignment on seniority, mentoring, or leadership expectations. "strengths" lists resume-evidenced strengths relevant to this job; "skillGaps" lists job requirements not evidenced in the resume, or notes insufficient evidence where unclear; "reasoning" is a short paragraph explaining the category scores.',
].join("\n");

/**
 * Builds the prompt for scoring ONE job against the resume. Kept separate
 * from buildGroundedPrompt (the Q&A prompt) because the response shape and
 * rules are different — per-category scores instead of a free-form answer.
 * Each job gets its own call to this function and its own evidence set;
 * jobs are never combined into a single prompt.
 */
export function buildBestMatchPrompt(evidence: CareerEvidenceItem[]): GroundedPrompt {
  const evidenceBlock =
    evidence.length === 0
      ? "(no evidence retrieved)"
      : evidence.map((item, index) => formatEvidenceItem(item, index + 1)).join("\n\n");

  const user = [
    "Score the candidate's fit for this one job using only the evidence below.",
    "",
    "Retrieved evidence (use only this):",
    evidenceBlock,
  ].join("\n");

  return { system: SYSTEM_RULES, user };
}

function formatEvidenceItem(item: CareerEvidenceItem, position: number): string {
  return [
    `[${position}] document_type=${item.documentType} job_id=${item.jobId ?? "null"} ` +
      `filename=${item.filename ?? "unknown"} chunk_index=${item.chunkIndex} ` +
      `similarity=${item.similarity.toFixed(4)}`,
    `content: ${item.content}`,
  ].join("\n");
}

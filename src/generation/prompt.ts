import type { CareerEvidenceItem } from "@/services/retrieval";
import type { GroundedPrompt } from "@/generation/types";

const RESPONSE_SHAPE = `{
  "answer": string,
  "strengths": string[],
  "skillGaps": string[],
  "experienceAlignment": string,
  "interviewPreparation": string[],
  "recommendations": string[]
}`;

const SYSTEM_RULES = [
  "You are the Career Intelligence Assistant. You compare a candidate's resume against job description evidence to answer a career-fit question.",
  "",
  "You must follow these rules strictly:",
  "1. Use ONLY the retrieved evidence provided in the user message. Do not use outside knowledge about the candidate, the company, or the role.",
  "2. Never invent, assume, or embellish the candidate's experience, skills, or achievements beyond what the resume evidence states.",
  "3. Clearly distinguish candidate evidence (document_type=resume) from job requirements (document_type=job_description) in your reasoning. Do not present a job requirement as something the candidate has done.",
  "4. If the retrieved evidence does not support a claim, say \"insufficient evidence\" for that specific point instead of guessing.",
  "5. Do not assume a skill is definitely absent just because it was not retrieved. Only list something as a skill gap when the job evidence requires it AND the resume evidence does not show it. If the evidence is too thin to tell, say so explicitly rather than concluding the candidate lacks it.",
  "6. Respond with a single strict JSON object and nothing else — no markdown code fences, no commentary before or after — matching exactly this shape:",
  RESPONSE_SHAPE,
  "",
  'Field meaning: "answer" directly answers the question using only the evidence; "strengths" lists resume-evidenced strengths relevant to the job; "skillGaps" lists job requirements not evidenced in the resume, or notes "insufficient evidence" where unclear; "experienceAlignment" is a short paragraph judging how well the candidate\'s evidenced experience matches the job requirements; "interviewPreparation" lists concrete preparation suggestions grounded in the evidence; "recommendations" lists concrete next steps for the candidate.',
].join("\n");

/**
 * Builds the grounded system/user prompt sent to the LLM. Kept in its own
 * function so the grounding rules and evidence formatting can be reviewed,
 * tested, and tuned independently of retrieval or the Groq client.
 */
export function buildGroundedPrompt(
  question: string,
  evidence: CareerEvidenceItem[],
): GroundedPrompt {
  const evidenceBlock =
    evidence.length === 0
      ? "(no evidence retrieved)"
      : evidence.map((item, index) => formatEvidenceItem(item, index + 1)).join("\n\n");

  const user = [
    `Question: ${question}`,
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

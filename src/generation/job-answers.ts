import type { CareerAskJobAnswer } from "@/generation/types";
import { isJobSlot, type JobSlot } from "@/types/domain";

/**
 * Split a model paragraph like
 * "Job 1 (a.pdf): React is missing. Job 2 (b.pdf): Node is missing."
 * into one block per job. Used when Groq concatenates jobs, and by the
 * UI as a display fallback. Filename parentheses may nest (e.g. "L4 (4).pdf").
 */
export function splitJobAnswersFromText(answer: string): CareerAskJobAnswer[] {
  const blocks = answer.split(/(?=Job\s+[1-4]\b)/i).map((block) => block.trim()).filter(Boolean);
  const answers: CareerAskJobAnswer[] = [];

  for (const block of blocks) {
    const match = block.match(/^Job\s+([1-4])(?:\s*\((.*)\))?\s*:\s*([\s\S]*)$/i);
    if (!match) continue;
    const slot = Number(match[1]);
    if (!isJobSlot(slot)) continue;
    const text = (match[3] ?? "").trim().replace(/[.;]+$/, "").trim();
    if (!text) continue;
    answers.push({
      jobSlot: slot as JobSlot,
      filename: match[2]?.trim() || null,
      answer: text,
    });
  }

  return answers;
}

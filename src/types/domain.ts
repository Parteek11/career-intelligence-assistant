export const JOB_SLOTS = [1, 2, 3, 4] as const;
export type JobSlot = (typeof JOB_SLOTS)[number];

export function isJobSlot(value: number): value is JobSlot {
  return (JOB_SLOTS as readonly number[]).includes(value);
}

export type DocumentType = "resume" | "job_description";

/** Dimension of Xenova/all-MiniLM-L6-v2 embeddings. */
export const EMBEDDING_DIMENSIONS = 384 as const;

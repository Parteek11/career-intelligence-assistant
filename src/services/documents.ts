import type { Document } from "@langchain/core/documents";
import {
  deleteAllJobs,
  deleteJobBySlot,
  deleteResume as deleteResumeRow,
  replaceDocumentChunks,
  upsertJobDocument,
  upsertJobForSlot,
  upsertResume,
  upsertResumeDocument,
} from "@/db/queries";
import { embeddings } from "@/rag/embed";
import { ingestFile, type IngestionFile } from "@/rag/ingest";
import { isJobSlot, type JobSlot } from "@/types/domain";

/**
 * Document service: the write path of RAG.
 *
 * Upload flow for both resume and job descriptions:
 *   1. Upsert the parent row (`resumes` / `jobs`) and its `documents` row.
 *   2. `ingestFile` — load, clean, split into overlapping chunks.
 *   3. Embed every chunk with the same MiniLM model used at query time.
 *   4. `replaceDocumentChunks` — delete the previous vectors and insert the new ones
 *      in one transaction so a failed re-upload never leaves a half-written corpus.
 *
 * Re-uploading a slot always replaces that slot's chunks. Identity is the
 * job *slot* (1–4) or the single resume row, never the filename.
 */

export type UploadFile = IngestionFile;

export type UploadSummary = {
  documentId: string;
  chunkCount: number;
};

export type JobUploadSummary = UploadSummary & {
  jobId: string;
};

/**
 * Map LangChain chunks + their embedding vectors onto the DB insert shape.
 *
 * `chunk_index` is taken from ingestion metadata when present so a later
 * re-split with the same settings keeps stable indices. `page_number` is
 * optional — text files have none.
 */
async function persistChunks(
  documentId: string,
  chunks: Document[],
  vectors: number[][],
): Promise<number> {
  return replaceDocumentChunks(
    documentId,
    chunks.map((chunk, index) => ({
      chunkIndex: typeof chunk.metadata.chunk_index === "number" ? chunk.metadata.chunk_index : index,
      content: chunk.pageContent,
      embedding: vectors[index],
      metadata: {
        original_filename: chunk.metadata.original_filename,
        page_number: chunk.metadata.page_number,
      },
    })),
  );
}

/**
 * Shared ingest → embed → persist step used by both resume and JD uploads.
 * An empty file produces zero vectors and still replaces existing chunks,
 * which is how a blank re-upload clears stale evidence.
 */
async function ingestAndPersist(
  file: UploadFile,
  meta: {
    documentId: string;
    documentType: "resume" | "job_description";
    jobId: string | null;
    originalFilename: string;
  },
): Promise<UploadSummary> {
  const chunks = await ingestFile(file, meta);
  const vectors = chunks.length === 0 ? [] : await embeddings.embedDocuments(
    chunks.map((chunk) => chunk.pageContent),
  );
  const chunkCount = await persistChunks(meta.documentId, chunks, vectors);
  return { documentId: meta.documentId, chunkCount };
}

/**
 * Create or replace the single app resume, then ingest its file.
 * `jobId` is always `null` — resume chunks must not attach to a job slot.
 */
export async function uploadResume(file: UploadFile): Promise<UploadSummary> {
  const resume = await upsertResume(file.filename);
  const document = await upsertResumeDocument({
    resumeId: resume.id,
    originalFilename: file.filename,
    mimeType: file.mimeType ?? "application/octet-stream",
    fileSize: file.buffer.length,
  });

  return ingestAndPersist(file, {
    documentId: document.id,
    documentType: "resume",
    jobId: null,
    originalFilename: file.filename,
  });
}

/** Delete the resume row; `ON DELETE CASCADE` removes its document and chunks. */
export async function deleteResume(): Promise<void> {
  await deleteResumeRow();
}

/**
 * Create or replace the job in `slot` (1–4) and ingest its description.
 * The returned `jobId` is the UUID retrieval uses as a metadata filter.
 */
export async function uploadJobDescription(
  slot: JobSlot,
  file: UploadFile,
): Promise<JobUploadSummary> {
  if (!isJobSlot(slot)) {
    throw new Error(`Invalid job slot: ${slot}. Must be 1, 2, 3, or 4.`);
  }

  const job = await upsertJobForSlot(slot, file.filename);
  const document = await upsertJobDocument({
    jobId: job.id,
    originalFilename: file.filename,
    mimeType: file.mimeType ?? "text/plain",
    fileSize: file.buffer.length,
  });

  const summary = await ingestAndPersist(file, {
    documentId: document.id,
    documentType: "job_description",
    jobId: job.id,
    originalFilename: file.filename,
  });

  return { ...summary, jobId: job.id };
}

/** Delete one job slot; cascade removes its document and chunks. */
export async function deleteJobDescription(slot: JobSlot): Promise<void> {
  await deleteJobBySlot(slot);
}

/** Wipe resume + all four jobs. Used by the UI "Clear all" action and eval cleanup. */
export async function clearAll(): Promise<void> {
  await deleteResumeRow();
  await deleteAllJobs();
}

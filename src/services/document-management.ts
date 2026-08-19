import "server-only";

import type { Pool } from "pg";
import { DatabaseError } from "@/db/errors";
import { getDocumentByJobId, getDocumentByResumeId, upsertJobDocument, upsertResumeDocument } from "@/db/repositories/documents";
import { deleteAllJobs, deleteJobBySlot, upsertJobForSlot } from "@/db/repositories/jobs";
import { deleteResume as deleteResumeRow, upsertResume } from "@/db/repositories/resumes";
import { embedChunks } from "@/rag/embedding/embed-chunks";
import type { EmbeddingProvider } from "@/rag/embedding/types";
import type { ChunkingConfig } from "@/rag/types";
import { ingestUploadedDocument } from "@/services/ingestion";
import { persistIngestedChunks } from "@/services/chunk-persistence";
import { isJobSlot, type JobSlot } from "@/types/domain";

export type UploadFile = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

export type DocumentManagementDependencies = {
  pool?: Pool;
  embeddingProvider?: EmbeddingProvider;
  /** Evaluation-only override. Production callers omit this and keep 900/120. */
  chunking?: Partial<ChunkingConfig>;
};

export type UploadSummary = {
  documentId: string;
  chunkCount: number;
};

export type JobUploadSummary = UploadSummary & {
  jobId: string;
};

/**
 * Uploads (or replaces) the single resume. The resume row and its document
 * row are reused across re-uploads, so only the content and chunks change
 * — see upsertResume / upsertResumeDocument / persistIngestedChunks, which
 * together replace chunks/embeddings cleanly (delete-then-insert in one
 * transaction).
 */
export async function uploadResume(
  file: UploadFile,
  dependencies: DocumentManagementDependencies = {},
): Promise<UploadSummary> {
  const resume = await upsertResume(file.filename, dependencies.pool);
  const document = await upsertResumeDocument(
    {
      resumeId: resume.id,
      originalFilename: file.filename,
      mimeType: file.mimeType ?? "application/octet-stream",
      fileSize: file.buffer.length,
    },
    dependencies.pool,
  );

  return ingestAndPersist(
    {
      documentId: document.id,
      documentType: "resume",
      jobId: null,
      originalFilename: file.filename,
    },
    file,
    dependencies,
  );
}

/** Deletes the resume. Cascades to its document and document_chunks. */
export async function deleteResume(
  dependencies: DocumentManagementDependencies = {},
): Promise<void> {
  await deleteResumeRow(dependencies.pool);
}

/**
 * Uploads (or replaces) the job description for a specific slot (1-4). The
 * job row and its document row are reused across re-uploads, matching
 * uploadResume's replace-cleanly behavior.
 */
export async function uploadJobDescription(
  slot: JobSlot,
  file: UploadFile,
  dependencies: DocumentManagementDependencies = {},
): Promise<JobUploadSummary> {
  assertValidSlot(slot);

  const job = await upsertJobForSlot(slot, file.filename, dependencies.pool);
  const document = await upsertJobDocument(
    {
      jobId: job.id,
      originalFilename: file.filename,
      mimeType: file.mimeType ?? "text/plain",
      fileSize: file.buffer.length,
    },
    dependencies.pool,
  );

  const summary = await ingestAndPersist(
    {
      documentId: document.id,
      documentType: "job_description",
      jobId: job.id,
      originalFilename: file.filename,
    },
    file,
    dependencies,
  );

  return { ...summary, jobId: job.id };
}

/** Deletes the job at this slot. Cascades to its document and document_chunks. */
export async function deleteJobDescription(
  slot: JobSlot,
  dependencies: DocumentManagementDependencies = {},
): Promise<void> {
  assertValidSlot(slot);
  await deleteJobBySlot(slot, dependencies.pool);
}

/** Removes the resume and every job slot, cascading to all related RAG data. */
export async function clearAll(
  dependencies: DocumentManagementDependencies = {},
): Promise<void> {
  await deleteResumeRow(dependencies.pool);
  await deleteAllJobs(dependencies.pool);
}

async function ingestAndPersist(
  metadata: {
    documentId: string;
    documentType: "resume" | "job_description";
    jobId: string | null;
    originalFilename: string;
  },
  file: UploadFile,
  dependencies: DocumentManagementDependencies,
): Promise<UploadSummary> {
  const { chunks } = await ingestUploadedDocument({
    file: { buffer: file.buffer, filename: file.filename, mimeType: file.mimeType },
    metadata,
    chunking: dependencies.chunking,
  });

  const embedded = await embedChunks(chunks, dependencies.embeddingProvider);

  const summary = await persistIngestedChunks({
    metadata,
    chunks,
    embeddings: embedded.map((item) => item.embedding),
    pool: dependencies.pool,
  });

  return { documentId: metadata.documentId, chunkCount: summary.insertedCount };
}

function assertValidSlot(slot: number): asserts slot is JobSlot {
  if (!isJobSlot(slot)) {
    throw new DatabaseError(`Invalid job slot: ${slot}. Must be 1, 2, 3, or 4.`);
  }
}

export { getDocumentByJobId, getDocumentByResumeId };

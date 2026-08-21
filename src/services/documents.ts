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

export type UploadFile = IngestionFile;

export type UploadSummary = {
  documentId: string;
  chunkCount: number;
};

export type JobUploadSummary = UploadSummary & {
  jobId: string;
};

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

export async function deleteResume(): Promise<void> {
  await deleteResumeRow();
}

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

export async function deleteJobDescription(slot: JobSlot): Promise<void> {
  await deleteJobBySlot(slot);
}

export async function clearAll(): Promise<void> {
  await deleteResumeRow();
  await deleteAllJobs();
}

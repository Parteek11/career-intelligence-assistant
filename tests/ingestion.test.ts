import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Document } from "@langchain/core/documents";
import { splitDocuments } from "@/rag/chunking";
import { ingestDocument } from "@/rag/ingest";
import { IngestionError } from "@/rag/errors";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const resumeText = readFileSync(join(fixturesDir, "resume.txt"));
const jobText = readFileSync(join(fixturesDir, "job.txt"));

const resumeMetadata = {
  documentId: "resume-doc-1",
  documentType: "resume" as const,
  jobId: null,
  originalFilename: "resume.txt",
};

const jobMetadata = {
  documentId: "job-doc-2",
  documentType: "job_description" as const,
  jobId: "11111111-1111-4111-8111-111111111111",
  originalFilename: "job.txt",
};

describe("ingestion pipeline", () => {
  it("turns a simple text document into one or more chunks", async () => {
    const result = await ingestDocument({
      file: {
        buffer: resumeText,
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      metadata: resumeMetadata,
    });

    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.chunks[0]?.pageContent).toContain("Software Engineer");
    expect(result.stats.sourceFilename).toBe("resume.txt");
    expect(result.stats.documentType).toBe("resume");
    expect(result.stats.chunkCount).toBe(result.chunks.length);
    expect(result.stats.pageCount).toBeNull();
  });

  it("respects chunk overlap for adjacent character splits", async () => {
    const text = "abcdefghij".repeat(6);
    const documents = await splitDocuments(
      [new Document({ pageContent: text })],
      { chunkSize: 20, chunkOverlap: 5 },
    );

    expect(documents.length).toBeGreaterThan(1);
    const first = documents[0]?.pageContent ?? "";
    const second = documents[1]?.pageContent ?? "";
    expect(second.startsWith(first.slice(-5))).toBe(true);
  });

  it("preserves required metadata on every chunk", async () => {
    const result = await ingestDocument({
      file: {
        buffer: resumeText,
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      metadata: resumeMetadata,
      chunking: { chunkSize: 180, chunkOverlap: 40 },
    });

    expect(result.chunks.length).toBeGreaterThan(1);

    for (const chunk of result.chunks) {
      expect(chunk.metadata.document_id).toBe("resume-doc-1");
      expect(chunk.metadata.document_type).toBe("resume");
      expect(chunk.metadata.original_filename).toBe("resume.txt");
      expect(chunk.metadata).toHaveProperty("chunk_index");
      expect(chunk.metadata).toHaveProperty("job_id");
    }
  });

  it("sets job_id to null on resume chunks", async () => {
    const result = await ingestDocument({
      file: {
        buffer: resumeText,
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      metadata: resumeMetadata,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    for (const chunk of result.chunks) {
      expect(chunk.metadata.job_id).toBeNull();
    }
  });

  it("attaches the job database id to job-description chunks", async () => {
    const result = await ingestDocument({
      file: {
        buffer: jobText,
        filename: "job.txt",
        mimeType: "text/plain",
      },
      metadata: jobMetadata,
      chunking: { chunkSize: 160, chunkOverlap: 30 },
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    for (const chunk of result.chunks) {
      expect(chunk.metadata.job_id).toBe(jobMetadata.jobId);
      expect(chunk.metadata.document_type).toBe("job_description");
    }
  });

  it("assigns chunk_index from zero in document order", async () => {
    const result = await ingestDocument({
      file: {
        buffer: resumeText,
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      metadata: resumeMetadata,
      chunking: { chunkSize: 160, chunkOverlap: 30 },
    });

    const indexes = result.chunks.map((chunk) => chunk.metadata.chunk_index);
    expect(indexes).toEqual(result.chunks.map((_, index) => index));
  });

  it("handles empty and whitespace-only text without throwing", async () => {
    const empty = await ingestDocument({
      file: { buffer: Buffer.from(""), filename: "empty.txt", mimeType: "text/plain" },
      metadata: { ...resumeMetadata, originalFilename: "empty.txt" },
    });
    const whitespace = await ingestDocument({
      file: {
        buffer: Buffer.from("   \n\n\t  "),
        filename: "blank.txt",
        mimeType: "text/plain",
      },
      metadata: { ...resumeMetadata, originalFilename: "blank.txt" },
    });

    expect(empty.chunks).toEqual([]);
    expect(empty.stats.chunkCount).toBe(0);
    expect(empty.stats.averageChunkLength).toBe(0);
    expect(whitespace.chunks).toEqual([]);
    expect(whitespace.stats.chunkCount).toBe(0);
  });

  it("rejects unsupported file types with a clear error", async () => {
    await expect(
      ingestDocument({
        file: {
          buffer: Buffer.from("not-a-document"),
          filename: "photo.png",
          mimeType: "image/png",
        },
        metadata: resumeMetadata,
      }),
    ).rejects.toBeInstanceOf(IngestionError);
  });
});

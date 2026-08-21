import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { DocumentType } from "@/types/domain";

export const DEFAULT_CHUNK_SIZE = 900;
export const DEFAULT_CHUNK_OVERLAP = 120;

export type IngestionFile = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdf(file: IngestionFile): boolean {
  const mime = file.mimeType?.toLowerCase() ?? "";
  return mime === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
}

function isText(file: IngestionFile): boolean {
  const mime = file.mimeType?.toLowerCase() ?? "";
  const name = file.filename.toLowerCase();
  return mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md");
}

async function loadDocuments(file: IngestionFile): Promise<Document[]> {
  if (isPdf(file)) {
    const blob = new Blob([new Uint8Array(file.buffer)], { type: "application/pdf" });
    return new PDFLoader(blob, { splitPages: true }).load();
  }

  if (isText(file)) {
    return [
      new Document({
        pageContent: file.buffer.toString("utf8"),
        metadata: { source: file.filename },
      }),
    ];
  }

  throw new Error(`Unsupported file type for ${file.filename}. Use PDF or plain text.`);
}

function pageNumber(metadata: Record<string, unknown>): number | undefined {
  const loc = metadata.loc;
  if (loc && typeof loc === "object" && "pageNumber" in loc && typeof loc.pageNumber === "number") {
    return loc.pageNumber;
  }
  if (typeof metadata.pageNumber === "number") return metadata.pageNumber;
  if (typeof metadata.page === "number") return metadata.page;
  return undefined;
}

/** Load → clean text → split into overlapping chunks. */
export async function ingestFile(
  file: IngestionFile,
  meta: {
    documentId: string;
    documentType: DocumentType;
    jobId: string | null;
    originalFilename: string;
  },
): Promise<Document[]> {
  if (!file.filename.trim()) {
    throw new Error("A filename is required for ingestion");
  }
  if (meta.documentType === "resume" && meta.jobId !== null) {
    throw new Error("Resume chunks must have job_id = null");
  }
  if (meta.documentType === "job_description" && !meta.jobId) {
    throw new Error("Job description chunks require a job_id");
  }
  if (file.buffer.length === 0) {
    return [];
  }

  const loaded = await loadDocuments(file);
  const cleaned = loaded
    .map(
      (document) =>
        new Document({
          pageContent: normalizeText(document.pageContent),
          metadata: document.metadata,
        }),
    )
    .filter((document) => document.pageContent.length > 0);

  if (cleaned.length === 0) {
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  });
  const split = await splitter.splitDocuments(cleaned);

  return split.map((chunk, chunkIndex) => {
    const page = pageNumber(chunk.metadata);
    return new Document({
      pageContent: chunk.pageContent,
      metadata: {
        original_filename: meta.originalFilename,
        chunk_index: chunkIndex,
        ...(page !== undefined ? { page_number: page } : {}),
      },
    });
  });
}

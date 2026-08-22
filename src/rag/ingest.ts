import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { DocumentType } from "@/types/domain";

/**
 * First stage of the RAG pipeline: turn an uploaded file into overlapping
 * LangChain `Document` chunks. This module does not embed or write to the
 * database — `src/services/documents.ts` calls `ingestFile`, then embeds,
 * then persists.
 *
 * Chunk size / overlap are the knobs that decide how much context each
 * vector represents. 900 characters keeps most resume bullets or JD
 * paragraphs intact; 120 characters of overlap reduces the chance that a
 * sentence is split across two chunks and missed at retrieval time.
 */
export const DEFAULT_CHUNK_SIZE = 900;
export const DEFAULT_CHUNK_OVERLAP = 120;

export type IngestionFile = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

/**
 * Normalize extracted text so embeddings see consistent input.
 *
 * PDF extractors and editors introduce artifacts that do not change
 * meaning but do change token boundaries: a UTF-8 BOM, mixed newlines,
 * null bytes from some PDF parsers, trailing spaces before a line break,
 * and long runs of blank lines. Cleaning them here keeps chunk text
 * stable across re-uploads of the same file.
 */
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

/** True when the upload is a PDF, by MIME type or by filename extension. */
function isPdf(file: IngestionFile): boolean {
  const mime = file.mimeType?.toLowerCase() ?? "";
  return mime === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
}

/** True for plain text / markdown. MIME `text/*` covers `.txt` uploads from browsers. */
function isText(file: IngestionFile): boolean {
  const mime = file.mimeType?.toLowerCase() ?? "";
  const name = file.filename.toLowerCase();
  return mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md");
}

/**
 * Load the file into one or more LangChain `Document`s.
 *
 * PDFs are split by page (`splitPages: true`) so later metadata can
 * record a page number. Text files become a single document; the
 * character splitter below does the actual chunking.
 */
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

/**
 * LangChain PDF loaders store page numbers in a few different metadata
 * shapes (`loc.pageNumber`, `pageNumber`, or `page`). We accept all three
 * so a later model version change does not silently drop page citations.
 */
function pageNumber(metadata: Record<string, unknown>): number | undefined {
  const loc = metadata.loc;
  if (loc && typeof loc === "object" && "pageNumber" in loc && typeof loc.pageNumber === "number") {
    return loc.pageNumber;
  }
  if (typeof metadata.pageNumber === "number") return metadata.pageNumber;
  if (typeof metadata.page === "number") return metadata.page;
  return undefined;
}

/**
 * Load → clean text → split into overlapping chunks with stable metadata.
 *
 * Invariants (enforced before any I/O):
 * - A resume must have `jobId = null` so resume chunks never appear under a job filter.
 * - A job description must have a `jobId` so retrieval can restrict to Job 1–4.
 *
 * Each returned chunk carries `original_filename`, `chunk_index`, and
 * optionally `page_number`. Those fields are what the UI cites as sources
 * after generation. Empty files / files that normalize to empty text
 * return `[]` instead of throwing, so a re-upload can clear stale chunks.
 */
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

  // RecursiveCharacterTextSplitter prefers paragraph → sentence → word
  // boundaries before hard-cutting at `chunkSize`. Overlap copies the
  // tail of chunk N onto the head of chunk N+1 so a phrase that sits on
  // the boundary is still fully present in at least one embedding.
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

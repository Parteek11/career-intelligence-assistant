import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { IngestionError } from "@/rag/errors";
import type { IngestionFile } from "@/rag/types";

type LoadedSource = {
  documents: Document[];
  pageCount: number | null;
};

class BufferTextLoader extends BaseDocumentLoader {
  constructor(
    private readonly buffer: Buffer,
    private readonly source: string,
  ) {
    super();
  }

  async load(): Promise<Document[]> {
    return [
      new Document({
        pageContent: this.buffer.toString("utf8"),
        metadata: { source: this.source },
      }),
    ];
  }
}

export function detectSourceKind(
  file: IngestionFile,
): "pdf" | "text" {
  const mime = file.mimeType?.toLowerCase() ?? "";
  const filename = file.filename.toLowerCase();

  if (mime === "application/pdf" || filename.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    mime.startsWith("text/") ||
    filename.endsWith(".txt") ||
    filename.endsWith(".md")
  ) {
    return "text";
  }

  throw new IngestionError(
    `Unsupported file type for ${file.filename}. Use PDF or plain text.`,
  );
}

export async function loadSourceDocuments(
  file: IngestionFile,
): Promise<LoadedSource> {
  const kind = detectSourceKind(file);

  if (kind === "pdf") {
    return loadPdfDocuments(file);
  }

  const documents = await new BufferTextLoader(file.buffer, file.filename).load();
  return { documents, pageCount: null };
}

async function loadPdfDocuments(file: IngestionFile): Promise<LoadedSource> {
  try {
    const { PDFLoader } = await import(
      "@langchain/community/document_loaders/fs/pdf"
    );
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: "application/pdf",
    });
    const loader = new PDFLoader(blob, { splitPages: true });
    const documents = await loader.load();
    return {
      documents,
      pageCount: extractPdfPageCount(documents),
    };
  } catch (error) {
    throw new IngestionError(`Failed to parse PDF ${file.filename}`, {
      cause: error,
    });
  }
}

function extractPdfPageCount(documents: Document[]): number | null {
  const pdf = documents[0]?.metadata.pdf as { totalPages?: unknown } | undefined;
  if (typeof pdf?.totalPages === "number") {
    return pdf.totalPages;
  }

  if (documents.length > 0) {
    return documents.length;
  }

  return null;
}

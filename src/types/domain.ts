export const JOB_SLOTS = [1, 2, 3, 4] as const;
export type JobSlot = (typeof JOB_SLOTS)[number];

export function isJobSlot(value: number): value is JobSlot {
  return (JOB_SLOTS as readonly number[]).includes(value);
}

export const DOCUMENT_TYPES = ["resume", "job_description"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Dimension expected by all-MiniLM-L6-v2. The column is prepared, not populated. */
export const EMBEDDING_DIMENSIONS = 384 as const;

export type Resume = {
  id: string;
  originalFilename: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Job = {
  id: string;
  slot: JobSlot;
  originalFilename: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Document = {
  id: string;
  documentType: DocumentType;
  resumeId: string | null;
  jobId: string | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentChunkMetadata = {
  page_number?: number;
  section?: string;
  source_filename?: string;
  chunk_size?: number;
  chunk_overlap?: number;
  parser_name?: string;
  parser_version?: string;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  jobId: string | null;
  documentType: DocumentType;
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
  metadata: DocumentChunkMetadata;
  createdAt: Date;
};

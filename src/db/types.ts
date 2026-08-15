import type {
  DocumentChunkMetadata,
  DocumentType,
  JobSlot,
} from "@/types/domain";

export type ResumeRow = {
  id: string;
  original_filename: string;
  created_at: Date;
  updated_at: Date;
};

export type JobRow = {
  id: string;
  slot: JobSlot;
  original_filename: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export type DocumentRow = {
  id: string;
  document_type: DocumentType;
  resume_id: string | null;
  job_id: string | null;
  original_filename: string;
  mime_type: string;
  file_size: string | number;
  created_at: Date;
  updated_at: Date;
};

export type DocumentChunkRow = {
  id: string;
  document_id: string;
  job_id: string | null;
  document_type: DocumentType;
  chunk_index: number;
  content: string;
  embedding: string | null;
  metadata: DocumentChunkMetadata;
  created_at: Date;
};

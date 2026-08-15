-- Career Intelligence Assistant domain schema.
-- Reproducible from a clean database via `npm run db:migrate`.
-- Does not insert resume, job, or chunk data.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- resumes: one uploaded candidate resume (application currently uses a single
-- row; the table is not limited to one row so a later multi-user model can
-- add user_id without replacing this structure).
-- ---------------------------------------------------------------------------
CREATE TABLE resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- jobs: logical job slots 1-4. Identity is `slot`, never the filename.
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot SMALLINT NOT NULL,
  original_filename TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jobs_slot_range CHECK (slot IN (1, 2, 3, 4)),
  CONSTRAINT jobs_slot_unique UNIQUE (slot)
);

-- ---------------------------------------------------------------------------
-- documents: the uploaded source file. Belongs to exactly one resume or job.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL,
  resume_id UUID REFERENCES resumes (id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs (id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_type_allowed CHECK (document_type IN ('resume', 'job_description')),
  CONSTRAINT documents_file_size_non_negative CHECK (file_size >= 0),
  CONSTRAINT documents_exactly_one_parent CHECK (
    (
      document_type = 'resume'
      AND resume_id IS NOT NULL
      AND job_id IS NULL
    )
    OR (
      document_type = 'job_description'
      AND job_id IS NOT NULL
      AND resume_id IS NULL
    )
  )
);

CREATE UNIQUE INDEX documents_one_per_resume_idx
  ON documents (resume_id)
  WHERE resume_id IS NOT NULL;

CREATE UNIQUE INDEX documents_one_per_job_idx
  ON documents (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX documents_document_type_idx ON documents (document_type);

-- ---------------------------------------------------------------------------
-- document_chunks: future RAG records. job_id and document_type are
-- denormalized from documents so retrieval can filter by Job 1-4 or all jobs
-- without a join. A trigger copies those values from the parent document.
-- embedding is nullable until a later ingestion step generates vectors.
-- ---------------------------------------------------------------------------
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs (id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(384),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_chunks_type_allowed CHECK (document_type IN ('resume', 'job_description')),
  CONSTRAINT document_chunks_index_non_negative CHECK (chunk_index >= 0),
  CONSTRAINT document_chunks_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT document_chunks_source_consistency CHECK (
    (
      document_type = 'resume'
      AND job_id IS NULL
    )
    OR (
      document_type = 'job_description'
      AND job_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX document_chunks_document_id_chunk_index_idx
  ON document_chunks (document_id, chunk_index);

CREATE INDEX document_chunks_job_id_idx ON document_chunks (job_id);
CREATE INDEX document_chunks_document_type_idx ON document_chunks (document_type);
CREATE INDEX document_chunks_chunk_index_idx ON document_chunks (chunk_index);

-- ---------------------------------------------------------------------------
-- Keep denormalized chunk source columns aligned with documents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_document_chunk_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_type TEXT;
  source_job_id UUID;
BEGIN
  SELECT document_type, job_id
    INTO STRICT source_type, source_job_id
    FROM documents
   WHERE id = NEW.document_id;

  NEW.document_type := source_type;
  NEW.job_id := source_job_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_chunks_set_source
  BEFORE INSERT OR UPDATE OF document_id, job_id, document_type
  ON document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_document_chunk_source();

-- Document parent identity is immutable so chunk metadata cannot drift.
CREATE OR REPLACE FUNCTION prevent_document_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.resume_id IS DISTINCT FROM OLD.resume_id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.document_type IS DISTINCT FROM OLD.document_type THEN
    RAISE EXCEPTION 'document parent and type are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_prevent_reparenting
  BEFORE UPDATE OF resume_id, job_id, document_type
  ON documents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_document_reparenting();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER resumes_set_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE resumes IS 'Uploaded candidate resume. Application currently uses one resume.';
COMMENT ON TABLE jobs IS 'Logical job slots 1-4. Slot is the stable identity, not the filename.';
COMMENT ON TABLE documents IS 'Source file for a resume or a job description, never both.';
COMMENT ON TABLE document_chunks IS 'Future RAG units. embedding is prepared as vector(384) and left null until ingestion.';
COMMENT ON COLUMN document_chunks.embedding IS 'pgvector column for all-MiniLM-L6-v2 (384 dimensions). Not populated in this step.';
COMMENT ON COLUMN document_chunks.job_id IS 'Denormalized from documents.job_id so retrieval can filter Job 1-4 without a join. Null for resume chunks.';
COMMENT ON COLUMN document_chunks.metadata IS 'JSONB object for parser, section, page, and chunking details.';

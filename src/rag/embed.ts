import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";

/**
 * Shared embedding model for both ingestion and query-time retrieval.
 *
 * `Xenova/all-MiniLM-L6-v2` runs locally (no API key) and produces 384-d
 * vectors — the same width as `document_chunks.embedding vector(384)` in
 * Postgres. Pipeline options:
 * - `pooling: "mean"` — average the token embeddings into one vector per text.
 * - `normalize: true` — L2-normalize so each vector has length 1.
 *
 * Unit vectors matter: pgvector's `<=>` operator is cosine *distance*
 * (`1 - cosine_similarity`). On normalized vectors, cosine similarity is
 * just the dot product, and `similarity = 1 - distance` is a clean 0–1 score.
 *
 * This instance is reused across uploads and questions so the model is
 * loaded once per Node process instead of on every request.
 */
export const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/all-MiniLM-L6-v2",
  pipelineOptions: { pooling: "mean", normalize: true },
});

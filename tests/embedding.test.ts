import { Document } from "@langchain/core/documents";
import { describe, expect, it } from "vitest";
import { embedChunks } from "@/rag/embedding/embed-chunks";
import { EMBEDDING_DIMENSIONS } from "@/rag/embedding/types";
import { TransformersEmbeddingProvider } from "@/rag/embedding/transformers-provider";

const provider = new TransformersEmbeddingProvider();

describe("embedding provider", () => {
  it("returns an embedding for each input chunk", async () => {
    const chunks = [
      new Document({
        pageContent: "Built TypeScript APIs with PostgreSQL.",
        metadata: { document_id: "doc-1", chunk_index: 0 },
      }),
    ];

    const embedded = await embedChunks(chunks, provider);

    expect(embedded).toHaveLength(1);
    expect(embedded[0].embedding.length).toBeGreaterThan(0);
    expect(embedded[0].metadata).toEqual(chunks[0].metadata);
    expect(embedded[0].chunkIndex).toBe(0);
  }, 30_000);

  it("produces 384-dimensional vectors", async () => {
    const chunks = [
      new Document({ pageContent: "Senior backend engineer role.", metadata: {} }),
    ];

    const [embedded] = await embedChunks(chunks, provider);

    expect(embedded.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
  }, 30_000);

  it("returns a consistent dimension for the same text embedded twice", async () => {
    const text = "Mentored engineers on testing and production debugging.";
    const chunks = [
      new Document({ pageContent: text, metadata: {} }),
      new Document({ pageContent: text, metadata: {} }),
    ];

    const embedded = await embedChunks(chunks, provider);

    expect(embedded[0].embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(embedded[1].embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  }, 30_000);

  it("handles empty input safely", async () => {
    const embedded = await embedChunks([], provider);
    expect(embedded).toEqual([]);

    const vectors = await provider.embed([]);
    expect(vectors).toEqual([]);
  });
});

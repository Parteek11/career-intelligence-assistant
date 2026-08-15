// Development script: embeds a few sample sentences with the same provider
// used by the RAG ingestion layer and prints dimension + cosine similarity.
// Run with: node scripts/embedding-demo.mjs

import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  // Vectors are already L2-normalized by the pipeline, so dot product
  // equals cosine similarity. No extra magnitude division needed.
  return dot;
}

async function main() {
  console.log(`Loading ${MODEL_NAME}...`);
  const extractor = await pipeline("feature-extraction", MODEL_NAME);

  const sentences = [
    "Built and operated TypeScript APIs with PostgreSQL.",
    "Designed backend services using TypeScript and PostgreSQL.",
    "Baked sourdough bread over the weekend.",
  ];

  const output = await extractor(sentences, { pooling: "mean", normalize: true });
  const dims = output.dims.at(-1);
  const flat = Array.from(output.data);
  const vectors = sentences.map((_, i) => flat.slice(i * dims, (i + 1) * dims));

  console.log(`Vector dimension: ${dims}`);
  console.log(
    `Cosine similarity (related sentences 1 & 2): ${cosineSimilarity(vectors[0], vectors[1]).toFixed(4)}`,
  );
  console.log(
    `Cosine similarity (unrelated sentences 1 & 3): ${cosineSimilarity(vectors[0], vectors[2]).toFixed(4)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

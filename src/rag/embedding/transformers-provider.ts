import { IngestionError } from "@/rag/errors";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "@/rag/embedding/types";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Loads the feature-extraction pipeline once per process and reuses it for
 * every call. Loading downloads/reads model weights, so repeating this per
 * request would be slow and wasteful.
 */
function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers")
      .then(({ pipeline }) =>
        pipeline("feature-extraction", MODEL_NAME) as unknown as Promise<FeatureExtractionPipeline>,
      )
      .catch((error: unknown) => {
        pipelinePromise = null;
        throw new IngestionError(
          `Failed to load embedding model ${MODEL_NAME}`,
          { cause: error },
        );
      });
  }

  return pipelinePromise;
}

/**
 * Local, in-process embedding provider backed by Transformers.js running
 * Xenova/all-MiniLM-L6-v2 with mean pooling and L2 normalization, producing
 * 384-dimensional unit vectors suitable for cosine similarity.
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly model = MODEL_NAME;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await getPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });

    return unpackEmbeddings(output, texts.length, this.dimensions);
  }
}

function unpackEmbeddings(
  output: { data: Float32Array | number[]; dims: number[] },
  expectedCount: number,
  expectedDimensions: number,
): number[][] {
  const dimensions = output.dims.at(-1) ?? expectedDimensions;

  if (dimensions !== expectedDimensions) {
    throw new IngestionError(
      `Embedding model returned ${dimensions} dimensions, expected ${expectedDimensions}`,
    );
  }

  const flat = Array.from(output.data);
  const vectors: number[][] = [];

  for (let i = 0; i < expectedCount; i += 1) {
    vectors.push(flat.slice(i * dimensions, (i + 1) * dimensions));
  }

  return vectors;
}

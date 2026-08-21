import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";

/** Local MiniLM embeddings: mean pool + L2 normalize → 384-d unit vectors. */
export const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/all-MiniLM-L6-v2",
  pipelineOptions: { pooling: "mean", normalize: true },
});

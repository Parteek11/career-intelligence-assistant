import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "pdf-parse",
    "@langchain/community",
    "@langchain/groq",
    "@huggingface/transformers",
  ],
};

export default nextConfig;

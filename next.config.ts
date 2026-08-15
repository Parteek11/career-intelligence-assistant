import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "pdf-parse",
    "@langchain/community",
    "@huggingface/transformers",
  ],
};

export default nextConfig;

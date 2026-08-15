import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv("test", rootDir, "");

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup/jest-dom.ts"],
    env,
    // Several test files share the same local Postgres instance and a
    // business rule with only 4 possible job slots. Running files in
    // parallel causes spurious unique-constraint collisions between
    // unrelated tests, so files run sequentially instead.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      "server-only": path.resolve(rootDir, "./tests/stubs/server-only.ts"),
    },
  },
});

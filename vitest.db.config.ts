import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests: need PostgreSQL (DATABASE_URL, default postgres://postgres@localhost:54329/postgres).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    // Files share cluster-wide roles; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

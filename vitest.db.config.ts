import { defineConfig } from "vitest/config";

// Database tests: need PostgreSQL (DATABASE_URL, default postgres://postgres@localhost:54329/postgres).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

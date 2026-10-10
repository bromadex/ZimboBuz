import { defineConfig } from "vitest/config";

// Unit tests (no database). Database tests use vitest.db.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});

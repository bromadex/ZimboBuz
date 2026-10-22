import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests (no database). Database tests use vitest.db.config.ts.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 75, statements: 75, functions: 70, branches: 75 },
    },
  },
});

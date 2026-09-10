import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,vue}"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 78, statements: 75, functions: 60, branches: 60 },
    },
  },
});

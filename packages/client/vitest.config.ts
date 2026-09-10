import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: false,
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,vue}"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 55, statements: 55, functions: 60, branches: 45 },
    },
  },
});

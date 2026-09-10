/**
 * vite-plugin-aipanel 单元测试的 vitest 配置。
 * 覆盖范围限 src 下的运行时模块（不含 *.d.ts 与纯类型导出）。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 72, statements: 72, functions: 66, branches: 62 },
    },
  },
});

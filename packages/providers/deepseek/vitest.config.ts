/**
 * @aipanel/provider-deepseek 单元测试的 vitest 配置。
 * - environment: node —— 被测逻辑为纯 Node 模块（无 DOM 依赖）
 * - globals: false —— 测试文件显式 import vitest API（describe/it/expect）
 * 运行方式（仓库根目录）：pnpm exec vitest run --root packages/providers/deepseek
 * 覆盖率仅统计 src 与 dsh-plugin/src（dsh-client 的 .tsx 依赖外部产物，不纳入）。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts", "dsh-plugin/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 60, statements: 60, functions: 48, branches: 52 },
    },
  },
});

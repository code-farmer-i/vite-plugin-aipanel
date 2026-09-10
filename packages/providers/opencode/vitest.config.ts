/**
 * @aipanel/provider-opencode 单元测试 vitest 配置。
 * - environment: node —— 被测逻辑为纯 Node 模块（无 DOM 依赖）
 * - globals: false —— 测试文件显式 import vitest API（describe/it/expect）
 * 运行方式（仓库根目录）：pnpm exec vitest run --root packages/providers/opencode
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
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 52, statements: 52, functions: 48, branches: 52 },
    },
  },
});

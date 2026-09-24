/**
 * utils/source-path 路径归一化的 vitest 单元测试。
 *
 * 覆盖目标：绝对路径幂等、相对路径按 cwd → root → gitRoot 顺序取第一个真实存在的候选、
 * `../..` 逃逸到工作区外的依赖真身仍按上报基准解析、都不存在时回退 cwd 基准且输出仍为绝对路径、
 * findGitRoot 向上查找与走到文件系统根即停。
 *
 * 探测函数 exists 全部注入，测试不依赖真实文件系统。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findGitRoot, resolveSourceFilePath } from "../src/utils/source-path";

describe("resolveSourceFilePath", () => {
  it("绝对路径与空值原样返回（幂等）", () => {
    const bases = { cwd: "/cwd", root: "/root", exists: () => false };
    expect(resolveSourceFilePath("/abs/App.vue", bases)).toBe("/abs/App.vue");
    expect(resolveSourceFilePath("", bases)).toBe("");
  });

  it("相对路径优先按 cwd 基准命中（unplugin-vue-inspector 标记：relative(process.cwd(), id)）", () => {
    const hit = path.resolve("/cwd", "site/desktop/views/index.vue");
    expect(
      resolveSourceFilePath("site/desktop/views/index.vue", {
        cwd: "/cwd",
        root: "/root",
        exists: (candidate) => candidate === hit,
      }),
    ).toBe(hit);
  });

  it("cwd 未命中时退到 Vite root 基准（react-dev-inspector 兼容属性）", () => {
    const hit = path.resolve("/root", "src/App.tsx");
    expect(
      resolveSourceFilePath("src/App.tsx", {
        cwd: "/cwd",
        root: "/root",
        exists: (candidate) => candidate === hit,
      }),
    ).toBe(hit);
  });

  it("`../..` 逃逸到依赖真身时按上报基准解析，不落到工作区外的错误位置", () => {
    const raw = "../../node_modules/.pnpm/pkg@1.0.0_hash/node_modules/pkg/site/Header.vue";
    // 基准是 Vite 进程 cwd（docs 包目录）：../../ 回到仓库根，而不是 agent 工作目录的上一级
    const hit = path.resolve("/repo/packages/docs", raw);
    expect(hit).toBe("/repo/node_modules/.pnpm/pkg@1.0.0_hash/node_modules/pkg/site/Header.vue");
    expect(
      resolveSourceFilePath(raw, {
        cwd: "/repo/packages/docs",
        root: "/repo/packages/docs",
        exists: (candidate) => candidate === hit,
      }),
    ).toBe(hit);
  });

  it("gitRoot 是最后一个候选（code-inspector pathType: relative 的基准）", () => {
    const hit = path.resolve("/repo", "src/App.jsx");
    expect(
      resolveSourceFilePath("src/App.jsx", {
        cwd: "/repo/web",
        root: "/repo/web",
        gitRoot: "/repo",
        exists: (candidate) => candidate === hit,
      }),
    ).toBe(hit);
  });

  it("三个基准都不存在时回退 cwd 基准，输出仍是绝对路径（契约：不退回相对值）", () => {
    expect(
      resolveSourceFilePath("src/gone.ts", {
        cwd: "/cwd",
        root: "/root",
        gitRoot: "/repo",
        exists: () => false,
      }),
    ).toBe(path.resolve("/cwd", "src/gone.ts"));
  });
});

describe("findGitRoot", () => {
  it("自起始目录向上找到含 .git 的目录", () => {
    const gitDir = path.join("/repo", ".git");
    expect(findGitRoot("/repo/packages/docs", (candidate) => candidate === gitDir)).toBe("/repo");
  });

  it("一路找不到时返回 null（走到文件系统根即停）", () => {
    expect(findGitRoot("/a/b/c", () => false)).toBeNull();
  });
});

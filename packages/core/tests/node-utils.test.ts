/**
 * @fileoverview Node 工具纯逻辑单测（packages/core/src/node/node-utils.ts，node 环境）
 * 选择可确定性单测的纯逻辑：require 解析（mock node:module）与 .git 根查找
 * （mock fs.existsSync）。网络 / 进程 / 端口类函数（checkChromeDevToolsAvailable、
 * isPortAvailable、findAvailablePort、waitForServer、checkCliInstalled、
 * getCliVersion、killOrphanCliProcesses）与真实 I/O 强耦合，见汇报说明。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createPackageRequire, findGitRoot, resolvePackageDir } from "../src/node/node-utils";

// node-utils 通过 import { createRequire } from "node:module" 解析依赖，这里替换为可控 mock
vi.mock("node:module", () => ({ createRequire: vi.fn() }));

const mockedCreateRequire = vi.mocked(createRequire);

afterEach(() => {
  vi.restoreAllMocks();
  mockedCreateRequire.mockReset();
});

describe("createPackageRequire", () => {
  it("anchors the require at baseDir/package.json", () => {
    const fakeRequire = () => ({});
    mockedCreateRequire.mockReturnValue(fakeRequire as unknown as NodeRequire);
    const req = createPackageRequire("/some/base");
    expect(mockedCreateRequire).toHaveBeenCalledWith(path.join("/some/base", "package.json"));
    expect(req).toBe(fakeRequire);
  });
});

describe("resolvePackageDir", () => {
  it("resolves the package root two dirs above its main entry", () => {
    const entry = path.join("/proj", "node_modules", "pkg-a", "lib", "index.js");
    const resolveMock = vi.fn((id: string) => {
      expect(id).toBe("pkg-a");
      return entry;
    });
    const fakeRequire = ((id: string) => {
      throw new Error("unexpected require: " + id);
    }) as unknown as NodeRequire;
    fakeRequire.resolve = resolveMock as unknown as NodeRequire["resolve"];
    mockedCreateRequire.mockReturnValue(fakeRequire);

    expect(resolvePackageDir("pkg-a", "/proj/app")).toBe(
      path.join("/proj", "node_modules", "pkg-a"),
    );
    expect(resolveMock).toHaveBeenCalledWith("pkg-a");
  });
});

describe("findGitRoot", () => {
  const realExists = fs.existsSync;

  afterEach(() => {
    fs.existsSync = realExists;
  });

  it("walks upward to the directory containing .git", () => {
    fs.existsSync = vi.fn((p) => p === path.join("/virtual/repo", ".git")) as typeof fs.existsSync;
    expect(findGitRoot("/virtual/repo/src/app/deep")).toBe("/virtual/repo");
  });

  it("returns the start directory when no .git is found", () => {
    fs.existsSync = vi.fn(() => false) as typeof fs.existsSync;
    expect(findGitRoot("/virtual/nowhere/deep")).toBe("/virtual/nowhere/deep");
  });

  it("honours a shallow maxDepth", () => {
    fs.existsSync = vi.fn((p) => p === path.join("/virtual/repo", ".git")) as typeof fs.existsSync;
    // repo 在 3 层之上，但最多只允许向上 2 层
    const start = "/virtual/repo/a/b/c/d";
    expect(findGitRoot(start, 2)).toBe(start);
  });
});

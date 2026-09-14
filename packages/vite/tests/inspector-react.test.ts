/**
 * React Inspector 集成（复用 @code-inspector/core transformCode）的 vitest 单元测试：
 * - 文件过滤：仅 jsx/tsx 参与，node_modules 与虚拟模块（\0）跳过，无 JSX 的代码跳过；
 * - 注入结果：JSX 开标签携带 data-insp-path，值为 git 仓库根相对路径（"文件:行:列:节点名"）；
 *   组件根元素走 props 传播表达式形态，嵌套 host 元素为静态属性形态，分别断言；
 * - 内部无变化时返回 null（不产生空 transform）；
 * - Vue 项目（含 vue-jsx）跳过：jsx/tsx 属 Vue JSX，不注入 React 生态标记。
 * transformCode 要求文件真实存在于磁盘，且仅仓库内文件输出相对路径，故临时目录建在包内。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedConfig } from "vite";
import { reactInspectorIntegration } from "../src/inspectors/react";

const plugin = reactInspectorIntegration.plugins()[0]!;

/** 调用 transform 钩子（实现不依赖 this 上下文） */
async function transform(code: string, id: string): Promise<{ code: string } | null> {
  const hook = plugin.transform as (code: string, id: string) => Promise<{ code: string } | null>;
  return hook.call({} as never, code, id);
}

const JSX_SAMPLE = `export default function App() {
  return (
    <div className="root">
      <button>hello</button>
    </div>
  );
}
`;

describe("React Inspector 集成", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function writeSample(name: string, content: string): string {
    // 临时目录建在包内（git 仓库内），确保 transformCode 输出相对路径
    tempDir ??= mkdtempSync(path.join(process.cwd(), ".inspector-test-"));
    const filePath = path.join(tempDir, name);
    writeFileSync(filePath, content);
    return filePath;
  }

  it("jsx 注入 data-insp-path（git 仓库根相对路径 + 行:列:节点名）", async () => {
    const filePath = writeSample("App.jsx", JSX_SAMPLE);
    const result = await transform(JSX_SAMPLE, filePath);

    expect(result).not.toBeNull();
    // 根元素走 props 传播表达式形态，嵌套 host 元素为静态属性形态
    expect(result?.code).toContain("App.jsx:3:5:div");
    expect(result?.code).toMatch(/data-insp-path="[^"]*App\.jsx:4:7:button"/);
    // 仓库内文件输出 git 仓库根相对路径而非绝对路径
    expect(result?.code).not.toContain(filePath);
  });

  it("tsx（含 TS 泛型）正常注入", async () => {
    const content = `type Props<T> = { items: T[] };
export function List<T>({ items }: Props<T>) {
  return <ul>{items.map((i) => <li key={String(i)}>{String(i)}</li>)}</ul>;
}
`;
    const filePath = writeSample("List.tsx", content);
    const result = await transform(content, filePath);

    expect(result?.code).toMatch(/data-insp-path="[^"]*List\.tsx:3:32:li"/);
  });

  it("非 jsx/tsx 文件跳过", async () => {
    const filePath = writeSample("App.vue", "<template><div /></template>");
    expect(await transform("<template><div /></template>", filePath)).toBeNull();
  });

  it("node_modules 与虚拟模块跳过", async () => {
    const filePath = writeSample("App.jsx", JSX_SAMPLE);
    expect(await transform(JSX_SAMPLE, `node_modules/pkg/${filePath}`)).toBeNull();
    expect(await transform(JSX_SAMPLE, `\0virtual:${filePath}`)).toBeNull();
  });

  it("无 JSX 的代码跳过", async () => {
    const filePath = writeSample("utils.tsx", "export const answer = 42;");
    expect(await transform("export const answer = 42;", filePath)).toBeNull();
  });

  it("文件头部 code-inspector-disable 注释整文件跳过（内部门控，返回 null）", async () => {
    const content = `// code-inspector-disable\n${JSX_SAMPLE}`;
    const filePath = writeSample("Disabled.jsx", content);
    expect(await transform(content, filePath)).toBeNull();
  });

  it("Vue 项目（含 vue-jsx）跳过注入", async () => {
    const vuePlugin = reactInspectorIntegration.plugins()[0]!;
    const configResolved = vuePlugin.configResolved as (config: ResolvedConfig) => void;
    configResolved({
      plugins: [{ name: "vite:vue" }, { name: "vite:vue-jsx" }],
    } as unknown as ResolvedConfig);

    const filePath = writeSample("VueJsx.jsx", JSX_SAMPLE);
    const hook = vuePlugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string } | null>;
    expect(await hook.call({} as never, JSX_SAMPLE, filePath)).toBeNull();
  });
});

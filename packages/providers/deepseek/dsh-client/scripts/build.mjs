/**
 * 构建 dsh-client 浏览器插件产物（lib/client.js）。
 *
 * ModuleLoader 契约：factory(require) → module.exports，因此需在 factory 内
 * 先定义 module/exports（与官方 @deepseek-ai/dsh-client-* 的 tsdown 产物一致），
 * 否则浏览器执行时因 `module is not defined` 抛错。
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 构建 client bundle，供本脚本独立执行及 build-dsh-assets.mjs 复用 */
export async function buildClient() {
  await build({
    entryPoints: [path.join(root, "src/client/index.ts")],
    outfile: path.join(root, "lib/client.js"),
    platform: "browser",
    format: "cjs",
    target: "es2020",
    jsx: "automatic",
    external: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@deepseek-ai/*",
      "ui-slots",
      "ui-primitives",
    ],
    bundle: true,
    banner: {
      js: [
        `window.__ModuleLoader__.load({ id: '@aipanel/dsh-client', factory: (require) => {`,
        `var module = { exports: {} };`,
        `var exports = module.exports;`,
        `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
      ].join("\n"),
    },
    footer: { js: `return module.exports; } });` },
    logLevel: "info",
  });
}

// 直接执行（node scripts/build.mjs）时独立构建；argv[1] 可能是相对路径，需转为绝对 URL 再比较
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildClient().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

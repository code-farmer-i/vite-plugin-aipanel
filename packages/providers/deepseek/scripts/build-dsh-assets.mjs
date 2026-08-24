/**
 * 构建 dsh 侧的宿主/浏览器插件产物。
 * 在 pagoda 主包构建完成后执行：
 *   - dsh-plugin  → dsh-plugin/dist/index.js   （宿主 Node 侧：审查工具/元素注入）
 *   - dsh-client  → dsh-client/lib/client.js   （浏览器侧：@aipanel reference source）
 * @deepseek-ai/* 保留外部引用（由 dsh 运行时提供），本脚本不解析其类型。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { buildClient } from "../dsh-client/scripts/build.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  // 1) 宿主插件（Node ESM）
  await build({
    entryPoints: [path.join(root, "dsh-plugin/src/index.ts")],
    outfile: path.join(root, "dsh-plugin/dist/index.js"),
    platform: "node",
    format: "esm",
    target: "node18",
    external: ["@deepseek-ai/*", "node:*"],
    bundle: true,
    logLevel: "info",
  });

  // 2) 浏览器 client 插件（ModuleLoader 契约：factory(require) → module.exports）
  // 复用 dsh-client/scripts/build.mjs 的构建配置，避免两处漂移
  await buildClient();

  // 3) client 包主入口（exports["."]）：cordis loader 会 import 它识别包（dsh.client 契约），
  // 必须 Node 可导入且不碰 window；client 逻辑由 ./client bundle 在浏览器侧激活，apply 无需副作用。
  fs.writeFileSync(
    path.join(root, "dsh-client/lib/index.js"),
    `export const name = "aipanel-client";\nexport function apply() {}\n`,
    "utf-8",
  );

  console.log("✓ dsh assets built (dsh-plugin/dist, dsh-client/lib)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

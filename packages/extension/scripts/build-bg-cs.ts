// 单独构建 content.js 和 background.js（IIFE 格式，Chrome 扩展要求自包含）
import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const sharedOptions = {
  configFile: false,
  build: {
    target: "es2020" as const,
    minify: "esbuild" as const,
    outDir: "dist",
    emptyOutDir: false,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
};

await build({
  ...sharedOptions,
  build: {
    ...sharedOptions.build,
    lib: {
      entry: resolve(rootDir, "src/content/index.ts"),
      formats: ["iife"],
      name: "AIPanelContent",
      fileName: () => "content.js",
    },
  },
});

await build({
  ...sharedOptions,
  build: {
    ...sharedOptions.build,
    lib: {
      entry: resolve(rootDir, "src/background/index.ts"),
      formats: ["iife"],
      name: "AIPanelBackground",
      fileName: () => "background.js",
    },
  },
});

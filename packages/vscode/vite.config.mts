import { defineConfig } from "vite";
import { resolve } from "path";
import { builtinModules } from "module";

export default defineConfig({
  build: {
    target: "node18",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/extension.ts"),
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    rollupOptions: {
      external: ["vscode", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        entryFileNames: "extension.js",
      },
    },
    minify: false,
    sourcemap: true,
  },
});

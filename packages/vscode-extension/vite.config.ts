import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "node18",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/extension.ts"),
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    rollupOptions: {
      external: ["vscode", "http", "path", "fs"],
      output: {
        entryFileNames: "extension.js",
      },
    },
    minify: false,
    sourcemap: true,
  },
});

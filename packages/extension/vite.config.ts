import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";

/** 构建后整理输出：复制 manifest + 移动 sidepanel HTML */
function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    closeBundle() {
      const distDir = resolve(__dirname, "dist");
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
      copyFileSync(resolve(__dirname, "src/manifest.json"), resolve(distDir, "manifest.json"));

      // 将 nested HTML 移到 dist 根
      const htmlSrc = resolve(distDir, "src/sidepanel/index.html");
      if (existsSync(htmlSrc)) {
        renameSync(htmlSrc, resolve(distDir, "sidepanel.html"));
      }
      const nested = resolve(distDir, "src");
      if (existsSync(nested)) rmSync(nested, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [vue(), copyManifestPlugin()],
  build: {
    target: "es2020",
    minify: "esbuild",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].[hash].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },
});

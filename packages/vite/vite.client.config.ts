import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  build: {
    target: "es2020",
    minify: "esbuild",
    lib: {
      entry: resolve(__dirname, "../client/src/index.ts"),
      name: "OpenCodeWidgetClient",
      fileName: "client",
      formats: ["es"],
    },
    outDir: "lib",
    emptyOutDir: false,
    rollupOptions: {
      // Don't externalize vue or components, we want them bundled into client.js
      external: [],
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },
});

import { defineConfig } from "@pagoda-cli/core";

export default defineConfig({
  name: "vite-plugin-opencode-assistant",
  build: {
    mode: "lib",
    bundle: false,
    platform: "node",
    umd: false,
    packageManager: "pnpm",
    extensions: {
      esm: ".mjs",
      cjs: ".cjs",
    },
    esbuildOptions: {
      target: "es2020",
    },
  },
});

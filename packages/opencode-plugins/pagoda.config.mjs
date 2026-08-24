import { defineConfig } from "@pagoda-cli/core";

export default defineConfig({
  name: "@aipanel/opencode-plugins",
  build: {
    mode: "lib",
    bundle: false,
    platform: "node",
    umd: false,
    packageManager: "pnpm",
    extensions: {
      cjs: ".cjs",
    },
    esbuildOptions: {
      target: "es2020",
    },
  },
});

import { defineConfig } from "@pagoda-cli/core";

export default defineConfig({
  name: "@vite-plugin-opencode-assistant/opencode",
  build: {
    mode: "lib",
    bundle: false,
    platform: "node",
    umd: false,
    packageManager: "pnpm",
  },
});

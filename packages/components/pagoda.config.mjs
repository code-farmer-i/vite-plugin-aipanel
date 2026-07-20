import { defineConfig } from "@pagoda-cli/core";

export default defineConfig({
  name: "@vite-plugin-opencode-assistant/components",
  build: {
    mode: "components",
    namedExport: true,
    packageManager: "pnpm",
    umd: false,
    bundle: false,
    extensions: {
      esm: ".mjs",
      cjs: ".cjs",
    },
  },
  site: {
    title: "OpenCode Widget Components",
    description: "Reusable OpenCode widget components built with Pagoda CLI",
    defaultRoute: "components/open-code-widget",
    nav: [
      {
        title: "组件",
        items: [{ title: "OpenCodeWidget", view: "open-code-widget" }],
      },
    ],
  },
});

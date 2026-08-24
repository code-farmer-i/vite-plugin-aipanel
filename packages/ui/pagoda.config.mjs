import { defineConfig } from "@pagoda-cli/core";

export default defineConfig({
  name: "@aipanel/ui",
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
    esbuildOptions: {
      target: "es2020",
    },
  },
  site: {
    title: "AIPanel Widget Components",
    description: "Reusable AIPanel widget components built with Pagoda CLI",
    defaultRoute: "components/AI-panel-widget",
    nav: [
      {
        title: "组件",
        items: [{ title: "AIPanelWidget", view: "AI-panel-widget" }],
      },
    ],
  },
});

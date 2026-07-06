import { defineConfig } from "@pagoda-cli/core";
import opencode from "vite-plugin-opencode-assistant";

export default defineConfig({
  name: "@vite-plugin-opencode-assistant/docs",
  site: {
    title: "vite-plugin-opencode-assistant",
    description: "基于 Pagoda CLI 的文档站，内置接入 vite-plugin-opencode-assistant。",
    defaultRoute: "home",
    nav: [
      {
        title: "指南",
        view: "guide/getting-started",
        items: [
          { title: "快速开始", view: "guide/getting-started" },
          { title: "插件配置", view: "guide/options" },
        ],
      },
    ],
    layout: {
      darkMode: true,
      showAnchor: true,
    },
    build: {
      vite: {
        configure(config) {
          config.plugins = config.plugins || [];
          config.plugins.push(
            ...opencode({
              displayMode: "extension",
              // warmupChromeMcp: false,
              // verbose: true,
            }),
          );
          return config;
        },
      },
    },
  },
});

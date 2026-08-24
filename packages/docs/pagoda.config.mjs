import { defineConfig } from "@pagoda-cli/core";
import opencode from "vite-plugin-aipanel";

export default defineConfig({
  name: "@aipanel/docs",
  site: {
    title: "vite-plugin-aipanel",
    description: "基于 Pagoda CLI 的文档站，内置接入 vite-plugin-aipanel。",
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
              provider: "deepseek",
              // warmupChromeMcp: false,
              verbose: true,
            }),
          );
          return config;
        },
      },
    },
  },
});

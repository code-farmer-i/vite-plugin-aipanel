import { defineConfig } from "@pagoda-cli/core";
import opencode from "vite-plugin-opencode-assistant";

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
  site: {
    headerTitle: "OpenCode Assistant",
    title: "OpenCode Assistant",
    description: "浏览器插件 + Vite 开发环境，将 OpenCode AI 助手嵌入你的本地开发页面",
    defaultRoute: "index",
    icon: "/logo.svg",
    logo: "/logo.svg",
    logoLink: "index",
    layout: {
      responsive: true,
      showAnchor: true,
      showSimulator: false,
    },
    nav: [
      { title: "首页", view: "index" },
      {
        title: "指南",
        view: "guide",
        items: [
          { title: "快速开始", view: "quickstart" },
          { title: "配置项", view: "config" },
          { title: "使用指南", view: "usage" },
        ],
      },
      { title: "更新日志", view: "changelog" },
      { title: "常见问题", view: "faq" },
    ],
    build: {
      publicPath: "",
      vite: {
        configure(config) {
          config.plugins = config.plugins || [];
          config.plugins.push(opencode());
          return config;
        },
      },
    },
  },
});

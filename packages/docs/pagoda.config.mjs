import { defineConfig } from "@pagoda-cli/core";
import aipanelPlugin from "vite-plugin-aipanel";

export default defineConfig({
  name: "@aipanel/docs",
  site: {
    headerTitle: "AIPanel Assistant",
    title: "vite-plugin-aipanel",
    description: "浏览器插件 + Vite 开发环境，将 AIPanel AI 助手嵌入你的本地开发页面",
    defaultRoute: "index",
    icon: "/logo.svg",
    logo: "/logo.svg",
    logoLink: "index",
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
    layout: {
      responsive: true,
      showAnchor: true,
      showSimulator: false,
    },
    build: {
      publicPath: "",
      vite: {
        configure(config) {
          config.plugins = config.plugins || [];
          config.plugins.push(
            ...aipanelPlugin({
              // mcpOnly: true,
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

---
name: pagoda-cli
description: "提供 Pagoda CLI 的配置、命令、常见问题排查以及组件/JS库开发指南。Invoke when user works with Pagoda CLI, builds components/libraries, writes docs, or encounters CLI errors."
metadata:
  author: Agent
  version: "2026-04-02"
  source: Generated from packages/pagoda-cli/docs/desktop/views
---

> The skill is based on pagoda-cli, generated at 2026-04-02.

本 Skill 集合提供了基于 Pagoda CLI 开发 Vue 组件库和纯 JS/TS 库的全面指南。涵盖了项目配置、组件开发规范、Markdown 文档编写以及常见异常排查等内容。

# Pagoda CLI Skills

## Advanced

| Topic | Description | Reference |
|---|---|---|
| 多语言支持 | Pagoda CLI 内置国际化支持，可以轻松创建多语言文档站。... | [advanced-i18n](references/advanced-i18n.md) |
| Monorepo 支持 | Pagoda CLI 支持 Monorepo 项目结构。... | [advanced-monorepo](references/advanced-monorepo.md) |
| TypeScript 支持 | Pagoda CLI 提供完整的 TypeScript 支持。... | [advanced-typescript-ide](references/advanced-typescript-ide.md) |
| Web Types | Pagoda CLI 可以自动生成 Web Types 文件，为 IDE 提供组件提示支持。... | [advanced-web-types](references/advanced-web-types.md) |

## Api

| Topic | Description | Reference |
|---|---|---|
| 运行时工具 | Pagoda CLI 为文档站提供了一些运行时工具，帮助你在文档中使用高级功能。... | [api-runtime](references/api-runtime.md) |

## Basics

| Topic | Description | Reference |
|---|---|---|
| 简介 | Pagoda CLI 是一个专为 Vue 组件库开发设计的现代化构建工具链，基于 Vite 构建，提... | [basics-introduction](references/basics-introduction.md) |
| 项目结构 | 推荐的项目结构，帮助你更好地组织组件库代码。... | [basics-project-structure](references/basics-project-structure.md) |
| 快速上手 | 本指南将带你从零开始，安装 Pagoda CLI 并快速搭建一个 Vue 组件库项目。... | [basics-quick-start](references/basics-quick-start.md) |

## Cli

| Topic | Description | Reference |
|---|---|---|
| 命令行工具 | Pagoda CLI 提供了一系列命令来辅助组件库的开发、构建、文档生成和发布。... | [cli-commands](references/cli-commands.md) |

## Config

| Topic | Description | Reference |
|---|---|---|
| build 构建配置 | 详细说明 `build` 配置项，控制组件库的构建行为。... | [config-build](references/config-build.md) |
| 发布钩子 | Pagoda CLI 支持在发布流程中执行自定义命令。... | [config-hooks](references/config-hooks.md) |
| 导航配置 | 详细说明文档站的导航和路由配置。... | [config-nav](references/config-nav.md) |
| 配置文件概述 | Pagoda CLI 使用 `pagoda.config.mjs` 作为配置文件，支持使用 `def... | [config-overview](references/config-overview.md) |
| 模拟器配置 | Pagoda CLI 支持桌面端文档站与移动端模拟器的联动预览。... | [config-simulator](references/config-simulator.md) |
| 站点结构 | 了解 Pagoda CLI 文档站的目录结构和文件组织方式。... | [config-site-structure](references/config-site-structure.md) |
| site 文档站配置 | 详细说明 `site` 配置项，控制文档站的内容和行为。... | [config-site](references/config-site.md) |
| 主题定制 | Pagoda CLI 支持自定义文档站主题样式。... | [config-theme](references/config-theme.md) |

## Faq

| Topic | Description | Reference |
|---|---|---|
| 常见问题排查 | 提供安装、构建、文档站白屏、类型未生成或发布等异常问题的排查思路与解决方案。... | [faq-faq](references/faq-faq.md) |

## Guide

| Topic | Description | Reference |
|---|---|---|
| 组件开发规范 | 提供 Vue 3 组件目录结构、命名、Props/Events 声明及样式隔离的可执行代码示例。... | [guide-component](references/guide-component.md) |
| 文档编写指南 | 提供 Pagoda CLI 专属的 Markdown 扩展语法规范和文档结构示例。... | [guide-documentation](references/guide-documentation.md) |
| 开发 JS 库规范 | 提供纯 JS/TS 库（如工具函数、SDK）的目录结构和构建配置规范。... | [guide-js-library](references/guide-js-library.md) |

## Publish

| Topic | Description | Reference |
|---|---|---|
| 构建模式 | Pagoda CLI 支持两种构建模式：**组件库模式** 和 **类库模式**。... | [publish-modes-formats](references/publish-modes-formats.md) |
| 样式处理 | Pagoda CLI 支持 CSS、Less 和 Sass 三种样式预处理器。... | [publish-styles](references/publish-styles.md) |
| 版本管理 | 版本发布策略和最佳实践。... | [publish-versioning](references/publish-versioning.md) |


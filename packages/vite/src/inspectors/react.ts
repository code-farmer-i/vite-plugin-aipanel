import { CodeInspectorEscapeTags, transformCode } from "@code-inspector/core";
import { INSPECTOR_ADAPTER_IDS } from "@aipanel/core";
import { detectViteFramework } from "../core/framework";
import type { InspectorIntegration } from "./types";

/** 参与 React 源码定位的文件类型（tsx 由内部 babel 以 TS 模式解析） */
const JSX_FILE_PATTERN = /\.(jsx|tsx)$/;

/**
 * React 集成：复用 code-inspector-plugin 的官方 transformCode API，在 dev 阶段为
 * 项目内 jsx/tsx 注入 data-insp-path 源码坐标标记（pathType: relative 以 git 仓库根
 * 为基准的相对路径，非 git 仓库时由其内部回退绝对路径）。
 *
 * enforce: pre 保证先于 JSX 擦除执行（@vitejs/plugin-react 与 plugin-react-swc 均适用）；
 * 仅 serve 生效，生产构建零影响。文件头部 code-inspector-disable/ignore 注释可整文件跳过。
 * Vue 项目（含 vue-jsx）的 jsx/tsx 是 Vue JSX，跳过注入；未识别框架（纯 esbuild JSX 的
 * React 等）保守放行。
 */
export const reactInspectorIntegration: InspectorIntegration = {
  id: INSPECTOR_ADAPTER_IDS.react,
  plugins: () => {
    let vueProject = false;
    return [
      {
        name: "aipanel:react-inspector",
        enforce: "pre",
        apply: "serve",
        configResolved(config) {
          vueProject = detectViteFramework(config) === INSPECTOR_ADAPTER_IDS.vue;
        },
        async transform(code, id) {
          if (vueProject) return null;
          const [filePath] = id.split("?");
          if (
            !filePath ||
            !JSX_FILE_PATTERN.test(filePath) ||
            filePath.includes("node_modules") ||
            filePath.startsWith("\0")
          ) {
            return null;
          }
          if (!code.includes("<")) return null;

          const result = await transformCode({
            content: code,
            filePath,
            fileType: "jsx",
            escapeTags: CodeInspectorEscapeTags,
            pathType: "relative",
          });
          // 无变化（内部门控跳过等）时返回 null，避免下游空跑流水线
          return result === code ? null : { code: result };
        },
      },
    ];
  },
};

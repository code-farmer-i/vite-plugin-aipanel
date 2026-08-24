/**
 * OpenCode Provider 专属类型
 * 所有与 OpenCode Web 绑定的类型自包含于此，核心层不感知。
 */
import type { LogFileConfig } from "@aipanel/core";

/**
 * OpenCode 界面语言选项
 */
export type OpenCodeLanguage =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "ja"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "pl"
  | "ru"
  | "bs"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "tr";

/**
 * OpenCode 内部设置（与 localStorage settings.v3 对应）
 * 用于配置 OpenCode Web 内部行为
 */
export interface OpenCodeSettings {
  /** 通用设置 */
  general?: {
    /** 自动保存 */
    autoSave?: boolean;
    /** 显示更新说明 */
    releaseNotes?: boolean;
    /** 后续动作模式 */
    followup?: "steer" | "suggest" | "none";
    /** 显示推理摘要 */
    showReasoningSummaries?: boolean;
    /** 默认展开 shell 工具部分 */
    shellToolPartsExpanded?: boolean;
    /** 默认展开编辑工具部分 */
    editToolPartsExpanded?: boolean;
  };

  /** 外观设置 */
  appearance?: {
    /** 界面字体大小 */
    fontSize?: number;
    /** 代码字体 */
    mono?: string;
    /** 界面字体 */
    sans?: string;
  };

  /** 权限设置 */
  permissions?: {
    /** 自动批准权限请求 */
    autoApprove?: boolean;
  };

  /** 通知设置 */
  notifications?: {
    /** 智能体完成时通知 */
    agent?: boolean;
    /** 权限请求时通知 */
    permissions?: boolean;
    /** 错误时通知 */
    errors?: boolean;
  };

  /** 音效设置 */
  sounds?: {
    /** 启用智能体音效 */
    agentEnabled?: boolean;
    /** 智能体音效 */
    agent?: string;
    /** 启用权限音效 */
    permissionsEnabled?: boolean;
    /** 权限音效 */
    permissions?: string;
    /** 启用错误音效 */
    errorsEnabled?: boolean;
    /** 错误音效 */
    errors?: string;
  };
}

/**
 * OpenCode Provider 专属配置（对应插件配置的 providerOptions 段）
 * 保留字符串索引签名，以赋给 PluginOptions 的 Record<string, unknown> 泛型约束。
 */
export type OpenCodeProviderOptions = {
  /** OpenCode 界面语言，默认跟随浏览器语言 */
  language?: OpenCodeLanguage;
  /** OpenCode 内部设置，直接映射到 localStorage settings.v3 */
  settings?: OpenCodeSettings;

  // === 日志文件配置（透传给 OpenCode agent 插件） ===
  /** 自定义日志文件配置 */
  logFiles?: LogFileConfig[];

  // === LSP 诊断配置 ===
  /** 启用 LSP 诊断（TypeScript + ESLint），agent 编辑文件后自动返回错误信息，默认 false */
  enableLsp?: boolean;
  /** 启用 LSP 错误硬阻止：编辑后有错误则回滚文件并拒绝修改，默认 false */
  enableBlockOnError?: boolean;
  /** 启用代码格式化功能（prettier），默认 true */
  enablePrettier?: boolean;

  /** 允许 Provider 自定义扩展字段（schema 由具体 Provider 定义） */
  [key: string]: unknown;
};

/**
 * OpenCode Web 服务启动选项（进程管理内部类型）
 */
export interface WebOptions {
  /** 服务端口 */
  port: number;
  /** 服务主机名 */
  hostname: string;
  /** 服务器 URL */
  serverUrl: string;
  /** 工作目录 */
  cwd: string;
  /** 配置目录路径 */
  configDir?: string;
  /** CORS 允许的源 */
  corsOrigins?: string[];
  /** 上下文 API URL */
  contextApiUrl?: string;
  /** 进程日志 API URL */
  logsApiUrl?: string;
  /** 日志文件配置（JSON 字符串） */
  logFilesJson?: string;
  /** 启用 LSP 错误硬阻止（环境变量透传给 OpenCode 插件） */
  enableBlockOnError?: boolean;
  /** 启用 verbose 模式（环境变量透传，调试日志输出） */
  verbose?: boolean;
  /** 启用 LSP / 质量门禁（环境变量透传，控制 block-on-error 插件运行） */
  enableLsp?: boolean;
  /** 启用代码格式化功能（prettier） */
  enablePrettier?: boolean;
  /** Vue DevTools API 地址（环境变量透传给 OpenCode 插件） */
  vueDevtoolsApiUrl?: string;
}

/**
 * OpenCode 会话信息（REST API 原始返回）
 */
export interface SessionInfo {
  /** 会话 ID */
  id: string;
  /** 会话标识符 */
  slug: string;
  /** 项目 ID */
  projectID: string;
  /** 项目目录 */
  directory: string;
  /** 会话标题 */
  title: string;
  /** 版本号 */
  version: string;
  /** 会话 URL */
  url?: string;
  /** 父会话 ID（subagent 会话才有） */
  parentID?: string;
  /** 代码变更统计 */
  summary: {
    /** 新增行数 */
    additions: number;
    /** 删除行数 */
    deletions: number;
    /** 修改文件数 */
    files: number;
  };
  /** 时间信息 */
  time: {
    /** 创建时间戳 */
    created: number;
    /** 更新时间戳 */
    updated: number;
    /** 归档时间戳（已归档会话才有） */
    archived?: number;
  };
}

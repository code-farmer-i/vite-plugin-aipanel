/**
 * DeepSeek Harness Provider 专属类型
 * dsh 契约（RPC envelope / 会话与工作区 wire / 事件词表 / 取值域）一律引用官方声明，
 * 不在此复刻；这里只保留本包自有的配置类型，核心层不感知。
 */
import type { BusyEnterBehavior } from "@deepseek-ai/dsh-client-ui-conversation";
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox";

/** 权限预设（对应 dsh settings permission.defaultPreset；取值域同官方 SandboxMode） */
export type DeepSeekPermissionPreset = SandboxMode;

/** 繁忙时 Enter 键行为（对应 dsh settings ui-conversation.busyEnter；取值同官方 BusyEnterBehavior） */
export type DeepSeekBusyEnter = BusyEnterBehavior;

/**
 * DeepSeek Provider 专属配置（对应插件配置的 providerOptions 段）
 * 保留字符串索引签名，以赋给 PluginOptions 的 Record<string, unknown> 泛型约束。
 */
export type DeepSeekProviderOptions = {
  /** dsh 数据目录（$DSH_HOME），默认跟随系统（~/.dsh） */
  home?: string;
  /** 默认 Agent 预设（dsh settings agent-presets.default，如 code/standard；新建会话的默认模式） */
  agentPreset?: string;
  /** 默认权限预设（dsh settings permission.defaultPreset） */
  permissionPreset?: DeepSeekPermissionPreset;
  /** 繁忙时 Enter 键行为（dsh settings ui-conversation.busyEnter） */
  busyEnter?: DeepSeekBusyEnter;
  /**
   * 编辑后自动诊断（对应 opencode providerOptions.enableLsp 的质量门禁语义）：
   * write/edit/apply_patch 执行后自动补跑 ESLint + vue-tsc：登记到 step 边界统一诊断，按文件内容
   * 去重后以 plugin 上下文消息插入下一步（原生编辑与 PTC 子调度同一路径）。
   * 与 opencode 一致默认开启；需与 enableDiagnostics 配合（总开关关闭时整体不注入）。
   */
  autoDiagnose?: boolean;
  /**
   * 诊断功能总开关：与 opencode 的 enableLsp 一致，默认开启。
   * 关闭时（enableDiagnostics: false）不注入任何诊断相关插件逻辑——
   * run_diagnostics 审查工具、编辑后自动诊断、会话诊断卡片视图都不注册。
   */
  enableDiagnostics?: boolean;
  /**
   * Provider 允许自定义扩展字段
   * [key: string]: unknown;
   */
  [key: string]: unknown;
};

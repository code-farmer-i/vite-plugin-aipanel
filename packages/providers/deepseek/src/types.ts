/**
 * DeepSeek Harness Provider 专属类型
 * dsh 契约（RPC envelope / 会话与工作区 wire / 事件词表 / 取值域）一律引用官方声明，
 * 不在此复刻；这里只保留本包自有的配置类型，核心层不感知。
 */
import type { DiagnosticsPolicy } from "@aipanel/core";
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
   * 诊断配置（检查来源 + 触发 + 投递；契约见 @aipanel/core 的 DiagnosticsPolicy）。
   * 用户只写要覆盖的字段，provider 负责归一化成完整策略后随 overlay 下发。
   */
  diagnostics?: Partial<DiagnosticsPolicy>;
  /**
   * Provider 允许自定义扩展字段
   * [key: string]: unknown;
   */
  [key: string]: unknown;
};

/** 归一化后的 Provider 选项：诊断策略一定是完整的（Partial 已在 provider 内解析） */
export type DeepSeekResolvedOptions = DeepSeekProviderOptions & {
  diagnostics: DiagnosticsPolicy;
};

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
  /**
   * dsh profile 名（$DSH_HOME/profiles/<name>），默认 "web"；AIPanel 侧插件与 web 进程都指向该 profile。
   *
   * ⚠️ 该 profile 必须**先建好**：其 `dsh.profile.bundles` 里要有 `@deepseek-ai/dsh-web-app`。
   * 缺失时 dsh 的 `plugin` 子命令会自己建出一个只有 `@deepseek-ai/dsh-base` 的空壳，
   * 于是启动只会表现为"等 launch token 超时"（见 profile-check.ts 的预检与说明）。
   */
  profile?: string;
  /**
   * 机器级设置（模型供应商 / 搜索源 / MCP）从哪个 profile 继承，作为一层 `--patch` 叠在目标 profile 之上。
   *
   * 默认 `web`（即 `providerOptions.profile` 的默认值）：**默认就叠，用户不需要配**。dsh 没有
   * "profile 继承 profile"，不叠的话自建 profile 只会用建 profile 那一刻的快照，于是"我在 web 里
   * 配过的东西这里看不到"。目标 profile 就是来源时自动跳过（等于不叠）。
   *
   * `false` = 不叠（只保留目标 profile 自己的配置）。每个界面自己的偏好（主题等）**永远不继承** ——
   * 那类行跟着来源走会把界面锁死（见 settings-layer.ts）。
   */
  settingsFrom?: string | false;
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

/** 归一化后的 Provider 选项：诊断策略一定是完整的（Partial 已在 provider 内解析），profile / settingsFrom 一定落到默认值 */
export type DeepSeekResolvedOptions = DeepSeekProviderOptions & {
  profile: string;
  settingsFrom: string | false;
  diagnostics: DiagnosticsPolicy;
};

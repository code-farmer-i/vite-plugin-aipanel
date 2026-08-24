import type { ProviderInitContext, WebProvider } from "@aipanel/core";

/**
 * id → Provider npm 包名映射（登记制）
 * "default" 是默认别名（未配置 provider 时的兜底），其他键为 Provider 真实 id。
 * 这里只有包名字符串，无静态依赖；加载与初始化完全由 Provider 包自身完成。
 */
const PROVIDER_PACKAGES: Record<string, string> = {
  default: "@aipanel/provider-opencode",
  opencode: "@aipanel/provider-opencode",
};

/**
 * 按 id 动态加载 Provider 包并初始化
 * 约定：Provider 包必须导出 createProvider(ctx): WebProvider 工厂
 */
export async function loadProvider(id: string, ctx: ProviderInitContext): Promise<WebProvider> {
  const pkg = PROVIDER_PACKAGES[id];
  if (!pkg) {
    throw new Error(
      `未知的 Web Provider: "${id}"。可用 Provider: ${Object.keys(PROVIDER_PACKAGES).join(", ") || "(无)"}`,
    );
  }

  let mod: { createProvider?: (ctx: ProviderInitContext) => WebProvider };
  try {
    mod = (await import(pkg)) as {
      createProvider?: (ctx: ProviderInitContext) => WebProvider;
    };
  } catch (e) {
    const error = new Error(
      `加载 Web Provider 包 "${pkg}" 失败（请确认已正确安装）：${e instanceof Error ? e.message : String(e)}`,
    );
    (error as { cause?: unknown }).cause = e;
    throw error;
  }
  if (typeof mod.createProvider !== "function") {
    throw new Error(`Provider 包 "${pkg}" 未导出 createProvider 工厂`);
  }

  return mod.createProvider(ctx);
}

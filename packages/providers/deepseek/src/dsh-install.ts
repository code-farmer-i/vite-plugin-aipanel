/**
 * dsh 侧插件的安装辅助（client 浏览器插件 / host 宿主插件）。
 *
 * 统一走官方方式：`dsh plugin --profile web add <target>`（该命令把参数转发给
 * profile 目录里的 pnpm 执行安装）。target 取值：
 *   - dev（本仓库 workspace）：本地目录绝对路径（pnpm 支持本地目录，改代码 → 重建 → 重启生效）
 *   - 生产：npm 包名 `@aipanel/dsh-client` / `@aipanel/dsh-plugin`
 *
 * overlay 的插件行是否注入由"包是否可解析"决定：add 失败时静默降级
 * （仅失去对应能力，如 @ 菜单 chip 高亮 / 审查工具），不阻塞 dsh 启动。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { createLogger } from "@aipanel/core/node";

const log = createLogger("DshInstall");

export const DSH_CLIENT_PACKAGE = "@aipanel/dsh-client";
export const DSH_PLUGIN_PACKAGE = "@aipanel/dsh-plugin";

/** 包名 → 其 package.json 相对路径（scoped 包拆分两级） */
function packageJsonIn(profileDir: string, packageName: string): string {
  return path.join(profileDir, "node_modules", ...packageName.split("/"), "package.json");
}

/**
 * 是否为 dev workspace 且某 dsh 包产物就绪（存在 package.json 与产物文件）。
 * 生产安装的 provider 在 node_modules/@aipanel/provider-deepseek/ 下，上一级不是 dsh-*，返回 null。
 * @param metaUrl 调用方 import.meta.url（provider 源码 es/lib 的上一级是 packages/providers/deepseek）
 * @param subdir  dev 子目录名（"dsh-client" | "dsh-plugin"）
 * @param distRel 产物相对路径（client 为 "lib/client.js"，plugin 为 "dist/index.js"）
 */
export function resolveDevDshPackageSource(
  metaUrl: string,
  subdir: string,
  distRel: string,
): string | null {
  const here = path.dirname(fileURLToPath(metaUrl));
  const devDir = path.resolve(here, `../${subdir}`);
  if (
    fs.existsSync(path.join(devDir, "package.json")) &&
    fs.existsSync(path.join(devDir, distRel))
  ) {
    return devDir;
  }
  return null;
}

/** dsh web profile 目录（固定 --profile web）；home 未指定时回退 $DSH_HOME / ~/.dsh */
export function dshProfileDir(home?: string): string {
  const resolved = home || process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(resolved, "profiles", "web");
}

/** 某 @aipanel/dsh-* 包在 profile 的 node_modules 中是否可解析 */
export function isDshPackageInstalled(profileDir: string, packageName: string): boolean {
  return fs.existsSync(packageJsonIn(profileDir, packageName));
}

/**
 * 确保某 @aipanel/dsh-* 包已安装且为最新（官方命令 dsh plugin add）。
 * 每次启动都执行（不跳过已安装）：dev 本地目录每次重装保证改代码生效，
 * 生产 npm 包每次检查 registry 拉取最新版本。安装失败返回 false（不阻塞启动，
 * 仅对应 overlay 行停用，如失去 chip 高亮 / 审查工具）。
 */
export async function ensureDshPackage(
  profileDir: string,
  packageName: string,
  target: string,
  home?: string,
): Promise<boolean> {
  try {
    log.debug(`installing ${target} into dsh profile via dsh plugin add`);
    await execa("dsh", ["plugin", "--profile", "web", "add", target], {
      reject: true,
      shell: true,
      env: {
        ...process.env,
        ...(home ? { DSH_HOME: home } : {}),
      },
    });
    if (!isDshPackageInstalled(profileDir, packageName)) {
      log.warn(`dsh plugin add finished but ${packageName} is not resolvable`, {
        profileDir,
      });
      return false;
    }
    return true;
  } catch (e) {
    log.warn(`failed to install ${packageName} via dsh plugin add`, {
      target,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

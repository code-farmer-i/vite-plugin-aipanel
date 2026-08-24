/**
 * dsh-client 浏览器插件的安装辅助。
 *
 * 统一走官方方式：`dsh plugin --profile web add <target>`（该命令把参数转发给
 * profile 目录里的 pnpm 执行安装）。target 取值：
 *   - dev（本仓库 workspace）：本地 dsh-client 目录绝对路径（pnpm 支持本地目录，改代码 → 重建 → 重启生效）
 *   - 生产：npm 包名 `@aipanel/dsh-client`
 *
 * overlay 的 client 行是否注入由"包是否可解析"决定：add 失败时静默降级
 * （仅失去 @ 菜单 chip 高亮），不阻塞 dsh 启动。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { createLogger } from "@aipanel/core/node";

const log = createLogger("DshInstall");

export const DSH_CLIENT_PACKAGE = "@aipanel/dsh-client";

/**
 * 是否为 dev workspace 且 dsh-client 产物就绪（存在 package.json 与 lib/client.js）。
 * 生产安装的 provider 在 node_modules/@aipanel/provider-deepseek/ 下，上一级不是 dsh-client，返回 null。
 */
export function resolveDevDshClientSource(metaUrl: string): string | null {
  const here = path.dirname(fileURLToPath(metaUrl));
  // es|lib 的上一级 → packages/providers/deepseek/dsh-client
  const devDir = path.resolve(here, "../dsh-client");
  if (
    fs.existsSync(path.join(devDir, "package.json")) &&
    fs.existsSync(path.join(devDir, "lib/client.js"))
  ) {
    return devDir;
  }
  return null;
}

/** dsh web profile 目录（固定 --profile web） */
export function dshProfileDir(): string {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "profiles", "web");
}

/** @aipanel/dsh-client 在 profile 的 node_modules 中是否可解析 */
export function isDshClientInstalled(profileDir: string): boolean {
  return fs.existsSync(
    path.join(profileDir, "node_modules", "@aipanel", "dsh-client", "package.json"),
  );
}

/**
 * 确保 @aipanel/dsh-client 已安装且为最新（官方命令 dsh plugin add）。
 * 每次启动都执行（不跳过已安装）：dev 本地目录每次重装保证改代码生效，
 * 生产 npm 包每次检查 registry 拉取最新版本。安装失败返回 false（不阻塞启动，仅 chip 高亮不可用）。
 */
export async function ensureDshClient(profileDir: string, target: string): Promise<boolean> {
  try {
    log.debug(`installing ${target} into dsh profile via dsh plugin add`);
    await execa("dsh", ["plugin", "--profile", "web", "add", target], {
      reject: true,
      shell: true,
    });
    if (!isDshClientInstalled(profileDir)) {
      log.warn(`dsh plugin add finished but ${DSH_CLIENT_PACKAGE} is not resolvable`, {
        profileDir,
      });
      return false;
    }
    return true;
  } catch (e) {
    log.warn(`failed to install ${DSH_CLIENT_PACKAGE} via dsh plugin add`, {
      target,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

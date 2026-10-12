/**
 * 目标 dsh profile 的**通用**预检。
 *
 * 为什么必须有：`dsh plugin --profile <名> …` 在 profile 目录缺失时会**自己初始化**一个
 * （只有 `@deepseek-ai/dsh-base`、没有 web 应用），而 provider 的编排是"先装机、再起进程"
 * —— 于是没跑过目标 profile 自己那套安装流程的机器上，会先被静默建出一个空壳 profile，
 * 接着 `dsh --profile <名>` 起不了 Web、stdout 永远不打印 launch token，20 秒后表现为
 * "启动超时"，根因完全看不见（实测：`dsh plugin --profile <新名> list` 会打印
 * `dsh: initialized profile <新名> at …`，而那份 package.json 的 bundles 只有 dsh-base）。
 *
 * 判据只用 **dsh 自己的 profile 契约**：目录在不在、`dsh.profile.bundles` 里有没有 web 应用。
 * 本包不认识、也不判任何具体插件 —— profile 里装了哪些插件与这里无关。
 */
import fs from "node:fs";
import path from "node:path";

/** dsh 的 Web 应用 bundle（`dsh web` 的 profile 必有；纯终端类 profile 没有） */
export const DSH_WEB_APP_BUNDLE = "@deepseek-ai/dsh-web-app";

export type DshProfileProblem = "missing" | "no-web-app";

export interface DshProfileInspection {
  /** 这个 profile 现在能不能起 Web UI */
  readonly ok: boolean;
  /** 不能时是哪一类问题；能时为 null */
  readonly problem: DshProfileProblem | null;
  /** profile 声明的 bundle 列表（读不到时为空数组） */
  readonly bundles: readonly string[];
  /** profile 清单文件路径（报错信息里给绝对路径，方便直接去看） */
  readonly manifest: string;
}

/** 读 profile 清单并判断它是否具备启动 Web UI 的条件 */
export function inspectDshProfile(profileDir: string): DshProfileInspection {
  const manifest = path.join(profileDir, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
  } catch {
    return { ok: false, problem: "missing", bundles: [], manifest };
  }
  const declared = (parsed as { dsh?: { profile?: { bundles?: unknown } } } | null)?.dsh?.profile
    ?.bundles;
  const bundles = Array.isArray(declared)
    ? declared.filter((one): one is string => typeof one === "string")
    : [];
  if (!bundles.includes(DSH_WEB_APP_BUNDLE)) {
    return { ok: false, problem: "no-web-app", bundles, manifest };
  }
  return { ok: true, problem: null, bundles, manifest };
}

/** 预检没过时给用户的说明（通用措辞：说清是什么、去哪看、怎么修） */
export function profileProblemText(
  inspection: DshProfileInspection,
  profileDir: string,
  profile: string,
): string {
  const head =
    inspection.problem === "missing"
      ? `dsh profile "${profile}" 还不存在（找不到 ${inspection.manifest}）`
      : `dsh profile "${profile}" 里没有 Web 应用 bundle（${DSH_WEB_APP_BUNDLE}）`;
  const bundles =
    inspection.bundles.length === 0
      ? "（读不到 bundle 列表）"
      : `现有 bundles：${inspection.bundles.join("、")}`;
  return [
    `${head}：${profileDir}`,
    `  ${bundles}`,
    "  dsh 在 profile 缺失时会自己建一个只有 @deepseek-ai/dsh-base 的空壳，起来不会有界面；",
    "  而 provider 的编排是「先装插件、再起进程」，那一步会把空壳建出来，症状只是启动超时。",
    "  先把这个 profile 建好（它自己的安装流程，或 `dsh <名> --from-default-profile web`）再重开。",
  ].join("\n");
}

/** 启动超时诊断用的一行上下文：profile 在哪、声明了哪些 bundle */
export function describeDshProfile(profileDir: string, profile: string): string {
  const inspection = inspectDshProfile(profileDir);
  const bundles = inspection.bundles.length === 0 ? "（读不到）" : inspection.bundles.join("、");
  return `profile: ${profile} (${profileDir})\nbundles: ${bundles}`;
}

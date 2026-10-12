/**
 * 把「另一个 profile 的配置」叠到目标 profile 上（默认：机器级设置住 `web`，自建 profile 跟着它）。
 *
 * 为什么需要：dsh 的组合层只有 `bundle → profile → home → --patch` 四层，**没有 profile 继承 profile**。
 * 于是"在 `dsh web` 里配过的供应商 / 搜索源 / MCP，在自建 profile 里看不到"这件事，只能由**启动者**
 * 用一条额外的 `--patch` 解决（dsh-workbench 的启动器就是这么做的；AIPanel 之前没做，同一台机器上
 * 两条入口的设置因此不一致）。
 *
 * 为什么**默认开着**：机器级设置只配一次是默认预期，不是可选项 —— 要求用户去改配置的方案等于没解决。
 * `providerOptions.settingsFrom` 只在"想换来源 / 想干脆不叠"时才写。
 *
 * 为什么要有跳过名单：`--patch` 是**最高层**，会盖掉目标 profile 自己那份；而有些行是"每个界面自己
 * 的偏好"。实测踩过：`ui-theme` 被盖住之后，在工作台里切浅色会**自动跳回** web 的深色。
 * 机器级那类（模型 / 搜索 / MCP）跟着默认 profile 才是对的，不跳。
 */
import fs from "node:fs";
import path from "node:path";
import { AIPANEL_CACHE_DIR, createLogger } from "@aipanel/core/node";
import { dshProfileDir } from "./dsh-install";

const log = createLogger("DeepSeekSettings");

/** 不跟着来源走的那几行（每个界面自己的偏好）；理由见文件头 */
export const INHERIT_SKIP_IDS: readonly string[] = ["ui-theme"];

/** 生成层落在项目缓存目录，与 AIPanel 自己的 overlay 同处 */
export const INHERIT_LAYER_FILENAME = "dsh-inherit.cordis.yml";

/**
 * 该从哪个 profile 继承。
 * @param settingsFrom 解析后的选项：profile 名 / `false`（不叠）
 * @returns 源 profile 名；`null` = 不叠（关掉了，或目标就是它自己）
 */
export function inheritSourceOf(profile: string, settingsFrom: string | false): string | null {
  if (settingsFrom === false) return null;
  return settingsFrom === profile ? null : settingsFrom;
}

/**
 * 按**顶层条目**剥掉若干 `- id:` 块（与 dsh-workbench 启动器里那段 awk 同口径：从命中的 `- ` 行
 * 一路丢到下一个顶层 `- ` 为止）。手写而不是上 YAML 库：这一层只是转交一份文本，没必要为它引入依赖，
 * 也不能因为来源文件里有 `!!js` 之类的 dsh 扩展标签就解析失败。
 */
export function stripEntries(text: string, skipIds: readonly string[]): string {
  const skip = new Set(skipIds);
  const kept: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      const id = /^- id:\s*"?([^"\s]+)"?\s*$/.exec(line)?.[1];
      dropping = id !== undefined && skip.has(id);
    }
    if (!dropping) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * 写出继承层并返回它的路径；来源不存在/读不动时返回 `null`（**不阻断启动**：少了它只是回到老行为）。
 */
export function writeInheritLayer(input: {
  cwd: string;
  home?: string | undefined;
  source: string;
}): string | null {
  const source = path.join(dshProfileDir(input.source, input.home), "cordis.patch.yml");
  let text: string;
  try {
    text = fs.readFileSync(source, "utf8");
  } catch {
    log.debug("来源 profile 没有可叠的配置，跳过", { source });
    return null;
  }
  const dir = path.join(input.cwd, AIPANEL_CACHE_DIR, "dsh");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, INHERIT_LAYER_FILENAME);
  fs.writeFileSync(file, stripEntries(text, INHERIT_SKIP_IDS), "utf8");
  log.debug("已叠上来源 profile 的配置", { source, file, skipIds: INHERIT_SKIP_IDS });
  return file;
}

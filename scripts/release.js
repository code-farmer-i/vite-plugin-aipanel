/**
 * 发布脚本：可中断、可续跑、幂等。
 *
 * 为什么不是「失败就回滚版本号」：
 *   npm 发布不可逆且是逐个包上传的，一旦第 N 个包出错，前 N-1 个包已经进了 registry。
 *   此时把本地版本号回滚，只会在本地和 registry 之间制造分叉：本地看起来「还没发过」，
 *   registry 上却已经躺着半套 vX。因此这里的分工是：
 *     1. 上传之前先彩排（pnpm publish --dry-run），把打包类错误挡在「零上传」阶段；
 *     2. 真的开始上传后，registry 是唯一事实来源，失败/中断时先查 registry 再决定动作；
 *     3. 零上传 → 回滚本地版本号；已有上传 → 保留版本号 + 落盘 .release-state.json + 续跑。
 *   pnpm 的 recursive publish 会跳过 registry 上已存在的版本，所以「续跑」天然幂等，
 *   重复执行不会重复发布，也不会因为「版本已存在」失败。
 *
 * 用法见 --help。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import enquirer from "enquirer";
import semver from "semver";
import { deployDocs } from "./deploy-docs.js";

const { prompt } = enquirer;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const REGISTRY = "https://registry.npmjs.org/";
const PACKUMENT_ACCEPT = "application/vnd.npm.install-v1+json";
const ROOT_PACKAGE_JSON = path.join(rootDir, "package.json");
const PACKAGES_DIR = path.join(rootDir, "packages");
const MANIFEST_PATH = path.join(PACKAGES_DIR, "extension", "src", "manifest.json");
const CHANGELOG_PATH = path.join(PACKAGES_DIR, "docs", "site", "desktop", "views", "changelog.md");
const STATE_PATH = path.join(rootDir, ".release-state.json");
const STATE_NAME = path.relative(rootDir, STATE_PATH);
const MAX_PUBLISH_ATTEMPTS = 3;
const MAX_REGISTRY_ATTEMPTS = 3;
/** registry 写入有同步延迟：判定失败前先复查几次，别把「已上传但还没查到」当成没发 */
const FAILURE_PROBE = { attempts: 2, delayMs: 2000 };
const FINAL_PROBE = { attempts: 4, delayMs: 3000 };

/** 发布流程阶段：失败时据此判断「有没有可能已经上传过」 */
const Stage = {
  PREFLIGHT: "preflight",
  SYNC: "sync",
  BUILD: "build",
  REHEARSAL: "rehearsal",
  PUBLISH: "publish",
  DOCS: "docs",
  GIT: "git",
  DONE: "done",
};

/** 本次发布的运行时状态，进程级单例 */
const releaseRun = {
  stage: Stage.PREFLIGHT,
  fromVersion: "",
  targetVersion: "",
  /** 是否为 --resume 续跑：续跑时目标版本可能已有包在 registry 上，失败后不能盲目回滚 */
  resumed: false,
};

class ReleaseError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- 进程与文件

/**
 * 同步执行子进程。
 * capture 时输出走管道（供读取），否则继承父进程 stdio——**发布必须继承**，
 * 否则 pnpm 判定为非交互终端，需要交互确认的环节会直接失败。
 */
function sh(
  command,
  args,
  { cwd = rootDir, capture = false, quiet = false, allowFailure = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf-8",
  });
  const output = capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
  if (capture && !quiet) process.stdout.write(output);
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (!allowFailure && status !== 0) {
    throw new ReleaseError(
      `命令失败（exit ${status}）：${command} ${args.join(" ")}${output.trim() ? `\n${output.trim()}` : ""}`,
    );
  }
  return { status, output, signal: result.signal };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** 递归收集 packages/ 下所有 package.json（含 providers 深层嵌套，跳过 node_modules 与隐藏目录） */
function collectPackageJsonPaths(dir = PACKAGES_DIR) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      result.push(...collectPackageJsonPaths(full));
    } else if (entry === "package.json") {
      result.push(full);
    }
  }
  return result;
}

/** 全部 non-private 的 workspace 包（pnpm publish 只发布这些） */
function listPublishablePackages() {
  return collectPackageJsonPaths()
    .map((jsonPath) => ({ jsonPath, json: readJson(jsonPath) }))
    .filter(({ json }) => Boolean(json.name) && !json.private)
    .map(({ jsonPath, json }) => ({ name: json.name, dir: path.dirname(jsonPath), jsonPath }));
}

/** 把版本号同步到根包、所有 workspace 包与扩展 manifest（发布与回滚共用同一实现） */
function syncVersions(version) {
  const changed = [];
  const rootPackageJson = readJson(ROOT_PACKAGE_JSON);
  if (rootPackageJson.version !== version) {
    rootPackageJson.version = version;
    writeJson(ROOT_PACKAGE_JSON, rootPackageJson);
    changed.push("package.json");
  }
  for (const jsonPath of collectPackageJsonPaths()) {
    const pkg = readJson(jsonPath);
    if (pkg.version === version) continue;
    pkg.version = version;
    writeJson(jsonPath, pkg);
    changed.push(pkg.name ?? path.relative(rootDir, jsonPath));
  }
  if (fs.existsSync(MANIFEST_PATH)) {
    const manifest = readJson(MANIFEST_PATH);
    if (manifest.version !== version) {
      manifest.version = version;
      writeJson(MANIFEST_PATH, manifest);
      changed.push("extension/manifest.json");
    }
  }
  console.log(
    changed.length
      ? `   ✅ 版本号已同步为 v${version}：${changed.join("、")}`
      : `   ℹ️  所有文件已是 v${version}`,
  );
}

function saveState(state) {
  writeJson(STATE_PATH, state);
}

function loadState() {
  return fs.existsSync(STATE_PATH) ? readJson(STATE_PATH) : null;
}

function clearState() {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
}

/** 上一次提交（HEAD）里的根版本号，用于 --resume 但状态文件缺失时推断回滚点 */
function readCommittedVersion() {
  try {
    const result = sh("git", ["show", "HEAD:package.json"], {
      capture: true,
      quiet: true,
      allowFailure: true,
    });
    return result.status === 0 ? (JSON.parse(result.output).version ?? "") : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- registry

async function fetchVersions(name) {
  const url = `${REGISTRY}${name.replace("/", "%2F")}`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_REGISTRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: PACKUMENT_ACCEPT } });
      if (response.status === 404) return {};
      if (!response.ok)
        throw new ReleaseError(`registry 查询失败：${name} → HTTP ${response.status}`);
      const packument = await response.json();
      return packument.versions ?? {};
    } catch (error) {
      lastError = error;
      if (attempt < MAX_REGISTRY_ATTEMPTS) await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

/** 以 registry 为事实来源：目标版本下「已发布 / 未发布」各是哪些包 */
async function inspectTarget(targetVersion) {
  const packages = listPublishablePackages();
  const versions = new Map(
    await Promise.all(packages.map(async (pkg) => [pkg.name, await fetchVersions(pkg.name)])),
  );
  const published = packages
    .filter((pkg) => versions.get(pkg.name)?.[targetVersion])
    .map((pkg) => pkg.name);
  return {
    packages: packages.map((pkg) => pkg.name),
    published,
    pending: packages.filter((pkg) => !published.includes(pkg.name)).map((pkg) => pkg.name),
  };
}

/**
 * 轮询 registry，直到目标版本的包都可见或次数用尽，返回最后一次实况。
 * npm 写入后 packument 需要一段时间才更新，单次查询会把刚发布的包读成「没发出去」。
 */
async function verifyPublished(targetVersion, { attempts, delayMs }) {
  let progress = await inspectTarget(targetVersion);
  for (let attempt = 1; attempt < attempts && progress.pending.length; attempt += 1) {
    console.log(
      `   … registry 还没同步到 v${targetVersion}（${progress.published.length}/${progress.packages.length}），${delayMs / 1000} 秒后复查`,
    );
    await sleep(delayMs);
    progress = await inspectTarget(targetVersion);
  }
  return progress;
}

// ---------------------------------------------------------------- 命令行

function parseArgs(argv) {
  const options = {
    help: false,
    resume: false,
    yes: false,
    dryRun: false,
    skipBuild: false,
    skipRehearsal: false,
    skipDocs: false,
    allowDirty: false,
    target: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const value = () => (inline !== undefined ? inline : (argv[++i] ?? ""));
    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--resume":
        options.resume = true;
        break;
      case "-y":
      case "--yes":
        options.yes = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--skip-rehearsal":
        options.skipRehearsal = true;
        break;
      case "--skip-docs":
        options.skipDocs = true;
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--target":
        options.target = value();
        break;
      default:
        throw new ReleaseError(`未知参数：${flag}（用 --help 查看用法）`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`
发布脚本：可中断、可续跑、幂等

  pnpm run release                        交互式发布新版本
  pnpm run release:resume                 续跑上一次中断的发布
  pnpm run release:dry-run                彩排：改版本号 + 构建 + publish --dry-run，不上传

  node scripts/release.js --target 1.4.0 --yes

选项：
  --resume          读取 ${STATE_NAME} 续跑，不重新选择版本号
  --target <ver>    直接指定目标版本号（跳出版本选择）
  -y, --yes         跳过确认（配合 --target 可无人值守）
  --dry-run         只彩排不发布，结束后回滚本地版本号
  --skip-build      续跑时跳过构建
  --skip-rehearsal  跳过 dry-run 彩排（不推荐）
  --skip-docs       跳过文档部署
  --allow-dirty     允许工作区有未提交的改动
`);
}

// ---------------------------------------------------------------- 各阶段

function checkNpmLogin() {
  const whoami = sh("npm", ["whoami", `--registry=${REGISTRY}`, "--silent"], {
    capture: true,
    quiet: true,
    allowFailure: true,
  });
  const user = whoami.output.trim();
  if (whoami.status === 0 && user) {
    console.log(`✅ npm 已登录：${user}`);
    return;
  }
  if (!/ENEEDAUTH|not logged in|401|Unauthorized/i.test(whoami.output)) {
    console.log("⚠️  无法确认 npm 登录状态（可能只是本地 npm 缓存问题，也可能是未登录）：");
    console.log(`   ${whoami.output.trim().split("\n")[0] || whoami.output.trim()}`);
    console.log("   即使未登录也不会留下半套发布：第一个包就会失败，此时本地版本号会自动回滚。");
    return;
  }
  console.log("⚠️  npm 未登录，启动登录流程…\n");
  const login = sh("npm", ["login", `--registry=${REGISTRY}`], { allowFailure: true });
  if (login.status !== 0) throw new ReleaseError("npm 登录失败");
  console.log("\n✅ 登录成功\n");
}

function preflight(options, { checkDirty }) {
  if (checkDirty && !options.allowDirty) {
    const status = sh("git", ["status", "--porcelain"], { capture: true, quiet: true });
    const dirty = status.output.trim();
    if (dirty) {
      throw new ReleaseError(
        `工作区有未提交的改动，发布会把它们一起提交：\n${dirty}\n请先提交或暂存；确认无碍可加 --allow-dirty。`,
      );
    }
  }
  checkNpmLogin();
}

function remindChangelog(targetVersion) {
  try {
    if (!fs.readFileSync(CHANGELOG_PATH, "utf-8").includes(`## v${targetVersion}`)) {
      console.log(
        `\n⚠️  更新日志还没有 "## v${targetVersion}" 段落：${path.relative(rootDir, CHANGELOG_PATH)}`,
      );
      console.log("   发布完成后文档会立即部署，建议先补上（发布提交会一起入库）。");
    }
  } catch {
    // 更新日志缺失只做提醒，不阻断发布
  }
}

async function askVersion(currentVersion) {
  const preReleaseId = currentVersion.match(/-(alpha|beta|rc)\.\d+$/)?.[1];
  const increments = [
    "patch",
    "minor",
    "major",
    ...(preReleaseId ? ["prepatch", "preminor", "premajor", "prerelease"] : []),
  ];
  const choices = increments.map(
    (increment) => `${increment} (${semver.inc(currentVersion, increment, preReleaseId)})`,
  );
  const { selected } = await prompt({
    type: "select",
    name: "selected",
    message: "选择发布类型",
    choices: choices.concat("custom"),
  });
  if (selected !== "custom") return selected.match(/\((.*)\)/)[1];
  const { version } = await prompt({
    type: "input",
    name: "version",
    message: "输入自定义版本号",
    initial: currentVersion,
  });
  return version;
}

function printPlan(targetVersion, inspect) {
  const names = inspect?.packages ?? listPublishablePackages().map((pkg) => pkg.name);
  console.log(`\n将发布 v${targetVersion}（可发布的包共 ${names.length} 个）：`);
  for (const name of names) {
    const published = inspect ? inspect.published.includes(name) : false;
    console.log(`   ${published ? "⏭️  已在 registry，将跳过" : "📤"} ${name}`);
  }
  if (inspect?.published.length) {
    console.log(
      `\n⚠️  v${targetVersion} 已经有 ${inspect.published.length} 个包在 registry 上，本次只补发剩下的。`,
    );
  }
  console.log("\n流程：同步版本号 → 构建 → 彩排(dry-run) → 发布 → 部署文档 → 提交/打 tag/推送");
}

function build() {
  console.log("\n🔨 构建所有包…");
  sh("pnpm", ["run", "build"]);
  console.log("   ✅ 构建完成");
}

function publishArgs({ dryRun }) {
  const args = ["-r", "publish", "--access", "public", "--no-git-checks", `--registry=${REGISTRY}`];
  if (dryRun) args.push("--dry-run");
  return args;
}

/** 彩排：只打包不上传，把「包本身有问题」这类错误挡在任何上传之前 */
function rehearse(options) {
  console.log("\n🧪 彩排（pnpm publish --dry-run，只打包、不上传）…");
  const result = sh("pnpm", publishArgs({ ...options, dryRun: true }), { allowFailure: true });
  if (result.status !== 0) {
    throw new ReleaseError(
      "彩排失败：上面的包无法正常打包/发布，修好再发（registry 上还没有任何本次改动）",
    );
  }
  console.log("   ✅ 彩排通过");
}

/**
 * 发布。pnpm 会跳过 registry 上已存在的版本，所以这个命令天然可重复执行；
 * 失败时以 registry 为准判断进度，并重试剩余的包。
 */
async function publish(options, targetVersion) {
  console.log("\n📤 发布（pnpm publish 会自动跳过已存在的版本）…");
  const args = publishArgs(options);
  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    const result = sh("pnpm", args, { allowFailure: true });
    if (result.status === 0) return;
    if (result.signal) throw new ReleaseError(`发布进程被 ${result.signal} 中断`);
    const progress = await verifyPublished(targetVersion, FAILURE_PROBE);
    console.log(
      `\n⚠️  第 ${attempt} 次发布中断：registry 上已有 ${progress.published.length}/${progress.packages.length} 个包`,
    );
    if (!progress.pending.length) {
      console.log("   待发布的包其实都已就位，继续后续流程");
      return;
    }
    console.log(`   仍缺：${progress.pending.join("、")}`);
    if (attempt < MAX_PUBLISH_ATTEMPTS) {
      console.log(`   ${attempt * 2} 秒后重试（已发布的包会自动跳过）…`);
      await sleep(attempt * 2000);
    }
  }
  throw new ReleaseError(`发布失败：尝试 ${MAX_PUBLISH_ATTEMPTS} 次后仍有包未发布`);
}

function commitAndPush(targetVersion) {
  const message = `chore: 发布版本 v${targetVersion}`;
  const tag = `v${targetVersion}`;
  console.log("\n📝 提交、推送并打 tag…");
  sh("git", ["add", "-A"]);
  const committed = sh("git", ["commit", "-m", message], { capture: true, allowFailure: true });
  if (committed.status !== 0) {
    if (/nothing to commit|no changes added/i.test(committed.output)) {
      console.log("   ℹ️  没有需要提交的改动，跳过 commit");
    } else {
      throw new ReleaseError(`git commit 失败：\n${committed.output.trim()}`);
    }
  }
  const tagged = sh("git", ["tag", tag], { capture: true, allowFailure: true });
  if (tagged.status !== 0) {
    if (/already exists/i.test(tagged.output)) console.log(`   ℹ️  tag ${tag} 已存在，跳过`);
    else throw new ReleaseError(`git tag 失败：\n${tagged.output.trim()}`);
  }
  sh("git", ["push"]);
  sh("git", ["push", "origin", tag]);
  console.log(`   ✅ 已提交、推送并打 tag ${tag}`);
}

/** 发布成功后的收尾：部署文档 → git 入库 */
async function finish(options, targetVersion) {
  let docsError = "";
  if (!options.skipDocs) {
    releaseRun.stage = Stage.DOCS;
    console.log("\n🌐 部署文档…");
    try {
      await deployDocs();
    } catch (error) {
      docsError = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ 文档部署失败（包已发布，不回滚版本号）：${docsError}`);
    }
  }

  releaseRun.stage = Stage.GIT;
  try {
    commitAndPush(targetVersion);
  } catch (error) {
    throw new ReleaseError(
      `${error instanceof Error ? error.message : String(error)}\n   包已发布，请手动完成 git 收尾（或稍后执行 pnpm run release:resume）：\n     git add -A && git commit -m "chore: 发布版本 v${targetVersion}"\n     git tag v${targetVersion} && git push && git push origin v${targetVersion}`,
    );
  }

  // 发布命令成功、版本号与会话都已完成，清掉可能残留的现场文件
  clearState();

  if (docsError) console.error("\n⚠️  文档部署失败，请手动执行：pnpm run deploy:docs");
  releaseRun.stage = Stage.DONE;
  console.log(`\n🎉 v${targetVersion} 发布完成！`);
}

// ---------------------------------------------------------------- 失败处理

function describeState(state) {
  const published = state.published?.length
    ? `已发布 ${state.published.length} 个包`
    : "尚未确认已发布";
  const remaining = state.remaining?.length ? `，未发布 ${state.remaining.length} 个` : "";
  return `${published}${remaining}`;
}

/**
 * 统一失败出口：先判断「有没有可能已经上传」，再决定回滚本地版本号还是保留现场。
 * 依据是发布阶段 + registry 实况，绝不凭猜测回滚。
 */
async function handleFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ ${message}`);

  const { fromVersion, targetVersion, stage } = releaseRun;
  const fallbackVersion = fromVersion || readCommittedVersion() || targetVersion;
  const beforePublish =
    stage === Stage.PREFLIGHT ||
    stage === Stage.SYNC ||
    stage === Stage.BUILD ||
    stage === Stage.REHEARSAL;

  if (!targetVersion) {
    console.error("   未改动任何文件，无需回滚。");
    return;
  }

  // 续跑时目标版本可能已经有包在 registry 上：哪怕失败发生在「上传之前」也要先确认，
  // 否则会把本地版本号拖回旧版本，而 registry 上仍留着半套 vX。
  let progress = null;
  if (!beforePublish || releaseRun.resumed) {
    try {
      progress = await verifyPublished(targetVersion, FINAL_PROBE);
    } catch (inspectError) {
      const detail = inspectError instanceof Error ? inspectError.message : String(inspectError);
      console.error(`\n⚠️  无法查询 registry 确认发布进度：${detail}`);
      saveState({
        fromVersion,
        targetVersion,
        published: [],
        remaining: [],
        reason: `${message}（无法确认 registry 状态）`,
        updatedAt: new Date().toISOString(),
      });
      console.error(
        `\n保留本地版本号，现场已写入 ${STATE_NAME}。请先到 npm 上确认 v${targetVersion} 到底发出去了哪些包：`,
      );
      console.error(`  · 一个都没发出去 → git checkout -- . 回到 v${fallbackVersion} 后重新发布；`);
      console.error("  · 发出去一部分 → 直接执行 pnpm run release:resume 把剩下的补齐。");
      return;
    }
  }

  if (!progress || !progress.published.length) {
    console.error(
      `\n⏪ registry 上没有任何 v${targetVersion} 的包，还没有半套发布，回滚本地版本号…`,
    );
    if (semver.valid(fallbackVersion)) syncVersions(fallbackVersion);
    console.error(`   已回到 v${fallbackVersion}，修复后重新执行：pnpm run release`);
    return;
  }

  saveState({
    fromVersion,
    targetVersion,
    published: progress.published,
    remaining: progress.pending,
    reason: message,
    updatedAt: new Date().toISOString(),
  });

  console.error(
    `\n⚠️  v${targetVersion} 已经有包进了 registry，本地版本号保持不动，现场已写入 ${STATE_NAME}`,
  );
  console.error(`   已发布（${progress.published.length}）：${progress.published.join("、")}`);
  if (progress.pending.length) {
    console.error(`   未发布（${progress.pending.length}）：${progress.pending.join("、")}`);
  }

  if (!progress.pending.length) {
    console.error("\n包其实都已经发布成功，只是收尾（文档/git）没走完。继续收尾：");
    console.error("  pnpm run release:resume");
    return;
  }

  console.error(`
继续把剩下的包补齐（pnpm publish 会跳过 registry 上已有的版本，可安全重复执行）：
  pnpm run release:resume

要判断这次该整包修复还是换版本号，先分清改的是哪个包：
  · 只改了「未发布」列表里的包 → 修好后直接 release:resume；
  · 改了「已发布」列表里的包 → 已发布的版本无法覆盖，只能撤销该版本或换新版本号重发：
      npm unpublish <包名>@${targetVersion} --force     # 仅 72 小时内有效，不推荐
      git checkout -- . 后删掉 ${STATE_NAME}，再选一个新版本号发布`);
}

// ---------------------------------------------------------------- 主流程

/** 版本号 → 构建 → 彩排 → 发布 → 收尾；正常发布与续跑共用 */
async function execute(options, targetVersion, fromVersion, inspect) {
  releaseRun.fromVersion = fromVersion;
  releaseRun.targetVersion = targetVersion;

  releaseRun.stage = Stage.SYNC;
  syncVersions(targetVersion);

  if (!options.skipBuild) {
    releaseRun.stage = Stage.BUILD;
    build();
  }

  const progress = inspect ?? (await inspectTarget(targetVersion));

  if (options.dryRun) {
    if (progress.pending.length && !options.skipRehearsal) {
      releaseRun.stage = Stage.REHEARSAL;
      rehearse(options);
    }
    syncVersions(fromVersion);
    console.log(`\n🎉 彩排结束：没有上传任何包，本地版本号已回滚到 v${fromVersion}`);
    return;
  }

  if (!progress.pending.length) {
    console.log(`\nℹ️  v${targetVersion} 的所有包都已在 registry 上，跳过彩排与发布，直接收尾。`);
  } else {
    if (!options.skipRehearsal) {
      releaseRun.stage = Stage.REHEARSAL;
      rehearse(options);
    }
    releaseRun.stage = Stage.PUBLISH;
    await publish(options, targetVersion);
  }

  await finish(options, targetVersion);
}

async function startRelease(options) {
  const currentVersion = readJson(ROOT_PACKAGE_JSON).version;
  console.log(`\n🚀 当前版本 v${currentVersion}\n`);

  if (options.yes && !options.target) {
    throw new ReleaseError("--yes 需要配合 --target <版本号> 使用：非交互模式下没法选择版本类型");
  }
  const targetVersion = (options.target || (await askVersion(currentVersion))).trim();
  if (!semver.valid(targetVersion)) throw new ReleaseError(`非法版本号：${targetVersion}`);
  if (!semver.gt(targetVersion, currentVersion)) {
    throw new ReleaseError(
      `目标版本 v${targetVersion} 必须高于当前版本 v${currentVersion}；若要续跑未完成的发布请用 --resume`,
    );
  }

  preflight(options, { checkDirty: true });

  let inspect;
  try {
    inspect = await inspectTarget(targetVersion);
  } catch (error) {
    console.log(
      `⚠️  查询 registry 失败（${error instanceof Error ? error.message : String(error)}），按全部未发布处理`,
    );
  }
  if (inspect && !inspect.pending.length) {
    throw new ReleaseError(
      `v${targetVersion} 在 registry 上已经完整存在，无需发布；代码有更新请换一个版本号。`,
    );
  }

  printPlan(targetVersion, inspect);
  remindChangelog(targetVersion);

  if (!options.yes) {
    const { confirmed } = await prompt({
      type: "confirm",
      name: "confirmed",
      message: `确认发布 v${targetVersion}？`,
      initial: true,
    });
    if (!confirmed) {
      console.log("已取消。");
      return;
    }
  }

  await execute(options, targetVersion, currentVersion, inspect);
}

async function resumeRelease(options, state) {
  const targetVersion = (state?.targetVersion || readJson(ROOT_PACKAGE_JSON).version).trim();
  if (!semver.valid(targetVersion))
    throw new ReleaseError(`状态文件里的版本号非法：${targetVersion}`);
  const fromVersion = state?.fromVersion || readCommittedVersion() || targetVersion;

  releaseRun.resumed = true;
  console.log(`\n🔄 续跑发布 v${targetVersion}`);
  if (state) {
    console.log(
      `   上次记录：${describeState(state)}${state.reason ? `；中断原因：${state.reason}` : ""}`,
    );
  }

  preflight(options, { checkDirty: false });

  let inspect;
  try {
    inspect = await inspectTarget(targetVersion);
    console.log(
      `   registry 实况：已发布 ${inspect.published.length}/${inspect.packages.length}${inspect.pending.length ? `，仍缺 ${inspect.pending.join("、")}` : ""}`,
    );
  } catch (error) {
    console.log(
      `   ⚠️  查询 registry 失败（${error instanceof Error ? error.message : String(error)}），交给 pnpm 自己跳过已存在的版本`,
    );
  }

  await execute(options, targetVersion, fromVersion, inspect);
}

// ---------------------------------------------------------------- 入口

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const state = loadState();
  if (state && !options.resume) {
    const { resume } = await prompt({
      type: "confirm",
      name: "resume",
      message: `检测到未完成的发布 v${state.targetVersion}（${describeState(state)}）。继续这次发布？`,
      initial: true,
    });
    if (!resume) {
      console.log(`已取消。放弃这次发布：删除 ${STATE_NAME} 并 git checkout -- .`);
      return;
    }
    options.resume = true;
  }

  if (options.resume) await resumeRelease(options, state);
  else await startRelease(options);
}

let handling = false;
async function bail(error, exitCode) {
  if (handling) return;
  handling = true;
  await handleFailure(error);
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (handling) {
      console.error("\n⚠️  再次收到中断信号，强制退出。");
      process.exit(130);
    }
    void bail(new ReleaseError(`收到 ${signal}，发布被中断`), 130);
  });
}
process.on("uncaughtException", (error) => {
  void bail(error, 1);
});

main().catch((error) => {
  void bail(error, 1);
});

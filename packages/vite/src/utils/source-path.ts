/**
 * 选中元素源码路径的宿主侧归一化（单一来源）。
 *
 * 浏览器侧拿到的路径是「相对于某个基准的相对路径」，而基准取决于路径来源，且浏览器不知道文件系统：
 *  - unplugin-vue-inspector 的 `data-v-inspector` 标记：`path.relative(process.cwd(), id)`（Vite 进程 cwd）
 *  - react-dev-inspector 兼容属性 `data-inspector-relative-path`：相对 Vite root
 *  - code-inspector 的 `data-insp-path`（`pathType: "relative"`）：相对 git 仓库根，非 git 仓库回退绝对路径
 * 而消费它的 agent 工作目录是「宿主 cwd」，三者互不相同——相对路径会被解析到工作区之外（沙箱拒绝）。
 *
 * 因此归一化收口在 Vite 端点（所有 Provider / 扩展模式共用 CONTEXT_API_PATH），
 * 由宿主按候选基准探测真实文件，输出恒为绝对路径；宿主知道 root/cwd/gitRoot，浏览器不知道。
 */
import fs from "fs";
import path from "path";

/** 向上查找 git 仓库根的最大层数（防病态目录结构下的无界遍历） */
const GIT_ROOT_MAX_DEPTH = 32;

/** 归一化所需的宿主基准与探测函数（全部可注入，便于单测脱离真实文件系统） */
export interface SourcePathBases {
  /** Vite 进程工作目录（unplugin-vue-inspector 标记的基准） */
  cwd: string;
  /** Vite root（`server.config.root`，react-dev-inspector 兼容属性的基准） */
  root: string;
  /** git 仓库根（code-inspector `pathType: "relative"` 的基准）；未找到为 null */
  gitRoot?: string | null;
  /** 文件存在性探测（默认 fs.existsSync） */
  exists?: (candidate: string) => boolean;
}

/**
 * 把浏览器上报的源码路径归一化为绝对路径。
 *
 * 绝对路径原样返回（幂等）；相对路径按 `cwd → root → gitRoot` 顺序取第一个真实存在的候选，
 * 都不存在时回退到 cwd 基准——输出的契约是「恒为绝对路径」，不回退成相对值（相对值的基准对
 * 消费方不可知，只会把问题推给下游）。
 *
 * @param raw - 浏览器上报的路径
 * @param bases - 宿主基准与探测函数
 * @returns 绝对路径
 */
export function resolveSourceFilePath(raw: string, bases: SourcePathBases): string {
  if (!raw || path.isAbsolute(raw)) return raw;

  const exists = bases.exists ?? fs.existsSync;
  const candidates = [bases.cwd, bases.root, bases.gitRoot].filter(
    (base): base is string => Boolean(base),
  );
  for (const base of candidates) {
    const candidate = path.resolve(base, raw);
    if (exists(candidate)) return candidate;
  }
  return path.resolve(bases.cwd, raw);
}

/**
 * 自 `startDir` 向上查找 git 仓库根（纯 fs 探测，不 spawn git）。
 * @param startDir - 起始目录
 * @param exists - 文件存在性探测（默认 fs.existsSync）
 * @returns 仓库根绝对路径；未找到返回 null
 */
export function findGitRoot(
  startDir: string,
  exists: (candidate: string) => boolean = fs.existsSync,
): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < GIT_ROOT_MAX_DEPTH; depth += 1) {
    if (exists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

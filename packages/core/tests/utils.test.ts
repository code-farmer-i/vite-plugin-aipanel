/**
 * @fileoverview 通用工具函数单测（packages/core/src/common/utils.ts）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRIES } from "../src/common/constants";
import {
  base64Decode,
  base64Encode,
  ensureNodeId,
  extractTextFromResponse,
  fileNameOf,
  isDependencyPath,
  normalizePathSeparators,
  parseNodeMentions,
  toNodeMention,
  truncate,
  widgetEnvelope,
  withRetries,
} from "../src/common/utils";

const FAKE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("ensureNodeId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses an already assigned id and does not rewrite the element", () => {
    const el = { id: "nabc1234" };
    expect(ensureNodeId(el)).toBe("nabc1234");
    expect(el.id).toBe("nabc1234");
  });

  it("generates an n-prefixed 8-char id from crypto.randomUUID and writes it back", () => {
    vi.stubGlobal("crypto", { randomUUID: () => FAKE_UUID });
    const el: { id?: string } = {};
    const id = ensureNodeId(el);
    // uuid 去掉 "-" 后取前 8 位
    expect(id).toBe("naaaaaaaa");
    expect(el.id).toBe(id);
  });

  it("falls back to Math.random when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const el: { id?: string } = {};
    const id = ensureNodeId(el);
    expect(id).toMatch(/^n[0-9a-z]{8}$/);
    expect(el.id).toBe(id);
    expect(ensureNodeId(el)).toBe(id); // 写回后稳定复用
  });
});

describe("truncate", () => {
  it("returns the value unchanged when within maxLength", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("appends an ellipsis when exceeding maxLength", () => {
    expect(truncate("abcdef", 3)).toBe("abc...");
  });

  it("slices the code-unit prefix without splitting multi-byte chars", () => {
    const long = "你好世界你好世界";
    expect(truncate(long, 4)).toBe("你好世界...");
  });
});

describe("base64Encode / base64Decode", () => {
  it("throws on empty input", () => {
    expect(() => base64Encode("")).toThrow(/input string is required/);
  });

  it("encodes ASCII to URL-safe base64 without padding", () => {
    expect(base64Encode("hello")).toBe("aGVsbG8");
  });

  it("produces only the URL-safe alphabet (no + / =)", () => {
    for (const s of ["hello world", "AIPanel-核心/测试+1=", "n=1&x=+/="]) {
      expect(base64Encode(s)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("substitutes + and / for URL safety on ASCII vectors", () => {
    // "aa>" 的标准 base64 为 "YWE+"；"aa?" 的为 "YWE/"
    expect(base64Encode("aa>")).toBe("YWE-");
    expect(base64Encode("aa?")).toBe("YWE_");
    expect(base64Decode("YWE-")).toBe("aa>");
    expect(base64Decode("YWE_")).toBe("aa?");
  });

  it("round-trips unicode (Chinese + emoji)", () => {
    const samples = ["你好世界", "AIPanel-核心/测试+1=👋", "中文 mixed 123 !@#"];
    for (const s of samples) {
      expect(base64Decode(base64Encode(s))).toBe(s);
    }
  });

  it("tolerates padded standard base64 input", () => {
    expect(base64Decode("aGVsbG8=")).toBe("hello");
  });
});

describe("extractTextFromResponse", () => {
  it("extracts joined text from { parts: [{type:'text'}] } payloads", () => {
    const data = {
      parts: [
        { type: "text", text: "first" },
        { type: "image", text: "ignored-image" },
        { type: "text", text: " second" },
      ],
    };
    expect(extractTextFromResponse(data)).toBe("first second");
  });

  it("skips empty text parts and keeps order", () => {
    const data = {
      parts: [{ type: "text", text: "a" }, { type: "text" }, { type: "text", text: "b" }],
    };
    expect(extractTextFromResponse(data)).toBe("ab");
  });

  it("extracts plain string fields", () => {
    expect(extractTextFromResponse({ text: "plain text" })).toBe("plain text");
    expect(extractTextFromResponse({ content: "via content" })).toBe("via content");
    expect(extractTextFromResponse({ message: "via message" })).toBe("via message");
  });

  it("falls through from empty parts to top-level text", () => {
    expect(extractTextFromResponse({ parts: [{ type: "image" }], text: "top text" })).toBe(
      "top text",
    );
  });

  it("returns null for primitives and unsupported shapes", () => {
    expect(extractTextFromResponse(null)).toBeNull();
    expect(extractTextFromResponse(undefined)).toBeNull();
    expect(extractTextFromResponse(42)).toBeNull();
    // 源码字符串分支不可达（前置 typeof === "object" 守卫），当前行为为 null
    expect(extractTextFromResponse("plain string")).toBeNull();
    expect(extractTextFromResponse({ content: 5 })).toBeNull();
    expect(extractTextFromResponse({ message: { text: "nested" } })).toBeNull();
    expect(extractTextFromResponse({})).toBeNull();
  });
});

describe("toNodeMention / parseNodeMentions", () => {
  it("builds the expected mention marker", () => {
    expect(toNodeMention("nabc1234")).toBe("@节点[nabc1234]");
  });

  it("round-trips a mention", () => {
    expect(parseNodeMentions(toNodeMention("n1234abc"))).toEqual(["n1234abc"]);
  });

  it("extracts mentions in order and de-duplicates", () => {
    const text = "看 @节点[nab12cd3] 与 @节点[nxyz9999]，再看 @节点[nab12cd3] 一次";
    expect(parseNodeMentions(text)).toEqual(["nab12cd3", "nxyz9999"]);
  });

  it("returns empty array when no mentions exist", () => {
    expect(parseNodeMentions("no markers here")).toEqual([]);
    expect(parseNodeMentions("")).toEqual([]);
  });
});

describe("widgetEnvelope", () => {
  it("spreads data onto the type envelope", () => {
    expect(widgetEnvelope("AIPANEL_READY", { a: 1, b: "x" })).toEqual({
      type: "AIPANEL_READY",
      a: 1,
      b: "x",
    });
  });

  it("works without extra data", () => {
    expect(widgetEnvelope("AIPANEL_MINIMIZE")).toEqual({ type: "AIPANEL_MINIMIZE" });
  });
});

describe("withRetries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn(async (attempt: number) => {
      expect(attempt).toBe(0);
      return "ok";
    });
    await expect(withRetries(fn, { attempts: 3, delayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries until success and reports 1-based attempt numbers", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn(async (attempt: number) => {
      if (attempt < 2) throw new Error("fail-" + attempt);
      return "recovered";
    });
    await expect(withRetries(fn, { attempts: 5, delayMs: 1, onRetry })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[1][0]).toBe(2);
    expect((onRetry.mock.calls[0][1] as Error).message).toBe("fail-0");
    expect((onRetry.mock.calls[1][1] as Error).message).toBe("fail-1");
  });

  it("re-throws the original Error instance after exhausting attempts", async () => {
    const err = new Error("terminal");
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetries(fn, { attempts: 2, delayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("wraps a non-Error rejection in an Error", async () => {
    const fn = vi.fn(async () => {
      throw "boom";
    });
    await expect(withRetries(fn, { attempts: 1, delayMs: 1 })).rejects.toThrow("boom");
  });

  it("defaults the total attempts to DEFAULT_RETRIES when only a fast delay is given", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    // 不传 attempts：应回退到 DEFAULT_RETRIES 次；显式小 delayMs 避免真实 RETRY_DELAY 等待
    await expect(withRetries(fn, { delayMs: 1 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRIES);
  });

  it("does not sleep when delayMs is 0 and skips onRetry on the last attempt", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(withRetries(fn, { attempts: 3, delayMs: 0, onRetry })).rejects.toThrow("x");
    expect(onRetry).toHaveBeenCalledTimes(2); // 最后一次失败不触发重试回调
  });
});

describe("路径工具", () => {
  it("normalizePathSeparators 把反斜杠统一为正斜杠", () => {
    expect(normalizePathSeparators("C:\\proj\\src\\App.vue")).toBe("C:/proj/src/App.vue");
    expect(normalizePathSeparators("/proj/src/App.vue")).toBe("/proj/src/App.vue");
  });

  it("fileNameOf 兼容两种分隔符，空路径与结尾分隔符返回空串", () => {
    expect(fileNameOf("/proj/src/App.vue")).toBe("App.vue");
    expect(fileNameOf("C:\\proj\\src\\App.vue")).toBe("App.vue");
    expect(fileNameOf("App.vue")).toBe("App.vue");
    expect(fileNameOf("")).toBe("");
    expect(fileNameOf("/proj/src/")).toBe("");
  });

  it("isDependencyPath 按路径分段判定依赖内部文件", () => {
    expect(isDependencyPath("/proj/node_modules/@scope/pkg/Comp.vue")).toBe(true);
    expect(isDependencyPath("C:\\proj\\node_modules\\pkg\\Comp.vue")).toBe(true);
    // pnpm 真身：`.pnpm/<pkg>@<ver>/node_modules/<pkg>` 仍含 node_modules 段
    expect(
      isDependencyPath("/proj/node_modules/.pnpm/pkg@1.0.0_hash/node_modules/pkg/Comp.vue"),
    ).toBe(true);
    expect(isDependencyPath("/proj/src/Comp.vue")).toBe(false);
    // 名字里含 node_modules 的项目目录不应误判
    expect(isDependencyPath("/proj/my-node_modules-backup/Comp.vue")).toBe(false);
  });
});

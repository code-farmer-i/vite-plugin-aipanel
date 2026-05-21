import { describe, expect, it } from "vitest";
import { truncate, sleep, base64Encode, base64Decode, extractTextFromResponse } from "../src/utils";

describe("truncate", () => {
  it("应该返回原始字符串当长度不超限时", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("应该截断字符串并在超长时添加省略号", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("应该处理精确长度边界", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("应该处理空字符串", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("应该处理 maxLength 为 0", () => {
    expect(truncate("hello", 0)).toBe("...");
  });
});

describe("sleep", () => {
  it("应该在指定时间后 resolve", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("应该对 0ms 立即 resolve", async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});

describe("base64Encode / base64Decode", () => {
  it("应该正确编码和解码（往返）", () => {
    const original = "Hello, World!";
    const encoded = base64Encode(original);
    const decoded = base64Decode(encoded);
    expect(decoded).toBe(original);
  });

  it("应该处理中文字符", () => {
    const original = "你好，世界！";
    const encoded = base64Encode(original);
    const decoded = base64Decode(encoded);
    expect(decoded).toBe(original);
  });

  it("应该处理特殊字符", () => {
    const original = "test\n\t\r\\";
    const encoded = base64Encode(original);
    const decoded = base64Decode(encoded);
    expect(decoded).toBe(original);
  });

  it("应该在空字符串时抛出错误", () => {
    expect(() => base64Encode("")).toThrow("base64Encode: input string is required");
  });

  it("编码 UTF-8 字符串应产生有效的 base64", () => {
    const encoded = base64Encode("test");
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("extractTextFromResponse", () => {
  it("应该从 parts 数组中提取文本", () => {
    const data = {
      parts: [{ type: "text", text: "Hello" }, { type: "text", text: " World" }, { type: "image" }],
    };
    expect(extractTextFromResponse(data)).toBe("Hello World");
  });

  it("应该从 text 字段提取文本", () => {
    expect(extractTextFromResponse({ text: "direct text" })).toBe("direct text");
  });

  it("应该从 content 字段提取文本", () => {
    expect(extractTextFromResponse({ content: "content text" })).toBe("content text");
  });

  it("应该从 message 字段提取文本", () => {
    expect(extractTextFromResponse({ message: "message text" })).toBe("message text");
  });

  it("应该对非对象输入返回 null", () => {
    expect(extractTextFromResponse(null)).toBeNull();
    expect(extractTextFromResponse(undefined)).toBeNull();
    expect(extractTextFromResponse(42)).toBeNull();
  });

  it("应该对空对象返回 null", () => {
    expect(extractTextFromResponse({})).toBeNull();
  });

  it("应该在 parts 中没有文本部分时返回 null", () => {
    const data = {
      parts: [{ type: "image" }, { type: "tool" }],
    };
    expect(extractTextFromResponse(data)).toBeNull();
  });

  it("应该当所有字段都有文本时优先 text 字段覆盖 content", () => {
    const data = {
      parts: [{ type: "text", text: "from parts" }],
      text: "from text",
      content: "from content",
      message: "from message",
    };
    expect(extractTextFromResponse(data)).toBe("from parts");
  });

  it("应该忽略非对象元素", () => {
    const data = {
      parts: [null, undefined, 123, "string", { type: "text", text: "valid" }],
    };
    expect(extractTextFromResponse(data)).toBe("valid");
  });
});

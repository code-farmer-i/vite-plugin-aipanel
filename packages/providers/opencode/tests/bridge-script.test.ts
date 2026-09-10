/**
 * @aipanel/provider-opencode 注入式桥接脚本（generateBridgeScript）单元测试。
 *
 * 覆盖目标：
 *   - 生成产物的结构性断言：IIFE 形态、localStorage 键/消息协议常量均引用源码单一来源
 *     （OPENCODE_STORAGE_KEYS / WIDGET_MSG），主题、语言、设置按 JSON 注入且可安全转义；
 *   - 在受控沙箱（new Function + 桩 window/document/localStorage）中执行极小片段，验证
 *     真实运行时行为：主题落盘、设置深度合并、残留 tab 存储清理、message/keydown 分发、
 *     FILE_PART 节点上下文序列化。
 *
 * Stub 策略：脚本与 DOM/localStorage 强耦合，这里用最小可用的纯对象桩替代浏览器环境
 * （不引入 jsdom），只实现脚本实际触达的 API；断言聚焦“行为/协议片段”，不写死整段字符串。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WIDGET_MSG } from "@aipanel/core";
import { generateBridgeScript } from "../src/bridge-script";
import { DEFAULT_OPENCODE_SETTINGS, OPENCODE_STORAGE_KEYS } from "../src/constants";

/** 记录 setAttribute 调用的元素桩（documentElement 用） */
function createClassList() {
  const tokens = new Set<string>();
  return {
    add: (...names: string[]) => names.forEach((n) => tokens.add(n)),
    remove: (...names: string[]) => names.forEach((n) => tokens.delete(n)),
    toggle: (name: string, force?: boolean) => {
      const next = force ?? !tokens.has(name);
      if (next) tokens.add(name);
      else tokens.delete(name);
      return next;
    },
    contains: (name: string) => tokens.has(name),
  };
}

function createElement(tag: string) {
  const attributes: Record<string, string> = {};
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  return {
    tagName: tag,
    nodeType: 1,
    id: "",
    className: "",
    title: "",
    innerHTML: "",
    textContent: "",
    style: {} as Record<string, string>,
    attributes,
    classList: createClassList(),
    parentElement: null as unknown,
    children: [] as unknown[],
    setAttribute: (name: string, value: string) => {
      attributes[name] = String(value);
    },
    getAttribute: (name: string) => (name in attributes ? attributes[name] : null),
    appendChild: (child: unknown) => child,
    insertBefore: () => undefined,
    remove: () => undefined,
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent: () => true,
    focus: () => undefined,
    contains: () => false,
    onclick: null as (() => void) | null,
    listeners,
  };
}

type FakeElement = ReturnType<typeof createElement>;

/** 构造一个只实现脚本所需 API 的沙箱环境 */
function createSandbox(
  options: {
    seed?: Record<string, string>;
    embedded?: boolean;
    promptInput?: FakeElement | null;
    selectors?: Record<string, unknown>;
  } = {},
) {
  const store = new Map<string, string>(Object.entries(options.seed ?? {}));
  const setItemCalls: [string, string][] = [];
  const removeItemCalls: string[] = [];
  const created: FakeElement[] = [];
  const messageHandlers: ((event: unknown) => void)[] = [];
  const keydownHandlers: ((event: unknown) => void)[] = [];
  const dispatchEvent = vi.fn();
  const postMessage = vi.fn();
  const warn = vi.fn();
  const setAttribute = vi.fn();
  const storageEvents: Record<string, unknown>[] = [];

  const localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
      setItemCalls.push([key, String(value)]);
    },
    removeItem: (key: string) => {
      store.delete(key);
      removeItemCalls.push(key);
    },
  };

  const documentElement = createElement("html");
  documentElement.setAttribute = (name: string, value: string) => {
    setAttribute(name, value);
    documentElement.attributes[name] = value;
  };

  const document = {
    readyState: "complete",
    documentElement,
    head: { appendChild: vi.fn() },
    body: { appendChild: vi.fn() },
    getElementById: () => null,
    createElement: (tag: string) => {
      const el = createElement(tag);
      created.push(el);
      return el;
    },
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    createRange: () => ({
      setStartAfter: () => undefined,
      collapse: () => undefined,
      insertNode: () => undefined,
    }),
    addEventListener: vi.fn(),
    querySelector: (selector: string) => {
      if (options.selectors && selector in options.selectors) {
        return options.selectors[selector];
      }
      if (selector === '[data-component="prompt-input"]') {
        return options.promptInput ?? null;
      }
      return null;
    },
  };

  // 记录 setItem 调用等断言辅助（保留引用避免被回收）
  void setItemCalls;
  void removeItemCalls;

  const origMatchMedia = (query: string) => ({
    matches: false,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });

  const windowStub = {
    matchMedia: Object.assign(origMatchMedia, { bind: () => origMatchMedia }),
    location: { href: "http://localhost/" },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      if (type === "message") messageHandlers.push(handler);
      else if (type === "keydown") keydownHandlers.push(handler);
    },
    removeEventListener: vi.fn(),
    dispatchEvent,
    getSelection: () => null,
    parent: (options.embedded ? { postMessage } : null) as unknown,
    postMessage,
  };
  // 非嵌入式：parent 与 window 同一引用（脚本用 window.parent !== window 判定）
  if (!options.embedded) windowStub.parent = windowStub as unknown;

  class MutationObserverStub {
    observe = vi.fn();
    disconnect = vi.fn();
  }

  class StorageEventStub {
    constructor(
      public type: string,
      public init: Record<string, unknown>,
    ) {
      storageEvents.push(init);
    }
  }

  class EventStub {
    constructor(
      public type: string,
      public init?: Record<string, unknown>,
    ) {}
  }

  return {
    window: windowStub,
    document,
    localStorage,
    MutationObserver: MutationObserverStub,
    StorageEvent: StorageEventStub,
    Event: EventStub,
    console: { warn, log: vi.fn(), error: vi.fn() },
    requestAnimationFrame: (cb: () => void) => cb(),
    setTimeout: globalThis.setTimeout,
    // 断言辅助
    created,
    store,
    setItemCalls,
    removeItemCalls,
    messageHandlers,
    keydownHandlers,
    dispatchEvent,
    postMessage,
    warn,
    setAttribute,
    setItem: vi.fn(),
    storageEvents,
  };
}

type Sandbox = ReturnType<typeof createSandbox>;

/** 在沙箱中执行桥接脚本（仅注入脚本实际引用的全局量） */
function runScript(script: string, env: Sandbox) {
  const fn = new Function(
    "window",
    "document",
    "localStorage",
    "MutationObserver",
    "StorageEvent",
    "Event",
    "console",
    "requestAnimationFrame",
    "setTimeout",
    script,
  );
  fn(
    env.window,
    env.document,
    env.localStorage,
    env.MutationObserver,
    env.StorageEvent,
    env.Event,
    env.console,
    env.requestAnimationFrame,
    env.setTimeout,
  );
}

/** 触发脚本注册的 window message 监听 */
function emitMessage(env: Sandbox, data: Record<string, unknown>) {
  for (const handler of env.messageHandlers) handler({ data });
}

/** 触发脚本注册的 window keydown 监听 */
function emitKeydown(env: Sandbox, event: Record<string, unknown>) {
  for (const handler of env.keydownHandlers) handler(event);
}

const storedSettings = (env: Sandbox) =>
  JSON.parse(env.store.get(OPENCODE_STORAGE_KEYS.SETTINGS) ?? "{}") as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateBridgeScript 生成产物结构", () => {
  it("输出为可解析的 IIFE，且以源码常量（存储键 / 消息协议）作为单一来源注入", () => {
    const script = generateBridgeScript();
    expect(script.trimStart().startsWith("(function()")).toBe(true);
    // 语法有效：可被解析为函数体（不执行）
    expect(() => new Function(script)).not.toThrow();
    // 存储键与消息类型均引用常量定义处，而非字面量副本
    expect(script).toContain(JSON.stringify(OPENCODE_STORAGE_KEYS));
    for (const msg of [
      WIDGET_MSG.SET_THEME,
      WIDGET_MSG.INSERT_FILE_PART,
      WIDGET_MSG.MINIMIZE_STATE,
      WIDGET_MSG.PROMPT_DOCK_VISIBILITY,
      WIDGET_MSG.SELECT_MODE_CHANGE,
      WIDGET_MSG.REVIEW_PANEL_TOGGLE,
      WIDGET_MSG.KEYDOWN,
      WIDGET_MSG.READY,
    ]) {
      expect(script).toContain(JSON.stringify(msg));
    }
  });

  it("theme 以 JSON 注入；language 并入 settings(general.language) 落盘，缺省不写入", () => {
    expect(generateBridgeScript({ theme: "dark" })).toContain(`theme: ${JSON.stringify("dark")}`);
    expect(generateBridgeScript()).toContain(
      `settings: ${JSON.stringify(DEFAULT_OPENCODE_SETTINGS)}`,
    );

    const withLang = createSandbox();
    runScript(generateBridgeScript({ language: "zh" }), withLang);
    expect(storedSettings(withLang).general).toMatchObject({ language: "zh" });

    const withoutLang = createSandbox();
    runScript(generateBridgeScript(), withoutLang);
    expect(storedSettings(withoutLang).general).not.toHaveProperty("language");

    // 不污染常量：生成带语言的脚本后 DEFAULT 仍不含 language
    expect(DEFAULT_OPENCODE_SETTINGS.general).not.toHaveProperty("language");
  });

  it("设置含反引号、${}、</script> 等特殊字符时产物仍可解析（转义安全）", () => {
    const settings = {
      appearance: { mono: "a`b${c}</script>\"'", fontSize: 13 },
    };
    const script = generateBridgeScript({ settings });
    expect(() => new Function(script)).not.toThrow();

    const env = createSandbox();
    runScript(script, env);
    // 往返一致：特殊字符经 JSON 注入/落盘后原样还原
    expect(storedSettings(env).appearance).toEqual(settings.appearance);
  });
});

describe("桥接脚本执行：初始化（主题 / 设置 / 存储清理）", () => {
  it("theme=dark 时写入配色键并设置 data-color-scheme；auto/缺省不干预", () => {
    const dark = createSandbox();
    runScript(generateBridgeScript({ theme: "dark" }), dark);
    expect(dark.store.get(OPENCODE_STORAGE_KEYS.COLOR_SCHEME)).toBe("dark");
    expect(dark.setAttribute).toHaveBeenCalledWith("data-color-scheme", "dark");

    const auto = createSandbox();
    runScript(generateBridgeScript(), auto);
    expect(auto.store.has(OPENCODE_STORAGE_KEYS.COLOR_SCHEME)).toBe(false);
    expect(auto.setAttribute).not.toHaveBeenCalled();

    const explicitAuto = createSandbox();
    runScript(generateBridgeScript({ theme: "auto" }), explicitAuto);
    expect(explicitAuto.store.has(OPENCODE_STORAGE_KEYS.COLOR_SCHEME)).toBe(false);
  });

  it("主题写入抛错（存储被禁用）时被忽略，脚本仍完成设置初始化", () => {
    const env = createSandbox();
    const writeItem = env.localStorage.setItem;
    env.localStorage.setItem = (key: string, value: string) => {
      if (key === OPENCODE_STORAGE_KEYS.COLOR_SCHEME) throw new Error("storage disabled");
      writeItem(key, value);
    };

    expect(() => runScript(generateBridgeScript({ theme: "dark" }), env)).not.toThrow();
    expect(env.store.has(OPENCODE_STORAGE_KEYS.COLOR_SCHEME)).toBe(false);
    // 主题初始化失败未中断后续设置初始化
    expect(storedSettings(env)).toEqual(DEFAULT_OPENCODE_SETTINGS);
  });

  it("无用户设置时落盘默认设置；用户设置与默认 general 合并、其余分区整体透传", () => {
    const defaults = createSandbox();
    runScript(generateBridgeScript(), defaults);
    expect(storedSettings(defaults)).toEqual(DEFAULT_OPENCODE_SETTINGS);

    const custom = createSandbox();
    const settings = {
      general: { showReasoningSummaries: false, autoSave: true },
      permissions: { autoApprove: true },
    };
    runScript(generateBridgeScript({ settings }), custom);
    expect(storedSettings(custom).general).toEqual({
      ...DEFAULT_OPENCODE_SETTINGS.general,
      showReasoningSummaries: false,
      autoSave: true,
    });
    expect(storedSettings(custom).permissions).toEqual({ autoApprove: true });
  });

  it("深度合并已有 settings：web 自有字段保留，插件声明字段被覆盖，缺失默认值补齐", () => {
    const env = createSandbox({
      seed: {
        [OPENCODE_STORAGE_KEYS.SETTINGS]: JSON.stringify({
          webOwnedSecret: 1,
          general: { autoSave: true, webOwnedInGeneral: "keep" },
        }),
      },
    });
    runScript(
      generateBridgeScript({ settings: { general: { showReasoningSummaries: false } } }),
      env,
    );

    const stored = storedSettings(env) as {
      webOwnedSecret: number;
      general: Record<string, unknown>;
    };
    expect(stored.webOwnedSecret).toBe(1);
    expect(stored.general.webOwnedInGeneral).toBe("keep");
    expect(stored.general.autoSave).toBe(true);
    expect(stored.general.showReasoningSummaries).toBe(false);
    // 未覆盖的默认字段仍补齐
    expect(stored.general.showFileTree).toBe(DEFAULT_OPENCODE_SETTINGS.general.showFileTree);
  });

  it("清理残留 session tabs 存储（opencode.window* / opencode.workspace*），其他键保留", () => {
    const env = createSandbox({
      seed: {
        "opencode.window.tab1": "1",
        "opencode.workspace.foo": "2",
        keep: "3",
      },
    });
    runScript(generateBridgeScript(), env);
    expect(env.removeItemCalls.sort()).toEqual(["opencode.window.tab1", "opencode.workspace.foo"]);
    expect(env.store.has("keep")).toBe(true);
  });
});

describe("桥接脚本执行：消息分发", () => {
  it("SET_THEME 更新配色键、DOM 属性并派发 storage 事件（值变化时）", () => {
    const env = createSandbox();
    runScript(generateBridgeScript(), env);

    emitMessage(env, { type: WIDGET_MSG.SET_THEME, theme: "light" });
    expect(env.store.get(OPENCODE_STORAGE_KEYS.COLOR_SCHEME)).toBe("light");
    expect(env.setAttribute).toHaveBeenCalledWith("data-color-scheme", "light");
    expect(env.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(env.storageEvents[0]).toMatchObject({
      key: OPENCODE_STORAGE_KEYS.COLOR_SCHEME,
      newValue: "light",
    });
  });

  it("MINIMIZE_STATE / PROMPT_DOCK_VISIBILITY 切换 documentElement 类名", () => {
    const env = createSandbox();
    runScript(generateBridgeScript(), env);
    const html = env.document.documentElement.classList;

    emitMessage(env, { type: WIDGET_MSG.MINIMIZE_STATE, minimized: true });
    expect(html.contains("opencode-minimized")).toBe(true);
    emitMessage(env, { type: WIDGET_MSG.MINIMIZE_STATE, minimized: false });
    expect(html.contains("opencode-minimized")).toBe(false);

    emitMessage(env, { type: WIDGET_MSG.PROMPT_DOCK_VISIBILITY, visible: false });
    expect(html.contains("opencode-prompt-dock-hidden")).toBe(true);
    emitMessage(env, { type: WIDGET_MSG.PROMPT_DOCK_VISIBILITY, visible: true });
    expect(html.contains("opencode-prompt-dock-hidden")).toBe(false);
  });

  it("INSERT_FILE_PART 把选中元素序列化为 chip：节点上下文 JSON + 展示文本", () => {
    const promptInput = createElement("div");
    const appendChild = vi.spyOn(promptInput, "appendChild");
    const dispatchEvent = vi.spyOn(promptInput, "dispatchEvent");
    const env = createSandbox({ promptInput });
    runScript(generateBridgeScript(), env);

    emitMessage(env, {
      type: WIDGET_MSG.INSERT_FILE_PART,
      element: {
        filePath: "/src/a.ts",
        line: 12,
        column: 3,
        description: "div.card",
        innerText: "Hello World!",
        previewPageUrl: "http://preview/",
      },
    });

    const span = env.created.find((el) => el.tagName === "span");
    expect(span).toBeDefined();
    expect(span?.attributes["data-mention"]).toBe("file");
    expect(span?.attributes["contenteditable"]).toBe("false");
    expect(span?.textContent).toBe("@div.card(Hello...)");

    const payload = JSON.parse(span?.attributes["data-path"] ?? "{}") as {
      nodeContext: Record<string, { value: unknown }>;
    };
    expect(payload.nodeContext.filePath.value).toBe("/src/a.ts");
    expect(payload.nodeContext.line.value).toBe(12);
    expect(payload.nodeContext.column.value).toBe(3);
    expect(payload.nodeContext.description.value).toBe("div.card");
    expect(payload.nodeContext.innerText.value).toBe("Hello World!");
    expect(payload.nodeContext.selectAt.value).toBe("http://preview/");

    expect(appendChild).toHaveBeenCalledWith(span);
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it("INSERT_FILE_PART：innerText 超长截断到 500，缺失字段回退“未知”，短文本不加省略号", () => {
    const env = createSandbox({ promptInput: createElement("div") });
    runScript(generateBridgeScript(), env);
    const longText = "x".repeat(800);

    emitMessage(env, { type: WIDGET_MSG.INSERT_FILE_PART, element: { innerText: longText } });
    const span = env.created.find((el) => el.tagName === "span");
    const payload = JSON.parse(span?.attributes["data-path"] ?? "{}") as {
      nodeContext: Record<string, { value: unknown }>;
    };
    expect((payload.nodeContext.innerText.value as string).length).toBe(500);
    expect(payload.nodeContext.filePath.value).toBe("未知");
    expect(span?.textContent).toBe("@element(xxxxx...)");

    // 短文本：不追加省略号
    const short = createSandbox({ promptInput: createElement("div") });
    runScript(generateBridgeScript(), short);
    emitMessage(short, {
      type: WIDGET_MSG.INSERT_FILE_PART,
      element: { description: "span", innerText: "  hi " },
    });
    expect(short.created.find((el) => el.tagName === "span")?.textContent).toBe("@span(hi)");
  });

  it("找不到输入框时 INSERT_FILE_PART 仅告警不抛错", () => {
    const env = createSandbox({ promptInput: null });
    runScript(generateBridgeScript(), env);
    emitMessage(env, { type: WIDGET_MSG.INSERT_FILE_PART, element: { description: "x" } });
    expect(env.warn).toHaveBeenCalled();
    expect(env.created.some((el) => el.tagName === "span")).toBe(false);
  });

  it("SELECT_MODE_CHANGE 开启后 Esc 会吞掉事件并转发父窗；未开启时不阻断", () => {
    const env = createSandbox({ embedded: true });
    runScript(generateBridgeScript(), env);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    // 未进入选择模式：不阻断
    emitKeydown(env, { key: "Escape", preventDefault, stopPropagation });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(env.postMessage).toHaveBeenCalledTimes(1);
    expect(env.postMessage.mock.calls[0][0]).toMatchObject({
      type: WIDGET_MSG.KEYDOWN,
      key: "Escape",
    });

    emitMessage(env, { type: WIDGET_MSG.SELECT_MODE_CHANGE, selectMode: true });
    const preventDefault2 = vi.fn();
    const stopPropagation2 = vi.fn();
    emitKeydown(env, {
      key: "Escape",
      preventDefault: preventDefault2,
      stopPropagation: stopPropagation2,
    });
    expect(preventDefault2).toHaveBeenCalledTimes(1);
    expect(stopPropagation2).toHaveBeenCalledTimes(1);
    expect(env.postMessage).toHaveBeenCalledTimes(2);
  });

  it("非嵌入式（parent === window）时不向父窗发任何消息", () => {
    const env = createSandbox({ embedded: false, promptInput: createElement("div") });
    runScript(generateBridgeScript(), env);
    emitKeydown(env, { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(env.postMessage).not.toHaveBeenCalled();
  });

  it("嵌入式且输入框就绪时上报 READY（单一来源 WIDGET_MSG.READY）", () => {
    const env = createSandbox({ embedded: true, promptInput: createElement("div") });
    runScript(generateBridgeScript(), env);
    expect(env.postMessage).toHaveBeenCalledWith({ type: WIDGET_MSG.READY }, "*");
  });

  it("REVIEW_PANEL_TOGGLE 打开时给容器打 data-ref 标记并加覆盖类名、注入切换按钮", () => {
    const reviewPanel = createElement("div");
    const panelRow = createElement("div");
    panelRow.className = "flex flex-col md:flex-row";
    const sessionPanel = createElement("div");
    sessionPanel.className = "@container";
    const sideContainer = createElement("div");
    sideContainer.className = "min-w-0 flex-col";
    reviewPanel.parentElement = panelRow;
    panelRow.children = [sessionPanel, sideContainer];

    const reviewBtn = Object.assign(createElement("button"), {
      click: vi.fn(),
      attr: null as string | null,
    });
    reviewBtn.getAttribute = () => "false";

    const env = createSandbox({
      embedded: true,
      selectors: {
        '[data-component="session-review-v2"]': reviewPanel,
        '[aria-controls="review-panel"]': reviewBtn,
      },
    });
    runScript(generateBridgeScript(), env);

    emitMessage(env, { type: WIDGET_MSG.REVIEW_PANEL_TOGGLE, visible: true });

    expect(panelRow.attributes["data-ref"]).toBe("panel-row");
    expect(sessionPanel.attributes["data-ref"]).toBe("session-panel");
    expect(sideContainer.attributes["data-ref"]).toBe("side-panel-container");
    expect(reviewBtn.click).toHaveBeenCalledTimes(1);
    expect(env.document.documentElement.classList.contains("opencode-review-panel-overlay")).toBe(
      true,
    );
    expect(env.created.some((el) => el.id === "opencode-chat-toggle-btn")).toBe(true);

    // 第二次相同状态：跳过（避免 MutationObserver 重复触发），不再点击原生按钮
    emitMessage(env, { type: WIDGET_MSG.REVIEW_PANEL_TOGGLE, visible: true });
    expect(reviewBtn.click).toHaveBeenCalledTimes(1);
  });
});

describe("桥接脚本执行：键盘 / 选择模式分支容错", () => {
  it("settings 读取失败时走 catch 分支，仍以插件默认设置落盘（不中断脚本）", () => {
    const env = createSandbox();
    env.localStorage.getItem = () => {
      throw new Error("denied");
    };
    runScript(generateBridgeScript(), env);
    expect(storedSettings(env)).toEqual(DEFAULT_OPENCODE_SETTINGS);
  });

  it("Escape 之外且无 ctrl 的按键不转发父窗", () => {
    const env = createSandbox({ embedded: true });
    runScript(generateBridgeScript(), env);
    emitKeydown(env, { key: "a", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    expect(env.postMessage).not.toHaveBeenCalled();
  });
});

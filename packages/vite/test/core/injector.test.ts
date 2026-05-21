import { describe, expect, it } from "vitest";
import { CONFIG_DATA_ATTR, WIDGET_SCRIPT_PATH } from "@vite-plugin-opencode-assistant/shared";
import { injectWidget } from "../../src/core/injector.js";

describe("injectWidget", () => {
  it("injects script tag with encoded config", () => {
    const html = injectWidget({
      theme: "auto",
      open: false,
      hotkey: "ctrl+k",
    });

    expect(html).toContain(`<script type="module" src="${WIDGET_SCRIPT_PATH}"`);
    expect(html).toContain(`${CONFIG_DATA_ATTR}=`);

    const match = html.match(new RegExp(`${CONFIG_DATA_ATTR}="([^"]+)"`));
    expect(match?.[1]).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(match![1], "base64").toString("utf8"));
    expect(decoded.theme).toBe("auto");
    expect(decoded.open).toBe(false);
    expect(decoded.hotkey).toBe("ctrl+k");
  });
});

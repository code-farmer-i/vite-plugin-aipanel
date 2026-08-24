import type { WidgetOptions } from "@aipanel/core";
import {
  CONFIG_DATA_ATTR,
  WIDGET_SCRIPT_PATH,
  WIDGET_STYLE_PATH,
} from "@aipanel/core";

export function injectWidget(options: WidgetOptions): string {
  const configBase64 = Buffer.from(JSON.stringify(options)).toString("base64");
  const scriptTag = `<script type="module" src="${WIDGET_SCRIPT_PATH}" ${CONFIG_DATA_ATTR}="${configBase64}"></script>`;
  const styleTag = `<link rel="stylesheet" href="${WIDGET_STYLE_PATH}" />`;
  return `${styleTag}\n${scriptTag}`;
}

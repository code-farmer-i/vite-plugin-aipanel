import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import { resolveWidgetPath, resolveWidgetStylePath } from "../../src/utils/paths.js";

vi.mock("fs");

describe("paths utility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("resolveWidgetPath", () => {
    it("should fallback to es/client.js if files don't exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const widgetPath = resolveWidgetPath();
      expect(widgetPath).toContain(path.join("es", "client.js"));
    });

    it("should return the first existing candidate", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p.toString().includes(path.join("lib", "client.js"));
      });
      const widgetPath = resolveWidgetPath();
      expect(widgetPath).toContain(path.join("lib", "client.js"));
    });
  });

  describe("resolveWidgetStylePath", () => {
    it("should fallback to es/style.css if files don't exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const stylePath = resolveWidgetStylePath();
      expect(stylePath).toContain(path.join("es", "style.css"));
    });

    it("should return the first existing candidate", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p.toString().includes(path.join("lib", "style.css"));
      });
      const stylePath = resolveWidgetStylePath();
      expect(stylePath).toContain(path.join("lib", "style.css"));
    });
  });
});

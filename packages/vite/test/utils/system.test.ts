/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import {
  waitForServer,
  checkOpenCodeInstalled,
  isPortAvailable,
  findAvailablePort,
  findGitRoot,
} from "../../src/utils/system.js";

vi.mock("http");
vi.mock("net");
vi.mock("child_process");
vi.mock("fs");

describe("system utility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("waitForServer", () => {
    it("should resolve when server is ready", async () => {
      const mockReq = new EventEmitter();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;

      vi.mocked(http.get).mockImplementation(((url: any, cb: any) => {
        setTimeout(() => cb(mockRes), 10);
        return mockReq as any;
      }) as any);

      await expect(waitForServer("http://127.0.0.1", 1000)).resolves.toBeUndefined();
    });

    it("should retry and resolve if server becomes ready", async () => {
      const mockReq = new EventEmitter();
      const mockRes = new EventEmitter() as any;

      let attempts = 0;
      vi.mocked(http.get).mockImplementation(((url: any, cb: any) => {
        attempts++;
        if (attempts === 1) {
          setTimeout(() => mockReq.emit("error", new Error("conn refused")), 10);
        } else {
          mockRes.statusCode = 200;
          setTimeout(() => cb(mockRes), 10);
        }
        return mockReq as any;
      }) as any);

      await expect(waitForServer("http://127.0.0.1", 1000)).resolves.toBeUndefined();
      expect(attempts).toBeGreaterThan(1);
    });
  });

  describe("checkOpenCodeInstalled", () => {
    it("should return true if process exits with 0", async () => {
      const mockProc = new EventEmitter() as any;
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = checkOpenCodeInstalled();
      setTimeout(() => mockProc.emit("close", 0), 10);

      await expect(promise).resolves.toBe(true);
    });

    it("should return false if process exits with non-zero", async () => {
      const mockProc = new EventEmitter() as any;
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = checkOpenCodeInstalled();
      setTimeout(() => mockProc.emit("close", 1), 10);

      await expect(promise).resolves.toBe(false);
    });

    it("should return false if process errors", async () => {
      const mockProc = new EventEmitter() as any;
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = checkOpenCodeInstalled();
      setTimeout(() => mockProc.emit("error", new Error("ENOENT")), 10);

      await expect(promise).resolves.toBe(false);
    });
  });

  describe("isPortAvailable", () => {
    it("should return true if server can listen", async () => {
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn();
      mockServer.close = vi.fn();
      vi.mocked(net.createServer).mockReturnValue(mockServer);

      const promise = isPortAvailable(8080);
      setTimeout(() => mockServer.emit("listening"), 10);

      await expect(promise).resolves.toBe(true);
      expect(mockServer.close).toHaveBeenCalled();
    });

    it("should return false if server emits error", async () => {
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn();
      vi.mocked(net.createServer).mockReturnValue(mockServer);

      const promise = isPortAvailable(8080);
      setTimeout(() => mockServer.emit("error", new Error("EADDRINUSE")), 10);

      await expect(promise).resolves.toBe(false);
    });
  });

  describe("findAvailablePort", () => {
    it("should return start port when available", async () => {
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn();
      mockServer.close = vi.fn();
      vi.mocked(net.createServer).mockReturnValue(mockServer);

      const promise = findAvailablePort(3000, "localhost", 3);
      setTimeout(() => mockServer.emit("listening"), 10);

      const port = await promise;
      expect(port).toBe(3000);
    });

    it("should try multiple ports when busy", async () => {
      let listenCalls = 0;
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn();
      mockServer.close = vi.fn();

      vi.mocked(net.createServer).mockImplementation(() => {
        const server = new EventEmitter() as any;
        server.listen = vi.fn();
        server.close = vi.fn();

        listenCalls++;
        if (listenCalls <= 2) {
          setTimeout(() => server.emit("error", new Error("EADDRINUSE")), 5);
        } else {
          setTimeout(() => server.emit("listening"), 5);
        }
        return server;
      });

      const port = await findAvailablePort(3000, "localhost", 5);
      expect(port).toBe(3002);
    });
  });

  describe("findGitRoot", () => {
    it("should return directory containing .git", () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        return p.toString().includes(path.join("project", ".git"));
      });

      const root = findGitRoot("/home/user/project/src/components", 10);
      expect(root).toContain("project");
    });

    it("should fallback to startDir when no .git found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const root = findGitRoot("/home/user/project/src", 3);
      expect(root).toBe("/home/user/project/src");
    });
  });
});

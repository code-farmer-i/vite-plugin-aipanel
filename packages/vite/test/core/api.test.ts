/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach } from "vitest";
import http from "http";
import { OpenCodeAPI } from "../../src/core/api.js";
import { EventEmitter } from "events";

vi.mock("http");

describe("OpenCodeAPI", () => {
  let api: OpenCodeAPI;
  let mockReq: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  let mockRes: EventEmitter & { statusCode: number };

  beforeEach(() => {
    vi.resetAllMocks();
    api = new OpenCodeAPI(
      "127.0.0.1",
      () => 12345,
      () => 12346,
    );

    mockReq = new EventEmitter() as any;
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();

    mockRes = new EventEmitter() as any;
    mockRes.statusCode = 200;

    vi.mocked(http.request).mockImplementation(((options: any, callback?: any) => {
      if (callback) {
        setTimeout(() => callback(mockRes), 0);
      }
      return mockReq as any;
    }) as any);
  });

  describe("getSessions", () => {
    it("should return sessions on success", async () => {
      const mockSessions = [{ id: "sess-1", directory: "/tmp" }];

      const promise = api.getSessions("/tmp", 1);

      setTimeout(() => {
        mockRes.emit("data", Buffer.from(JSON.stringify(mockSessions)));
        mockRes.emit("end");
      }, 10);

      const result = await promise;
      expect(result[0].id).toBe(mockSessions[0].id);
      expect(result[0].directory).toBe(mockSessions[0].directory);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "127.0.0.1",
          port: 12345,
          path: expect.stringContaining("/session"),
        }),
        expect.any(Function),
      );
    });

    it("should retry on failure", async () => {
      vi.mocked(http.request).mockImplementation(((options: any, callback?: any) => {
        setTimeout(() => {
          mockReq.emit("error", new Error("Network Error"));
        }, 0);
        return mockReq as any;
      }) as any);

      await expect(api.getSessions("/tmp", 2)).rejects.toThrow("Network Error");
      expect(http.request).toHaveBeenCalledTimes(2);
    });
  });

  describe("createSession", () => {
    it("should send POST request to create a session", async () => {
      const mockSession = { id: "sess-2", title: "Test Session" };

      const promise = api.createSession("/tmp", 1, "Test Session");

      setTimeout(() => {
        mockRes.emit("data", Buffer.from(JSON.stringify(mockSession)));
        mockRes.emit("end");
      }, 10);

      const result = await promise;
      expect(result.id).toBe(mockSession.id);
      expect(result.title).toBe(mockSession.title);
      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ title: "Test Session" }));
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/session",
        }),
        expect.any(Function),
      );
    });
  });
});

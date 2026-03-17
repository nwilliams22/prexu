import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri log plugin so its invoke calls don't throw
vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { logger } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  it("logger.info calls console.log with formatted message", async () => {
    await logger.info("test", "hello");
    expect(console.log).toHaveBeenCalledWith("[test] hello");
  });

  it("logger.warn calls console.warn with formatted message", async () => {
    await logger.warn("net", "timeout");
    expect(console.warn).toHaveBeenCalledWith("[net] timeout");
  });

  it("logger.error calls console.error with formatted message", async () => {
    await logger.error("api", "failed");
    expect(console.error).toHaveBeenCalledWith("[api] failed");
  });

  it("logger.debug calls console.debug with formatted message", async () => {
    await logger.debug("cache", "hit");
    expect(console.debug).toHaveBeenCalledWith("[cache] hit");
  });

  it("appends string data to the message", async () => {
    await logger.info("tag", "msg", "extra");
    expect(console.log).toHaveBeenCalledWith("[tag] msg extra");
  });

  it("appends JSON-serialized object data to the message", async () => {
    await logger.info("tag", "msg", { a: 1 });
    expect(console.log).toHaveBeenCalledWith('[tag] msg {"a":1}');
  });

  it("handles undefined data by not appending anything", async () => {
    await logger.info("tag", "msg");
    expect(console.log).toHaveBeenCalledWith("[tag] msg");
  });

  it("does not throw when Tauri log plugin is unavailable", async () => {
    await expect(logger.info("tag", "safe")).resolves.toBeUndefined();
    await expect(logger.warn("tag", "safe")).resolves.toBeUndefined();
    await expect(logger.error("tag", "safe")).resolves.toBeUndefined();
    await expect(logger.debug("tag", "safe")).resolves.toBeUndefined();
  });
});

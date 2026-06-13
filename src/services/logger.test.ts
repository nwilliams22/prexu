import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri log plugin so its invoke calls don't throw
vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

import { logger, redactUrl } from "./logger";

describe("redactUrl", () => {
  it("redacts a token mid-string so truncation cannot leak a prefix", () => {
    // Short LAN URI: the token starts well before char 80, so naive
    // substring(0, 80) truncation would have leaked most of it.
    const token = "a".repeat(40);
    const url = `http://10.0.0.5:32400/library/parts/1/file.mkv?X-Plex-Token=${token}`;
    const result = redactUrl(url);
    expect(result).not.toContain(token);
    expect(result).not.toContain("a".repeat(8));
    expect(result).toContain("X-Plex-Token=***");
  });

  it("leaves URLs without a token untouched apart from truncation", () => {
    const url = "http://10.0.0.5:32400/library/sections/1/all";
    expect(redactUrl(url)).toBe(url);
  });

  it("truncates to 100 chars", () => {
    const url = "http://10.0.0.5:32400/" + "p".repeat(200);
    expect(redactUrl(url).length).toBe(100);
    expect(redactUrl(url)).toBe(url.substring(0, 100));
  });

  it("redacts the token but keeps other query params", () => {
    const url = "http://plex.local/video?session=abc&X-Plex-Token=secret123&offset=42";
    const result = redactUrl(url);
    expect(result).toBe("http://plex.local/video?session=abc&X-Plex-Token=***&offset=42");
  });

  it("redacts every occurrence when the token appears multiple times", () => {
    const url = "http://plex.local/a?X-Plex-Token=tok1&b=2&X-Plex-Token=tok2";
    const result = redactUrl(url);
    expect(result).not.toContain("tok1");
    expect(result).not.toContain("tok2");
    expect(result.match(/X-Plex-Token=\*\*\*/g)).toHaveLength(2);
  });

  it("matches the param name case-insensitively", () => {
    const result = redactUrl("http://plex.local/a?x-plex-token=secret&X-PLEX-TOKEN=other");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("other");
  });

  it("redacts a token at the end of the URL with no trailing params", () => {
    const result = redactUrl("http://plex.local/a?X-Plex-Token=trailing");
    expect(result).toBe("http://plex.local/a?X-Plex-Token=***");
  });

  it("handles an empty string", () => {
    expect(redactUrl("")).toBe("");
  });
});

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

  it("logger.trace calls console.debug with formatted message", async () => {
    await logger.trace("perf", "tick");
    expect(console.debug).toHaveBeenCalledWith("[perf] tick");
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
    await expect(logger.trace("tag", "safe")).resolves.toBeUndefined();
  });
});

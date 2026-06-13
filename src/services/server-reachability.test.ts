import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeServerReachability, resolveServerFromDiscovery, logServerResolve } from "./server-reachability";
import type { PlexServer } from "../types/plex";

// Mock plex-api — expose both helpers used by server-reachability.ts.
// Factories are hoisted so we must not reference const/let variables here;
// use vi.fn() inline and retrieve mocks via vi.mocked() after import.
vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn(),
  timedFetch: vi.fn(),
}));

// Mock logger so we don't hit Tauri in tests (keep the real redactUrl)
vi.mock("./logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./logger")>()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "./logger";
import { getServerHeaders, timedFetch } from "./plex-api";

const mockGetServerHeaders = vi.mocked(getServerHeaders);
const mockTimedFetch = vi.mocked(timedFetch);

const mockLogger = vi.mocked(logger);

const FAKE_HEADERS = {
  Accept: "application/json",
  "X-Plex-Token": "test-token",
  "X-Plex-Client-Identifier": "test-client",
  "X-Plex-Product": "Prexu",
  "X-Plex-Version": "0.1.0",
};

describe("probeServerReachability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerHeaders.mockResolvedValue(FAKE_HEADERS);
  });

  it("returns true when timedFetch resolves with ok=true", async () => {
    mockTimedFetch.mockResolvedValue({ ok: true } as Response);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(true);
    expect(mockTimedFetch).toHaveBeenCalledOnce();
  });

  it("calls timedFetch rather than raw fetch", async () => {
    const rawFetchSpy = vi.fn();
    vi.stubGlobal("fetch", rawFetchSpy);
    mockTimedFetch.mockResolvedValue({ ok: true } as Response);

    await probeServerReachability("https://192.168.1.100:32400", "test-server-token");

    expect(mockTimedFetch).toHaveBeenCalledOnce();
    expect(rawFetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("calls timedFetch with /identity path and PROBE_TIMEOUT_MS=5000", async () => {
    mockTimedFetch.mockResolvedValue({ ok: true } as Response);

    await probeServerReachability("https://192.168.1.100:32400", "test-server-token");

    expect(mockTimedFetch).toHaveBeenCalledWith(
      "https://192.168.1.100:32400/identity",
      expect.objectContaining({
        headers: FAKE_HEADERS,
        timeoutMs: 5000,
        retries: 0,
      })
    );
  });

  it("awaits getServerHeaders before calling timedFetch (timer starts after headers)", async () => {
    const callOrder: string[] = [];

    mockGetServerHeaders.mockImplementation(async () => {
      callOrder.push("getServerHeaders");
      return FAKE_HEADERS;
    });
    mockTimedFetch.mockImplementation(async () => {
      callOrder.push("timedFetch");
      return { ok: true } as Response;
    });

    await probeServerReachability("https://192.168.1.100:32400", "test-server-token");

    expect(callOrder).toEqual(["getServerHeaders", "timedFetch"]);
  });

  it("returns false when timedFetch resolves with ok=false", async () => {
    mockTimedFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
  });

  it("returns false when timedFetch throws (network error)", async () => {
    mockTimedFetch.mockRejectedValue(new Error("Network failure"));

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
  });

  it("returns false when timedFetch throws an AbortError (timeout)", async () => {
    mockTimedFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
  });

  it("retries the probe when attempts > 1 and succeeds on the second try", async () => {
    vi.useFakeTimers();

    mockTimedFetch
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce({ ok: true } as Response);

    const probePromise = probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token",
      2
    );

    // Advance past the 750ms inter-attempt delay
    await vi.runAllTimersAsync();

    const result = await probePromise;

    expect(result).toBe(true);
    expect(mockTimedFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("delays ~750ms between failed attempts", async () => {
    vi.useFakeTimers();

    mockTimedFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const probePromise = probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token",
      2
    );

    // First attempt completes synchronously; now 750ms timer is pending.
    // Advance time by 749ms — second attempt should NOT have fired yet.
    await vi.advanceTimersByTimeAsync(749);
    expect(mockTimedFetch).toHaveBeenCalledTimes(1);

    // Advance the remaining 1ms to trigger the delay.
    await vi.advanceTimersByTimeAsync(1);
    // Let the second probe microtask settle.
    await vi.runAllTimersAsync();

    const result = await probePromise;
    expect(result).toBe(false);
    expect(mockTimedFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("does not retry by default (single attempt)", async () => {
    mockTimedFetch.mockRejectedValue(new Error("Network failure"));

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
    expect(mockTimedFetch).toHaveBeenCalledTimes(1);
  });

  it("returns false after exhausting all attempts", async () => {
    vi.useFakeTimers();

    mockTimedFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const probePromise = probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token",
      3
    );

    await vi.runAllTimersAsync();

    const result = await probePromise;
    expect(result).toBe(false);
    expect(mockTimedFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("hits the /identity path on the server URI", async () => {
    mockTimedFetch.mockResolvedValue({ ok: true } as Response);

    await probeServerReachability("http://10.0.0.5:32400", "tok");

    const calledUrl = mockTimedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://10.0.0.5:32400/identity");
  });

  it("logs a debug message between attempts", async () => {
    vi.useFakeTimers();

    mockTimedFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const probePromise = probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token",
      2
    );

    await vi.runAllTimersAsync();
    await probePromise;

    expect(mockLogger.debug).toHaveBeenCalledWith(
      "auth",
      "reachability probe failed, retrying",
      { attempt: 1, of: 2 }
    );

    vi.useRealTimers();
  });
});

describe("resolveServerFromDiscovery", () => {
  const makeServer = (overrides: Partial<PlexServer> = {}): PlexServer => ({
    name: "My Server",
    clientIdentifier: "server-abc",
    accessToken: "token-abc",
    uri: "https://10.0.0.5:32400",
    local: true,
    owned: true,
    status: "online",
    ...overrides,
  });

  it("returns null when list is empty", () => {
    const result = resolveServerFromDiscovery([], "server-abc");
    expect(result).toBeNull();
  });

  it("returns null when clientIdentifier does not match", () => {
    const servers = [makeServer({ clientIdentifier: "other-server" })];
    const result = resolveServerFromDiscovery(servers, "server-abc");
    expect(result).toBeNull();
  });

  it("returns null when matching server is offline", () => {
    const servers = [makeServer({ status: "offline" })];
    const result = resolveServerFromDiscovery(servers, "server-abc");
    expect(result).toBeNull();
  });

  it("returns ServerData when matching server is online", () => {
    const servers = [
      makeServer({ clientIdentifier: "other" }),
      makeServer({
        clientIdentifier: "server-abc",
        uri: "https://10.0.0.5:32400",
        accessToken: "fresh-token",
      }),
    ];
    const result = resolveServerFromDiscovery(servers, "server-abc");

    expect(result).not.toBeNull();
    expect(result!.clientIdentifier).toBe("server-abc");
    expect(result!.uri).toBe("https://10.0.0.5:32400");
    expect(result!.accessToken).toBe("fresh-token");
    expect(result!.name).toBe("My Server");
  });

  it("returns only the fields present in ServerData (no local/owned/status)", () => {
    const servers = [makeServer()];
    const result = resolveServerFromDiscovery(servers, "server-abc");
    expect(result).not.toBeNull();
    expect("local" in result!).toBe(false);
    expect("owned" in result!).toBe(false);
    expect("status" in result!).toBe(false);
  });
});

describe("logServerResolve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs at info level with truncated URIs", () => {
    const longUri = "https://" + "a".repeat(120) + ":32400";
    logServerResolve(longUri, "https://10.0.0.5:32400");

    expect(mockLogger.info).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "auth",
      "server URI re-resolved",
      expect.objectContaining({
        from: longUri.substring(0, 100),
        to: "https://10.0.0.5:32400",
      })
    );
  });

  it("redacts tokens if a URI ever carries one", () => {
    logServerResolve("https://10.0.0.5:32400?X-Plex-Token=secret", "https://new:32400");
    const call = mockLogger.info.mock.calls[0];
    const data = call[2] as { from: string; to: string };
    expect(data.from).not.toContain("secret");
    expect(data.from).toContain("X-Plex-Token=***");
  });

  it("does not include content beyond 100 chars", () => {
    const longUri = "https://" + "x".repeat(200) + ":32400";
    logServerResolve(longUri, "https://new:32400");
    const call = mockLogger.info.mock.calls[0];
    const data = call[2] as { from: string; to: string };
    expect(data.from.length).toBeLessThanOrEqual(100);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeServerReachability, resolveServerFromDiscovery, logServerResolve } from "./server-reachability";
import type { PlexServer } from "../types/plex";

// Mock plex-api for getServerHeaders
vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn().mockResolvedValue({
    Accept: "application/json",
    "X-Plex-Token": "test-token",
    "X-Plex-Client-Identifier": "test-client",
    "X-Plex-Product": "Prexu",
    "X-Plex-Version": "0.1.0",
  }),
}));

// Mock logger so we don't hit Tauri in tests
vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "./logger";

const mockLogger = vi.mocked(logger);

describe("probeServerReachability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when fetch resolves with ok=true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://192.168.1.100:32400/identity",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    vi.unstubAllGlobals();
  });

  it("returns false when fetch resolves with ok=false", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns false when fetch throws (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns false when fetch is aborted (timeout)", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const mockFetch = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", mockFetch);

    const result = await probeServerReachability(
      "https://192.168.1.100:32400",
      "test-server-token"
    );

    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it("hits the /identity path on the server URI", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    await probeServerReachability("http://10.0.0.5:32400", "tok");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://10.0.0.5:32400/identity");

    vi.unstubAllGlobals();
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
    const longUri = "https://" + "a".repeat(100) + ":32400";
    logServerResolve(longUri, "https://10.0.0.5:32400");

    expect(mockLogger.info).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "auth",
      "server URI re-resolved",
      expect.objectContaining({
        from: longUri.substring(0, 80),
        to: "https://10.0.0.5:32400",
      })
    );
  });

  it("does not include content beyond 80 chars", () => {
    const longUri = "https://" + "x".repeat(200) + ":32400";
    logServerResolve(longUri, "https://new:32400");
    const call = mockLogger.info.mock.calls[0];
    const data = call[2] as { from: string; to: string };
    expect(data.from.length).toBeLessThanOrEqual(80);
  });
});
